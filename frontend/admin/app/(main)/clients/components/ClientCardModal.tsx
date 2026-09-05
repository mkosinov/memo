'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ApiError } from '@memo/api-client';
import {
  useCreateClient,
  useUpdateClient,
  useDeleteClient,
  useArchiveClient,
  useRestoreClient,
  useResolveDeleteClient,
} from '@/hooks/useClientsMutations';
import { useClientRecords } from '@/hooks/useClient';
import { useActivitiesForRecords } from '@/hooks/useActivities';
import { useUI } from '@/contexts/UIContext';
import { ClientInfoTab, type ClientInfoTabHandle } from './ClientInfoTab';
import { ClientRecordTab } from './ClientRecordTab';
import { Modal } from '@/app/components/shared/modal/Modal';
import { DeleteDialog } from '@/app/components/DeleteDialog';
import type { ClientWithStats, DependencyNode } from '@memo/api-client';
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
  // GH #140 — mutations are local hook instances (no global ClientsContext).
  const createMutation = useCreateClient();
  const updateMutation = useUpdateClient();
  const deleteMutation = useDeleteClient();
  const archiveMutation = useArchiveClient();
  const restoreMutation = useRestoreClient();
  const resolveDeleteMutation = useResolveDeleteClient();
  const { dependencies } = deleteMutation;
  const { showToast } = useUI();

  // ─── Delete dialog state (§7.3: parent owns dry-run + open/close) ────
  const [deleteTarget, setDeleteTarget] = useState<{
    client: ClientWithStats;
    dependencies: DependencyNode[];
  } | null>(null);

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

  // ─── Delete — §7.3 dry-run flow ───────────────────────────────────────
  // No-body DELETE → 204 (instant delete → close modal) or 409 + tree →
  // DeleteDialog (Mode A: resolve / Mode B: archive). window.confirm replaced
  // per #207.
  const handleDelete = useCallback(async () => {
    if (!client) return;
    try {
      await deleteMutation.mutateAsync(client.id);
      // 204 — already deleted (zero deps): close the modal.
      showToast('Клиент удалён');
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Prefer the tree on the failing 409 response itself (always fresh);
        // the hook-parked `dependencies` is only a fallback.
        const deps = err.dependencies ?? dependencies ?? [];
        if (deps.length > 0) {
          setDeleteTarget({ client, dependencies: deps });
          return;
        }
      }
      showToast(parseApiError(err).message, 'error');
    }
  }, [client, deleteMutation, dependencies, onClose, showToast]);

  // ─── Archive / Restore (#198 parity) ─────────────────────────────────
  const handleArchiveToggle = useCallback(async () => {
    if (!client) return;
    try {
      if (client.archived) {
        await restoreMutation.mutateAsync(client.id);
        showToast('Клиент восстановлен');
      } else {
        await archiveMutation.mutateAsync(client.id);
        showToast('Клиент в архиве');
      }
      onClose();
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  }, [client, archiveMutation, restoreMutation, onClose, showToast]);

  // GH #140 — records + their activities via point hooks (shared keys; the
  // activity dates come from ActivityResponse.start, not the record).
  const { data: records } = useClientRecords(client?.id, isOpen && mode === 'view');
  const { data: recordActivities } = useActivitiesForRecords(
    records?.map((r) => r.activity_id) ?? [],
  );

  // Reset tab to 'client' whenever the modal opens; drop any pending delete
  // dialog when it closes (so reopening doesn't resurrect a stale dialog).
  useEffect(() => {
    if (isOpen) {
      setActiveTab('client');
    } else {
      setDeleteTarget(null);
    }
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
                <div className="flex gap-2">
                  <button
                    onClick={handleArchiveToggle}
                    className="px-4 py-2 text-sm rounded-lg border transition-colors"
                    style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
                  >
                    {client.archived ? 'Восстановить' : 'В архив'}
                  </button>
                  <button
                    onClick={handleDelete}
                    className="px-4 py-2 text-sm text-red-500 hover:text-red-600 rounded-lg transition-colors"
                  >
                    Удалить
                  </button>
                </div>
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
              const activity = recordActivities?.[i];
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
                      const newClient = await createMutation.mutateAsync({
                        name: data.name ?? '',
                        phone: data.phone ?? undefined,
                        email: data.email ?? undefined,
                        channel: data.channel ?? undefined,
                      });
                      onClientCreated?.(newClient as any);
                    } catch (err) {
                      showToast(parseApiError(err).message, 'error');
                    }
                  }
                : async (data) => {
                    try {
                      await updateMutation.mutateAsync({ id: client!.id, data });
                    } catch (err) {
                      showToast(parseApiError(err).message, 'error');
                    }
                  }
              }
              onDelete={mode === 'view' && client ? handleDelete : undefined}
            />
          ) : (
            <ClientRecordTab recordId={activeTab.replace('record-', '')} clientId={client!.id} client={client} />
          )}
        </div>
      </Modal>

      {/* Delete dialog — §7.3: opened on dry-run 409, closed on done/cancel */}
      {deleteTarget && (
        <DeleteDialog
          entityName={deleteTarget.client.name || 'Дорогой гость'}
          entityType="client"
          entityId={deleteTarget.client.id}
          dependencies={deleteTarget.dependencies}
          onResolve={async (id, resolutions) => {
            await resolveDeleteMutation.mutateAsync({ id, resolutions });
            showToast('Клиент удалён');
          }}
          onArchive={(id) => archiveMutation.mutateAsync(id)}
          onDone={() => {
            setDeleteTarget(null);
            onClose();
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
