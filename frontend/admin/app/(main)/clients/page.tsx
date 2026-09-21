'use client';

import { Suspense, useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { ClientsProvider, useClientsTable } from '@/contexts/ClientsContext';
import type { ClientFilters } from '@/contexts/ClientsContext';
import { parseClientIds } from '@/lib/client-id-param';
import { GridSettingsProvider } from '@/contexts/schedule/GridSettingsContext';
import { ClientsTable } from './components/ClientsTable';
import { ClientsFilters } from './components/ClientsFilters';
import { ClientCardModal } from './components/ClientCardModal';
import type { ClientWithStats } from '@memo/api-client';

/** Stable comparison for the machine narrowing field (order-sensitive). */
function sameIds(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
  if ((a ?? null) === (b ?? null)) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

function ClientsPageContent() {
  const [selectedClient, setSelectedClient] = useState<ClientWithStats | null>(null);
  const [isCreateMode, setIsCreateMode] = useState(false);
  // #139 T6 — legacy page-level pager removed; the unified <DataTable> pager
  // owns pagination for the page (spec §6.10, dict-table unification).
  // GH #140 — page-scoped factory state; lookups by id go through useClient.
  const { items, filters, setFilters } = useClientsTable();
  const searchParams = useSearchParams();
  // #232 §3.3 — the address is the single writer of the narrowing: strict
  // per-component UUID validation + dedup; null = no param. Memoized on the
  // params object identity so the array (and the sync effect below) stay
  // stable across re-renders: Next's useSearchParams returns an object that
  // is stable per navigation and changes exactly when the address does
  // (AppRouter memoizes url.searchParams on the canonical URL).
  const urlClientIds = useMemo(() => parseClientIds(searchParams), [searchParams]);
  // Auto-open rule (#232 §3.3): exactly ONE valid id opens the modal
  // automatically; two or more never do (US-3) — cards open by row clicks.
  const deepLinkId = urlClientIds && urlClientIds.length === 1 ? urlClientIds[0] : null;
  // GH #216 close-race fix (rewired in #232 §3.4): latch holding the single
  // id whose deep-link modal was already opened. Blocks auto-re-open after a
  // user close while the id is still the sole one in the URL; resets when the
  // auto-open condition (exactly one valid id) leaves the address.
  const consumedClientIdRef = useRef<string | null>(null);

  // Live sync URL → clientIds machine field (#232 §3.3). Besides the
  // mount-time seed, the field follows the address: in-tab navigation
  // (back/forward, manual edit, narrowing removal) converges the filter to
  // the URL value. No reverse flow — the filter never writes the address.
  useEffect(() => {
    if (!sameIds(filters.clientIds, urlClientIds)) {
      setFilters({ clientIds: urlClientIds });
    }
  }, [urlClientIds, filters.clientIds, setFilters]);

  // GH #216 close-race fix: once the address no longer holds exactly one
  // valid id, the latch clears — a future deep-link with the same id opens
  // the modal again.
  useEffect(() => {
    if (!deepLinkId) {
      consumedClientIdRef.current = null;
    }
  }, [deepLinkId]);

  // Open ClientCardModal for a single-id deep-link — exactly once per
  // deep-link navigation (GH #216 latch, #232 §3.3 auto-open rule): after the
  // modal has been opened for an id, the latch blocks re-open until the id
  // leaves the address. Multi-id links never auto-open.
  useEffect(() => {
    if (deepLinkId && deepLinkId !== consumedClientIdRef.current && !selectedClient) {
      const found = items.find((c) => c.id === deepLinkId);
      if (found) {
        consumedClientIdRef.current = deepLinkId;
        setSelectedClient(found);
      }
    }
  }, [deepLinkId, items, selectedClient]);

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
          Клиенты
        </h1>
        <button
          onClick={() => setIsCreateMode(true)}
          className="px-4 py-2 text-sm text-white rounded-lg"
          style={{ backgroundColor: 'var(--brand)' }}
        >
          + Новый клиент
        </button>
      </div>

      {/* Filters */}
      <div
        className="rounded-xl border p-4"
        style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
      >
        <ClientsFilters />
      </div>

      {/* Table */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
      >
        <ClientsTable onClientClick={setSelectedClient} />
      </div>

      {/* Modal — closing it does NOT touch the address or filters (#232 §3.4):
          the table stays narrowed, the param stays in the URL, and the row can
          be re-opened by a manual click (the latch only blocks auto-re-open). */}
      <ClientCardModal
        client={selectedClient}
        isOpen={!!selectedClient || isCreateMode}
        onClose={() => {
          setSelectedClient(null);
          setIsCreateMode(false);
        }}
        onClientCreated={(newClient) => {
          setSelectedClient(newClient);
          setIsCreateMode(false);
        }}
        mode={isCreateMode ? 'create' : 'view'}
      />
    </div>
  );
}

// #231 §5.2 — boundary rebuild: the param reader sits ABOVE ClientsProvider so
// the deep-link seed can be passed down as initialFilters (one narrowed GET on
// mount instead of default + narrowed). #232 §3.3: the values are strictly
// validated per component and deduped (lib/client-id-param); no valid UUID
// left = no param = default filters. Status is forced to 'all' so the link
// reaches archived clients too (#216 behavior preserved). The search box gets
// no UUID at any stage — the narrowing lives in the machine field clientIds.
function ClientsPageInner() {
  const searchParams = useSearchParams();
  const clientIds = parseClientIds(searchParams);
  const initialFilters: Partial<ClientFilters> | undefined = clientIds
    ? { clientIds, status: 'all' }
    : undefined;
  return (
    <ClientsProvider initialFilters={initialFilters}>
      {/* GH #138 Task 6: /clients needs only grid settings (gridFrequency in
          ClientRecordTab) — the schedule stack (URL view state + data) is
          schedule-page-only and must not mount here. */}
      <GridSettingsProvider>
        <ClientsPageContent />
      </GridSettingsProvider>
    </ClientsProvider>
  );
}

export default function ClientsPage() {
  // #231: the Suspense boundary stays at the very top — the provider (and its
  // first GET) lives under the boundary. Nothing observable renders outside
  // it, so the «Загрузка...» fallback stays the first visible frame.
  return (
    <Suspense fallback={<div className="p-4">Загрузка...</div>}>
      <ClientsPageInner />
    </Suspense>
  );
}
