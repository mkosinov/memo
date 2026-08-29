'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useClients } from '@/contexts/ClientsContext';
import { ScheduleProvider } from '@/contexts/ScheduleContext';
import { ClientsTable } from './components/ClientsTable';
import { ClientsFilters } from './components/ClientsFilters';
import { ClientCardModal } from './components/ClientCardModal';
import type { ClientWithStats } from '@memo/api-client';

function ClientsPageContent() {
  const [selectedClient, setSelectedClient] = useState<ClientWithStats | null>(null);
  const [isCreateMode, setIsCreateMode] = useState(false);
  // #139 T6 — legacy page-level pager removed; the unified <DataTable> pager
  // owns pagination for the page (spec §6.10, dict-table unification).
  const { clients, setFilters, isPending, isFetching } = useClients();
  const searchParams = useSearchParams();
  const router = useRouter();
  const clientIdFromQuery = searchParams.get('clientId');

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

  // Open ClientCardModal when navigated with ?clientId=
  useEffect(() => {
    if (clientIdFromQuery && !selectedClient) {
      const found = clients.find(c => c.id === clientIdFromQuery);
      if (found) {
        setSelectedClient(found);
      }
    }
  }, [clientIdFromQuery, clients, selectedClient]);

  // GH #216: dead link — narrowed fetch settled with zero rows and the modal
  // never opened → strip the param so a manual search-clear + refresh cannot
  // re-trigger the narrowing (spec §5.5 E1).
  useEffect(() => {
    if (
      clientIdFromQuery &&
      !selectedClient &&
      !isPending &&
      !isFetching &&
      clients.length === 0
    ) {
      router.replace('/clients', { scroll: false });
    }
  }, [clientIdFromQuery, selectedClient, isPending, isFetching, clients, router]);

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
    <ScheduleProvider>
      <Suspense fallback={<div className="p-4">Загрузка...</div>}>
        <ClientsPageContent />
      </Suspense>
    </ScheduleProvider>
  );
}
