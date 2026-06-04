'use client';

import { useState } from 'react';
import { ClientsProvider, useClients } from '@/contexts/ClientsContext';
import { ClientsTable } from './components/ClientsTable';
import { ClientsFilters } from './components/ClientsFilters';
import { ClientCardModal } from './components/ClientCardModal';
import type { ClientWithStats } from '@memo/api-client';

function ClientsPageContent() {
  const [selectedClient, setSelectedClient] = useState<ClientWithStats | null>(null);
  const [isCreateMode, setIsCreateMode] = useState(false);
  const { total, page, perPage, setPage } = useClients();

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'var(--line)' }}
      >
        <h1 className="text-lg font-semibold">Клиенты</h1>
        <button
          onClick={() => setIsCreateMode(true)}
          className="px-4 py-2 text-sm text-white rounded-lg"
          style={{ backgroundColor: 'var(--brand)' }}
        >
          + Новый клиент
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <ClientsFilters />
        <ClientsTable onClientClick={setSelectedClient} />

        {/* Pagination */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-light">{total} клиентов</span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="px-3 py-1 text-sm border rounded disabled:opacity-50"
              style={{ borderColor: 'var(--line)' }}
            >
              ←
            </button>
            <span className="text-sm">Стр. {page}</span>
            <button
              disabled={page * perPage >= total}
              onClick={() => setPage(page + 1)}
              className="px-3 py-1 text-sm border rounded disabled:opacity-50"
              style={{ borderColor: 'var(--line)' }}
            >
              →
            </button>
          </div>
        </div>
      </div>

      {/* Modal */}
      <ClientCardModal
        client={selectedClient}
        isOpen={!!selectedClient || isCreateMode}
        onClose={() => {
          setSelectedClient(null);
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
      <ClientsPageContent />
    </ClientsProvider>
  );
}
