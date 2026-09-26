'use client';

import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClientWithStats, ClientUpdate, DependencyNode, VisitorResponse } from '@memo/api-client';
import { ApiError, getClientVisitors, createVisitor } from '@memo/api-client';
import { useDeleteVisitor } from '@/hooks/useVisitorsMutations';
import { DeleteDialog } from '@/app/components/DeleteDialog';
import { parseApiError } from '@/app/lib/api/parseApiError';
import { useUI } from '@/contexts/UIContext';
import { qk } from '@/lib/queryKeys';
import { ClientStatistics } from '@/app/components/shared/record/blocks/ClientStatistics';

const CHANNEL_VALUES = ['telegram', 'whatsapp', 'max'] as const;
type ChannelValue = (typeof CHANNEL_VALUES)[number];
const isKnownChannel = (v: string): v is ChannelValue =>
  (CHANNEL_VALUES as readonly string[]).includes(v);

export interface ClientInfoTabHandle {
  save: () => Promise<void>;
  cancel: () => void;
}

interface ClientInfoTabProps {
  client: ClientWithStats | null;
  mode?: 'view' | 'create';
  onSave: (data: ClientUpdate) => Promise<void>;
  onHasChanges?: (hasChanges: boolean) => void;
}

export const ClientInfoTab = forwardRef<ClientInfoTabHandle, ClientInfoTabProps>(function ClientInfoTab(
  { client, mode = 'view', onSave, onHasChanges },
  ref,
) {
  const [name, setName] = useState(client?.name || '');
  const [phone, setPhone] = useState(client?.phone || '');
  const [email, setEmail] = useState(client?.email || '');
  const [channel, setChannel] = useState(client?.channel && isKnownChannel(client.channel) ? client.channel : '');
  const [hasChanges, setHasChanges] = useState(false);

  // ── Visitors render source — #324 Task 8 review fix ───────────────────
  // The list now renders FROM REACT-QUERY (the ['visitors', clientId] family
  // — the same key the deferred-delete hook snapshots/restores), replacing
  // the former effect-driven local fetch: for a deferred delete the card and
  // the conveyor must share ONE state — the optimistic removal, the undo
  // restore and the commit invalidation then converge the visible rows by
  // construction (mirrors the tags/photos surfaces whose tables render from
  // their query families).
  const queryClient = useQueryClient();
  const { data: visitors = [], isLoading: visitorsLoading } = useQuery({
    queryKey: qk.visitors(client?.id ?? ''),
    queryFn: () => getClientVisitors(client!.id),
    enabled: mode === 'view' && !!client,
  });
  const [showVisitorForm, setShowVisitorForm] = useState(false);
  const [newVisitorName, setNewVisitorName] = useState('');
  const [newVisitorAge, setNewVisitorAge] = useState('');

  useEffect(() => {
    setName(client?.name || '');
    setPhone(client?.phone || '');
    setEmail(client?.email || '');
    setChannel(client?.channel || '');
    setHasChanges(false);
  }, [client]);

  // (Visitors need no reset effect — the query key swap refetches on its own.)

  const handleChange = useCallback(() => setHasChanges(true), []);

  const handleSave = useCallback(async () => {
    await onSave({
      name: name || null,
      phone: phone || null,
      email: email || null,
      channel: isKnownChannel(channel) ? channel : null,
    });
    setHasChanges(false);
  }, [name, phone, email, channel, onSave]);

  const handleCancel = useCallback(() => {
    setName(client?.name || '');
    setPhone(client?.phone || '');
    setEmail(client?.email || '');
    setChannel(client?.channel || '');
    setHasChanges(false);
  }, [client]);

  // Expose save/cancel to parent via ref
  useImperativeHandle(ref, () => ({ save: handleSave, cancel: handleCancel }), [handleSave, handleCancel]);

  // Notify parent when hasChanges changes
  useEffect(() => { onHasChanges?.(hasChanges); }, [hasChanges, onHasChanges]);

  const handleCreateVisitor = useCallback(async () => {
    if (!newVisitorName.trim() || !client) return;
    const age = newVisitorAge ? Number(newVisitorAge) : undefined;
    await createVisitor({ client_id: client.id, name: newVisitorName.trim(), age });
    setNewVisitorName('');
    setNewVisitorAge('');
    setShowVisitorForm(false);
    // Refresh the visitors query — the render source (#324 review fix:
    // the local setVisitors mirror is gone; invalidate the SAME family the
    // deferred-delete conveyor snapshots).
    await queryClient.invalidateQueries({ queryKey: qk.visitors(client.id) });
  }, [newVisitorName, newVisitorAge, client, queryClient]);

  // ── #324 Task 8: visitor delete on the deferred conveyor ──────────────
  // The × button goes through removeVisitor (dry-run first): a visit-less
  // visitor → 204 → optimistic row removal + 5s undo ring; with visits →
  // 409 rejection here → park the tree + open DeleteDialog «Посещения: N
  // будут удалены». NO instant delete path remains (bare DELETE → 422).
  // Review fix: the card renders from the ['visitors', clientId] query —
  // the hook's optimistic remove, UNDO RESTORE and commit invalidation all
  // converge the visible rows (no local list mirror to drift out of sync).
  const { removeVisitor, removeVisitorResolved } = useDeleteVisitor();
  const { showToast } = useUI();
  const [deleteTarget, setDeleteTarget] = useState<{ visitor: VisitorResponse; deps: DependencyNode[] } | null>(null);

  const handleDeleteVisitor = useCallback(async (visitor: VisitorResponse) => {
    try {
      // 204 → the hook removed the row from the query caches — the card's
      // useQuery observer re-renders it away at once (the ring's promise).
      await removeVisitor(visitor);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.dependencies) {
        setDeleteTarget({ visitor, deps: err.dependencies });
        return;
      }
      // Non-409 dry-run errors keep their error-toast surface.
      showToast(parseApiError(err).message, 'error');
    }
  }, [removeVisitor, showToast]);

  const handleDeleteVisitorResolved = useCallback(
    (visitor: VisitorResponse, resolutions: Record<string, string>, deps: DependencyNode[]) => {
      // Enqueue is synchronous — the hook's optimistic removal re-renders
      // the card, the dialog closes at once.
      void removeVisitorResolved(visitor, resolutions, deps);
    },
    [removeVisitorResolved],
  );

  const inputClass = 'w-full rounded-lg border px-3 py-2 text-sm bg-white';
  const inputStyle = { borderColor: 'var(--line)' };

  return (
    <div className="space-y-4 p-4">
      {/* Contact data group */}
      <div>
        <h4 className="text-xs font-medium text-ink-mid mb-2">Контактные данные</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label htmlFor="client-name" className="text-xs font-medium text-ink-mid block mb-1">Имя</label>
            <input
              id="client-name"
              className={inputClass}
              style={inputStyle}
              value={name}
              onChange={e => {
                setName(e.target.value);
                handleChange();
              }}
            />
          </div>
          <div>
            <label htmlFor="client-phone" className="text-xs font-medium text-ink-mid block mb-1">Телефон</label>
            <input
              id="client-phone"
              className={inputClass}
              style={inputStyle}
              value={phone}
              onChange={e => {
                setPhone(e.target.value);
                handleChange();
              }}
            />
          </div>
          <div>
            <label htmlFor="client-channel" className="text-xs font-medium text-ink-mid block mb-1">Канал</label>
            <select
              id="client-channel"
              className={`${inputClass} appearance-none`}
              style={inputStyle}
              value={channel}
              onChange={e => {
                setChannel(e.target.value);
                handleChange();
              }}
            >
              <option value="">Не указан</option>
              <option value="telegram">Telegram</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="max">Max</option>
            </select>
          </div>
          <div>
            <label htmlFor="client-email" className="text-xs font-medium text-ink-mid block mb-1">Email</label>
            <input
              id="client-email"
              className={inputClass}
              style={inputStyle}
              value={email}
              onChange={e => {
                setEmail(e.target.value);
                handleChange();
              }}
            />
          </div>
        </div>
      </div>

      {/* Statistics group (read-only, view mode only) */}
      {mode === 'view' && client && (
        <ClientStatistics
          stats={{
            recordsCount: client.records_count,
            missedRecords: client.missed_records,
            lastRecord: client.last_record,
            totalPaid: client.total_paid,
          }}
        />
      )}

      {/* Dates group (read-only, view mode only) */}
      {mode === 'view' && client && (
      <div>
        <h4 className="text-xs font-medium text-ink-mid mb-2">Даты</h4>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-xs text-ink-light">Создан: </span>
            <span className="text-sm">
              {new Date(client.created_at).toLocaleDateString('ru-RU')}
            </span>
          </div>
          <div>
            <span className="text-xs text-ink-light">Обновлён: </span>
            <span className="text-sm">
              {new Date(client.updated_at).toLocaleDateString('ru-RU')}
            </span>
          </div>
        </div>
      </div>
      )}

      {/* Visitors section (view mode only) */}
      {mode === 'view' && client && (
      <div>
        <h4 className="text-xs font-medium text-ink-mid mb-2">Посетители</h4>
        <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--line)' }}>
          {visitorsLoading ? (
            <div className="text-xs text-ink-light">Загрузка...</div>
          ) : visitors.length === 0 && !showVisitorForm ? (
            <div className="text-xs text-ink-light">Нет посетителей</div>
          ) : (
            visitors.map((visitor) => (
              <div key={visitor.id} className="flex items-center justify-between text-sm py-1" data-testid="visitor-row">
                <span>
                  {visitor.name}
                  {visitor.age != null ? ` (${visitor.age} лет)` : ' (взр.)'}
                </span>
                <button
                  onClick={() => handleDeleteVisitor(visitor)}
                  className="text-red-400 hover:text-red-500 text-xs"
                  aria-label="Удалить посетителя"
                >
                  ×
                </button>
              </div>
            ))
          )}

          {showVisitorForm ? (
            <div className="space-y-2 pt-2 border-t" style={{ borderColor: 'var(--line)' }}>
              <div>
                <label htmlFor="visitor-name" className="text-xs font-medium text-ink-mid block mb-1">Имя</label>
                <input
                  id="visitor-name"
                  type="text"
                  className={inputClass}
                  style={inputStyle}
                  value={newVisitorName}
                  onChange={(e) => setNewVisitorName(e.target.value)}
                  data-testid="input-visitor-name"
                />
              </div>
              <div>
                <label htmlFor="visitor-age" className="text-xs font-medium text-ink-mid block mb-1">Возраст (опционально)</label>
                <input
                  id="visitor-age"
                  type="number"
                  className={inputClass}
                  style={inputStyle}
                  value={newVisitorAge}
                  onChange={(e) => setNewVisitorAge(e.target.value)}
                  data-testid="input-visitor-age"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCreateVisitor}
                  className="px-3 py-1.5 text-xs text-white rounded-lg"
                  style={{ backgroundColor: 'var(--brand, #004D56)' }}
                  data-testid="btn-create-visitor"
                >
                  Создать
                </button>
                <button
                  onClick={() => {
                    setShowVisitorForm(false);
                    setNewVisitorName('');
                    setNewVisitorAge('');
                  }}
                  className="px-3 py-1.5 text-xs text-ink-mid rounded-lg hover:bg-gray-100"
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowVisitorForm(true)}
              className="text-brand text-xs hover:underline"
            >
              + Добавить посетителя
            </button>
          )}
        </div>
      </div>
      )}

      {/* Visitor delete dialog — GH #324 Task 8 (spec §9.3): opened on the
          dry-run 409; the confirm enqueues the cascade deferred delete
          (enqueue is synchronous — BOTH expected groups travel in the
          commit) and the dialog closes immediately via onDone. Visitors
          never hit Mode B — the visits tree's only allowed action is
          cascade. */}
      {deleteTarget && (
        <DeleteDialog
          entityName={deleteTarget.visitor.name}
          entityType="visitor"
          entityId={deleteTarget.visitor.id}
          dependencies={deleteTarget.deps}
          onResolve={async (_id, resolutions) => {
            // Enqueue is synchronous — no await, the dialog closes at once.
            handleDeleteVisitorResolved(deleteTarget.visitor, resolutions, deleteTarget.deps);
          }}
          onArchive={async () => { /* visitors have no archive flow — never Mode B */ }}
          onDone={() => setDeleteTarget(null)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
});
