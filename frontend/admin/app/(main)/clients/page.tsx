'use client';

import { Suspense, useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ClientsProvider, useClientsTable } from '@/contexts/ClientsContext';
import type { ClientFilters } from '@/contexts/ClientsContext';
import { GridSettingsProvider } from '@/contexts/schedule/GridSettingsContext';
import { ClientsTable } from './components/ClientsTable';
import { ClientsFilters } from './components/ClientsFilters';
import { ClientCardModal } from './components/ClientCardModal';
import type { ClientWithStats } from '@memo/api-client';

function ClientsPageContent() {
  const [selectedClient, setSelectedClient] = useState<ClientWithStats | null>(null);
  const [isCreateMode, setIsCreateMode] = useState(false);
  // #139 T6 — legacy page-level pager removed; the unified <DataTable> pager
  // owns pagination for the page (spec §6.10, dict-table unification).
  // GH #140 — page-scoped factory state; lookups by id go through useClient.
  const { items, isPending, isFetching } = useClientsTable();
  const searchParams = useSearchParams();
  const router = useRouter();
  const clientIdFromQuery = searchParams.get('clientId');
  // GH #216 close-race fix: latch holding the param value whose deep-link modal
  // was already opened. Prevents the find-effect from re-opening the modal
  // after a user close while the param is still in the URL (before strip lands).
  const consumedClientIdRef = useRef<string | null>(null);

  // GH #216 close-race fix: once the param has left the URL, the latch clears so
  // a future deep-link with the same id opens the modal again.
  useEffect(() => {
    if (!clientIdFromQuery) {
      consumedClientIdRef.current = null;
    }
  }, [clientIdFromQuery]);

  // Open ClientCardModal when navigated with ?clientId= — exactly once per
  // deep-link navigation (GH #216 close-race fix): after the modal has been
  // opened for a param value, the latch blocks re-open until the param is gone.
  useEffect(() => {
    if (
      clientIdFromQuery &&
      clientIdFromQuery !== consumedClientIdRef.current &&
      !selectedClient
    ) {
      const found = items.find(c => c.id === clientIdFromQuery);
      if (found) {
        consumedClientIdRef.current = clientIdFromQuery;
        setSelectedClient(found);
      }
    }
  }, [clientIdFromQuery, items, selectedClient]);

  // GH #216: dead link — narrowed fetch settled with zero rows and the modal
  // never opened → strip the param so a manual search-clear + refresh cannot
  // re-trigger the narrowing (spec §5.5 E1).
  useEffect(() => {
    if (
      clientIdFromQuery &&
      !selectedClient &&
      !isPending &&
      !isFetching &&
      items.length === 0
    ) {
      router.replace('/clients', { scroll: false });
    }
  }, [clientIdFromQuery, selectedClient, isPending, isFetching, items, router]);

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

      {/* Modal */}
      <ClientCardModal
        client={selectedClient}
        isOpen={!!selectedClient || isCreateMode}
        onClose={() => {
          setSelectedClient(null);
          setIsCreateMode(false);
          // Clean up query param from URL
          if (clientIdFromQuery) {
            router.replace('/clients', { scroll: false });
          }
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
// mount instead of default + narrowed). The value is carried verbatim, without
// validation — the dead-link cleanup in ClientsPageContent already copes with
// garbage values.
function ClientsPageInner() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get('clientId');
  const initialFilters: Partial<ClientFilters> | undefined = clientId
    ? { search: clientId, status: 'all' }
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
  // #231: the Suspense boundary moves to the very top — the provider (and its
  // first GET) now lives under the boundary. Nothing observable renders outside
  // it, so the «Загрузка...» fallback stays the first visible frame, as before.
  return (
    <Suspense fallback={<div className="p-4">Загрузка...</div>}>
      <ClientsPageInner />
    </Suspense>
  );
}
