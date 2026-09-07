'use client';

import { Suspense, useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ClientsProvider, useClientsTable } from '@/contexts/ClientsContext';
import { ScheduleProvider } from '@/contexts/schedule/ScheduleProvider';
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
  const { items, setFilters, isPending, isFetching } = useClientsTable();
  const searchParams = useSearchParams();
  const router = useRouter();
  const clientIdFromQuery = searchParams.get('clientId');
  // GH #216 close-race fix: latch holding the param value whose deep-link modal
  // was already opened. Prevents the find-effect from re-opening the modal
  // after a user close while the param is still in the URL (before strip lands).
  const consumedClientIdRef = useRef<string | null>(null);

  // GH #216: deep-link ?clientId=N → narrow the table to that client.
  // Server q= matches a full UUID by exact id equality (GH #212) → ≤1 row →
  // always page 1 → the find-effect below sees the row regardless of its
  // position in the unfiltered list. status forced to 'all' so archived
  // clients are reachable (display default stays 'active').
  useEffect(() => {
    if (clientIdFromQuery) {
      setFilters({ search: clientIdFromQuery, status: 'all' });
    }
  }, [clientIdFromQuery, setFilters]);

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

export default function ClientsPage() {
  return (
    <ClientsProvider>
      <ScheduleProvider>
        <Suspense fallback={<div className="p-4">Загрузка...</div>}>
          <ClientsPageContent />
        </Suspense>
      </ScheduleProvider>
    </ClientsProvider>
  );
}
