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
  const { clients } = useClients();
  const searchParams = useSearchParams();
  const router = useRouter();
  const clientIdFromQuery = searchParams.get('clientId');

  // Open ClientCardModal when navigated with ?clientId=
  useEffect(() => {
    if (clientIdFromQuery && !selectedClient) {
      const found = clients.find(c => c.id === clientIdFromQuery);
      if (found) {
        setSelectedClient(found);
      }
    }
  }, [clientIdFromQuery, clients, selectedClient]);

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
