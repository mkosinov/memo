'use client';

import { Suspense, useState, useEffect, useRef } from 'react';
import { ClientsProvider, useClientsTable } from '@/contexts/ClientsContext';
import { GridSettingsProvider } from '@/contexts/schedule/GridSettingsContext';
import { useClientsUrlState } from './useClientsUrlState';
import type { ClientsUrlAdapter } from './useClientsUrlState';
import { ClientsTable } from './components/ClientsTable';
import { ClientsFilters } from './components/ClientsFilters';
import { ClientCardModal } from './components/ClientCardModal';
import { ClientDeepLinkChip } from './components/ClientDeepLinkChip';
import type { ClientWithStats } from '@memo/api-client';

/**
 * #349 single instance: Content consumes the adapter CREATED ONCE in
 * ClientsPageInner (via props) — never calls useClientsUrlState() itself.
 * The hook contract allows one instance per URL (pending-flush/navigate
 * coalescing is per-instance); a second instance would clobber the first's
 * write base and could resurrect a dropped clientId in the 16ms window.
 */
function ClientsPageContent({ urlState }: { urlState: ClientsUrlAdapter }) {
  const [selectedClient, setSelectedClient] = useState<ClientWithStats | null>(null);
  const [isCreateMode, setIsCreateMode] = useState(false);
  // #139 T6 — legacy page-level pager removed; the unified <DataTable> pager
  // owns pagination for the page (spec §6.10, dict-table unification).
  // GH #140 — page-scoped factory state; lookups by id go through useClient.
  const { items } = useClientsTable();
  // #349 Task 4 — the adapter owns the canonical table params
  // (q/status/sort/page/per_page in the address) and the machine `clientIds`
  // narrowing (read-only from ?clientId=). No sync effect anymore: the
  // provider is fully controlled from the first render, so a deep-link mount
  // still fires exactly ONE narrowed GET (#231 S1).
  const { state, navigate } = urlState;
  // Auto-open rule (#232 §3.3): exactly ONE valid id opens the modal
  // automatically; two or more never do (US-3) — cards open by row clicks.
  const deepLinkId = state.clientIds && state.clientIds.length === 1 ? state.clientIds[0] : null;
  // GH #216 close-race fix (rewired in #232 §3.4): latch holding the single
  // id whose deep-link modal was already opened. Blocks auto-re-open after a
  // user close while the id is still the sole one in the URL; resets when the
  // auto-open condition (exactly one valid id) leaves the address.
  const consumedClientIdRef = useRef<string | null>(null);

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

      {/* #232 §3.5 — narrowing chip: visible affordance for an active
          deep-link narrowing (between the filters block and the table). The
          ✕ removes the param from the address through the SAME adapter's
          navigate() (#349 single writer + single instance: a pending
          coalesced flush must adopt the navigated URL, not resurrect the
          dropped param). */}
      {state.clientIds && (
        <ClientDeepLinkChip
          clientIds={state.clientIds}
          onRemove={(url, options) => navigate(url, options)}
        />
      )}

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

// #349 Task 4 — managed mode (spec §3): the page-scoped hook is instantiated
// EXACTLY ONCE, here — inside the Suspense boundary (useSearchParams) — and
// flows DOWN to the provider and every consumer (Content, chip ✕) as props.
// Status overlay rule: explicit ?status= wins, else a present ?clientId=
// forces effective 'all' (never written to the URL — #216 behavior preserved
// through the adapter's effectiveStatus).
function ClientsPageInner() {
  const urlState = useClientsUrlState();
  return (
    <ClientsProvider urlState={urlState}>
      {/* GH #138 Task 6: /clients needs only grid settings (gridFrequency in
          ClientRecordTab) — the schedule stack (URL view state + data) is
          schedule-page-only and must not mount here. */}
      <GridSettingsProvider>
        <ClientsPageContent urlState={urlState} />
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
