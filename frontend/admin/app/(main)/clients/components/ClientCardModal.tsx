'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getRecords, getActivity } from '@memo/api-client';
import { useClients } from '@/contexts/ClientsContext';
import { useUI } from '@/contexts/UIContext';
import { ClientInfoTab, type ClientInfoTabHandle } from './ClientInfoTab';
import { ClientRecordTab } from './ClientRecordTab';
import { Modal } from '@/app/components/shared/modal/Modal';
import type { ClientWithStats, ActivityResponse } from '@memo/api-client';
import { parseApiError } from '@/app/lib/api/parseApiError';

interface ClientCardModalProps {
  client: ClientWithStats | null;
  isOpen: boolean;
  onClose: () => void;
  onClientCreated?: (client: ClientWithStats) => void;
  mode: 'view' | 'create';
}

export function ClientCardModal({ client, isOpen, onClose, onClientCreated, mode }: ClientCardModalProps) {
  const [activeTab, setActiveTab] = useState('client');
  const [hasChanges, setHasChanges] = useState(false);
  const clientInfoRef = useRef<ClientInfoTabHandle>(null);
  const { createClient, updateClient, deleteClient } = useClients();
  const { showToast } = useUI();

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleDelete = useCallback(async () => {
    const clientName = client?.name ?? 'клиента';
    if (window.confirm(`Удалить ${clientName}? Это скроет клиента из списка.`)) {
      try {
        await deleteClient(client!.id);
        onClose();
      } catch (err) {
        showToast(parseApiError(err).message, 'error');
      }
    }
  }, [client, deleteClient, onClose, showToast]);

  // Fetch records for this client (only in view mode)
  const { data: records } = useQuery({
    queryKey: ['records', 'client', client?.id],
    queryFn: () => getRecords({ client_id: client?.id! }),
    enabled: isOpen && mode === 'view' && !!client?.id,
  });

  // Fetch activities for each record to get date/time
  const { data: recordActivities = [] } = useQuery<ActivityResponse[]>({
    queryKey: ['activities', 'for-records', records?.map(r => r.activity_id) ?? []],
    queryFn: () =>
      Promise.all(
        (records ?? []).map(r => getActivity(r.activity_id)),
      ),
    enabled: !!records && records.length > 0,
  });

  // Reset tab to 'client' whenever the modal opens
  useEffect(() => {
    if (isOpen) setActiveTab('client');
  }, [isOpen]);

  if (!isOpen) return null;

  const clientName = client?.name ?? 'Дорогой гость';
  const clientPhone = client?.phone || 'Не указан';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" data-testid="client-card-modal">
      {/* Backdrop */}
      <div
        data-testid="client-card-backdrop"
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <Modal
        onClose={onClose}
        footer={
          activeTab === 'client' ? (
            <div className="flex justify-between items-center">
              {mode === 'view' && client ? (
                <button
                  onClick={handleDelete}
                  className="px-4 py-2 text-sm text-red-500 hover:text-red-600 rounded-lg transition-colors"
                >
                  Удалить
                </button>
              ) : <div />}
              <div className="flex gap-2">
                {mode === 'view' && (
                  <button
                    onClick={() => clientInfoRef.current?.cancel()}
                    className="px-4 py-2 text-sm rounded-lg border transition-colors"
                    style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
                  >
                    Отмена
                  </button>
                )}
                <button
                  disabled={!hasChanges}
                  onClick={() => clientInfoRef.current?.save()}
                  className="px-4 py-2 text-sm text-white rounded-lg disabled:bg-gray-300 transition-colors"
                  style={{ backgroundColor: hasChanges ? 'var(--brand)' : undefined }}
                >
                  {mode === 'create' ? 'Создать' : 'Сохранить'}
                </button>
              </div>
            </div>
          ) : undefined
        }
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

            {records?.map((record, i) => {
              const activity = recordActivities[i];
              const startDate = activity?.start ? new Date(activity.start) : null;
              return (
                <button
                  key={record.id}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
                    activeTab === `record-${record.id}`
                      ? 'bg-brand text-white font-medium'
                      : 'text-ink-mid hover:bg-white/60'
                  }`}
                  onClick={() => setActiveTab(`record-${record.id}`)}
                >
                  <div>{startDate ? startDate.toLocaleDateString('ru-RU') : '—'}</div>
                  {startDate && (
                    <div className="text-xs opacity-70">
                      {startDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right panel */}
        <div data-testid="client-card-right-panel" className="flex-1 overflow-y-auto">
          {activeTab === 'client' ? (
            <ClientInfoTab
              ref={clientInfoRef}
              client={client}
              mode={mode}
              onHasChanges={setHasChanges}
              onSave={mode === 'create'
                ? async (data) => {
                    try {
                      const newClient = await createClient(data as any);
                      onClientCreated?.(newClient as any);
                    } catch (err) {
                      showToast(parseApiError(err).message, 'error');
                    }
                  }
                : async (data: any) => {
                    try {
                      await updateClient(client!.id, data);
                    } catch (err) {
                      showToast(parseApiError(err).message, 'error');
                    }
                  }
              }
              onDelete={mode === 'view' && client ? handleDelete : undefined}
            />
          ) : (
            <ClientRecordTab recordId={activeTab.replace('record-', '')} clientId={client!.id} onClose={onClose} client={client} />
          )}
        </div>
      </Modal>
    </div>
  );
}
