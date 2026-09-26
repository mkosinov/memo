'use client';

import React, { useCallback, useMemo, useState } from 'react';
import type { DependencyNode, PositionResponse } from '@memo/api-client';
import { ApiError } from '@memo/api-client';
import {
  useCreatePosition,
  useUpdatePosition,
  useDeletePosition,
} from '@/hooks/usePositionsMutations';
import { useUI } from '@/contexts/UIContext';
import { usePositionsTable } from '@/contexts/PositionsContext';
import { PositionModal } from './PositionModal';
import { DataTable } from '@/app/components/shared/DataTable';
import { DeleteDialog } from '@/app/components/DeleteDialog';
import { positionColumns, positionActions } from './positionColumns';
import { parseApiError } from '@/app/lib/api/parseApiError';

/**
 * Positions dictionary table (GH #266 T9, spec D4; delete → #324 §6) — thin
 * wiring wrapper over the shared DataTable, same shape as TagsTable. All
 * table mechanics (pager/skeleton/LS column-picker/action-menu) live in
 * <DataTable>; this file keeps only the create/rename modal and the
 * mutations.
 *
 * D4 rules:
 * - title is freely editable for EVERY row, built-ins included;
 * - deletion of a built-in is refused by the backend (422 POSITION_IS_SYSTEM,
 *   from the dry-run itself) and the message reaches the user as an error
 *   toast — the explanation of the block. The client does not pre-filter
 *   the menu: the server owns the rule. NO window.confirm instant path
 *   remains (#324): clean → ring, busy → dialog «Сотрудники: N потеряют
 *   должность» → ring, system → explanation toast.
 * - positions feed nothing but the staff card list and the future salary
 *   module — no schedule/filter coupling.
 */
export function PositionsTable() {
  const positionsTable = usePositionsTable();

  const createPosition = useCreatePosition();
  const updatePosition = useUpdatePosition();
  const { showToast } = useUI();

  // ─── Modal state ────────────────────────────────────────────────────────
  const [editPosition, setEditPosition] = useState<PositionResponse | null>(null);
  const [creatingPosition, setCreatingPosition] = useState(false);

  // Delete — GH #324 (spec §6/§9.5/§9.6): deferred flow, mirrors TagsTable.
  // removePosition dry-runs: a clean 204 → ring (optimistic removal +
  // enqueue); a 409 WITH the staff_positions tree → DeleteDialog
  // («Сотрудники — потеряют должность»); a 422 POSITION_IS_SYSTEM (built-in)
  // → the explanation toast, nothing enqueued. Toasts on success come from
  // the pending stack («Удалено. Отменить» with the countdown ring).
  const { removePosition, removePositionResolved } = useDeletePosition();
  const [deleteTarget, setDeleteTarget] = useState<{
    position: PositionResponse;
    deps: DependencyNode[];
  } | null>(null);

  const handleDelete = useCallback(async (position: PositionResponse) => {
    try {
      await removePosition(position);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.dependencies) {
        setDeleteTarget({ position, deps: err.dependencies });
        return;
      }
      // Non-409 dry-run errors keep their EXISTING toast surface —
      // parseApiError maps POSITION_IS_SYSTEM to «Встроенная должность не
      // удаляется» (CODE_DEFAULTS).
      showToast(
        err instanceof Error
          ? parseApiError(err).message
          : 'Не удалось удалить. Попробуйте ещё раз.',
        'error',
      );
    }
  }, [removePosition, showToast]);

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

  // §6.15 — memoize the factory outputs; handleDelete is a stable
  // useCallback (removePosition identity is stable), so the actions memo
  // recomputes only when it actually changes.
  const columns = useMemo(() => positionColumns(), []);
  const actions = useMemo(
    () =>
      positionActions({
        onEdit: (p) => setEditPosition(p),
        onDelete: (p) => void handleDelete(p),
      }),
    [handleDelete],
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

      {/* Delete dialog — GH #324 (§9.5): opened on dry-run 409; the confirm
          enqueues the cascade deferred delete (enqueue is synchronous) and
          the dialog closes immediately via onDone. Positions never hit Mode
          B — the staff_positions tree has no blocked deps (join always
          cascades; the staff cards survive). */}
      {deleteTarget && (
        <DeleteDialog
          entityName={deleteTarget.position.title}
          entityType="position"
          entityId={deleteTarget.position.id}
          dependencies={deleteTarget.deps}
          onResolve={async (_id, resolutions) => {
            // Enqueue is synchronous — no await, the dialog closes at once.
            void removePositionResolved(deleteTarget.position, resolutions, deleteTarget.deps);
          }}
          onArchive={async () => { /* positions have no archive flow — never Mode B */ }}
          onDone={() => setDeleteTarget(null)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
