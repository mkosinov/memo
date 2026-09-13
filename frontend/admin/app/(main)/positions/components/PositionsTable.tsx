'use client';

import React, { useMemo, useState } from 'react';
import type { PositionResponse } from '@memo/api-client';
import {
  useCreatePosition,
  useUpdatePosition,
  useDeletePosition,
} from '@/hooks/usePositionsMutations';
import { useUI } from '@/contexts/UIContext';
import { usePositionsTable } from '@/contexts/PositionsContext';
import { PositionModal } from './PositionModal';
import { DataTable } from '@/app/components/shared/DataTable';
import { positionColumns, positionActions } from './positionColumns';
import { parseApiError } from '@/app/lib/api/parseApiError';

/**
 * Positions dictionary table (GH #266 T9, spec D4) — thin wiring wrapper over
 * the shared DataTable, same shape as TagsTable. All table mechanics
 * (pager/skeleton/LS column-picker/action-menu) live in <DataTable>; this file
 * keeps only the create/rename modal and the mutations.
 *
 * D4 rules:
 * - title is freely editable for EVERY row, built-ins included;
 * - deletion of a built-in is refused by the backend (422 POSITION_IS_SYSTEM)
 *   and the message reaches the user as an error toast — the explanation of the
 *   block. The client does not pre-filter the menu: the server owns the rule.
 * - positions feed nothing but the staff card list and the future salary
 *   module — no schedule/filter coupling.
 */
export function PositionsTable() {
  const positionsTable = usePositionsTable();

  const createPosition = useCreatePosition();
  const updatePosition = useUpdatePosition();
  const deletePosition = useDeletePosition();
  const { showToast } = useUI();

  // ─── Modal state ────────────────────────────────────────────────────────
  const [editPosition, setEditPosition] = useState<PositionResponse | null>(null);
  const [creatingPosition, setCreatingPosition] = useState(false);

  // ─── Handlers ───────────────────────────────────────────────────────────

  const handleRename = async (data: Record<string, unknown>) => {
    if (!editPosition) return;
    try {
      // PUT carries the title only — is_system/id are owned by the dictionary.
      await updatePosition.mutateAsync({
        id: editPosition.id,
        data: { title: String(data.title ?? '') },
      });
      showToast('Должность обновлена');
      setEditPosition(null);
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  const handleCreateSubmit = async (data: Record<string, unknown>) => {
    try {
      await createPosition.mutateAsync({ title: String(data.title ?? '') });
      showToast('Должность создана');
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // Delete keeps the §6.9 locked window.confirm flow (TagsTable precedent).
  // A built-in comes back 422 POSITION_IS_SYSTEM → the explanation toast.
  const handleDelete = async (position: PositionResponse) => {
    if (!window.confirm(`Удалить должность «${position.title}»?`)) return;
    try {
      await deletePosition.mutateAsync(position.id);
      showToast('Должность удалена');
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // §6.15 — memoize the factory outputs
  const columns = useMemo(() => positionColumns(), []);
  const actions = useMemo(
    () =>
      positionActions({
        onEdit: (p) => setEditPosition(p),
        onDelete: (p) => void handleDelete(p),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- §6.15 stable identity
    [],
  );

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div>
      <DataTable<PositionResponse>
        storageKey="positions-columns"
        columns={columns}
        tableState={positionsTable}
        actions={actions}
        onRowClick={setEditPosition}
        rowKey={(p) => p.id}
        rowTestId={(p) => `position-row-${p.id}`}
        rowClassName={() => 'hover:opacity-80'}
        toolbarExtras={
          <button
            onClick={() => setCreatingPosition(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            + Добавить должность
          </button>
        }
      />

      {/* Rename modal — built-ins included (D4: title свободен) */}
      {editPosition && (
        <PositionModal
          mode="edit"
          position={editPosition}
          onSubmit={handleRename}
          onClose={() => setEditPosition(null)}
          title="Редактирование должности"
          subtitle={editPosition.title}
        />
      )}

      {/* Create modal */}
      {creatingPosition && (
        <PositionModal
          mode="create"
          position={null}
          onSubmit={handleCreateSubmit}
          onClose={() => setCreatingPosition(false)}
          title="Новая должность"
        />
      )}
    </div>
  );
}
