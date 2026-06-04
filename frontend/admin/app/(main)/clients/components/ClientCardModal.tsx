'use client';

import { useState, useEffect } from 'react';
import { useClients } from '@/contexts/ClientsContext';
import { ClientInfoTab } from './ClientInfoTab';
import { ClientRecordTab } from './ClientRecordTab';
import type { ClientWithStats } from '@memo/api-client';

interface ClientCardModalProps {
  client: ClientWithStats | null;
  isOpen: boolean;
  onClose: () => void;
  mode: 'view' | 'create';
}

export function ClientCardModal({ client, isOpen, onClose, mode }: ClientCardModalProps) {
  const [activeTab, setActiveTab] = useState('client');
  const { createClient, updateClient, deleteClient } = useClients();

  // Reset tab to 'client' whenever the modal opens
  useEffect(() => {
    if (isOpen) setActiveTab('client');
  }, [isOpen]);

  if (!isOpen) return null;

  const clientName = client?.name ?? 'Дорогой гость';
  const clientPhone = client?.phone || 'Не указан';
  const records: Array<{ id: string; date?: string; time?: string; created_at: string }> =
    (client as any)?.records ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" data-testid="client-card-modal">
      {/* Backdrop */}
      <div
        data-testid="client-card-backdrop"
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 flex overflow-hidden"
        style={{ maxHeight: '85vh' }}
      >
        {/* Left panel */}
        <div
          data-testid="client-card-left-panel"
          className="w-44 border-r shrink-0"
          style={{ borderColor: 'var(--line)', backgroundColor: 'var(--surface)' }}
        >
          {/* Client header */}
          <div className="p-3 border-b" style={{ borderColor: 'var(--line)' }}>
            <div className="font-medium text-sm truncate">{clientName}</div>
            <div className="text-xs text-ink-light truncate">{clientPhone}</div>
          </div>

          {/* Tab list */}
          <div className="p-2 space-y-0.5 overflow-y-auto">
            <button
              className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
                activeTab === 'client'
                  ? 'bg-brand text-white font-medium'
                  : 'text-ink-mid hover:bg-white/60'
              }`}
              onClick={() => setActiveTab('client')}
            >
              Клиент
            </button>

            {records.map((record) => (
              <button
                key={record.id}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
                  activeTab === `record-${record.id}`
                    ? 'bg-brand text-white font-medium'
                    : 'text-ink-mid hover:bg-white/60'
                }`}
                onClick={() => setActiveTab(`record-${record.id}`)}
              >
                {new Date(record.date || record.created_at).toLocaleDateString('ru-RU')}{' '}
                {record.time || ''}
              </button>
            ))}
          </div>
        </div>

        {/* Right panel */}
        <div data-testid="client-card-right-panel" className="flex-1 overflow-y-auto">
          {activeTab === 'client' ? (
            <ClientInfoTab
              client={client}
              mode={mode}
              onSave={mode === 'create'
                ? async (data) => {
                    try {
                      await createClient(data as any);
                    } catch {
                      // Create failed — close modal anyway
                    }
                    onClose();
                  }
                : (data: any) => updateClient(client!.id, data)
              }
              onDelete={mode === 'view' && client
                ? () => { deleteClient(client.id); onClose(); }
                : undefined
              }
            />
          ) : (
            <ClientRecordTab recordId={activeTab.replace('record-', '')} onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}
