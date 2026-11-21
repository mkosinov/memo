'use client';

import React, { useCallback, useMemo, useState } from 'react';
import type { DependencyNode, SpecialtyResponse } from '@memo/api-client';
import { ApiError } from '@memo/api-client';
import {
  useCreateSpecialty,
  useUpdateSpecialty,
  useDeleteSpecialty,
} from '@/hooks/useSpecialtiesMutations';
import { useUI } from '@/contexts/UIContext';
import { useSpecialtiesTable } from '@/contexts/SpecialtiesContext';
import { SpecialtyModal } from './SpecialtyModal';
import { DataTable } from '@/app/components/shared/DataTable';
import { DeleteDialog } from '@/app/components/DeleteDialog';
import { specialtyColumns, specialtyActions } from './specialtyColumns';
import { parseApiError } from '@/app/lib/api/parseApiError';

/**
 * Specialties dictionary table (GH #599 Task 8.1, spec §2.3) — thin wiring
 * wrapper over the shared DataTable, the PositionsTable shape. All table
 * mechanics (pager/skeleton/LS column-picker/action-menu) live in
 * <DataTable>; this file keeps only the create/rename modal and the
 * mutations.
 *
 * Delete semantics (domain-rules/specialties.md, the #324 family): the
 * deferred conveyor mirrors positions/materials — clean row → optimistic
 * removal + the 5s undo ring; busy row → the 409 tree parks here and opens
 * DeleteDialog, whose mode the TREE decides:
 * - `services` node (allowed_actions: []) → BLOCKED Mode B: «Услуги: N»
 *   counter + the backend's way-out message, NO delete offered (services is
 *   a visible blocking dep — archived rows count too); acknowledgment only.
 * - staff-only tree (`staff_specialties` auto-cascade) → Mode A
 *   «Сотрудники — потеряют направление»; confirm enqueues the cascade
 *   commit {resolutions: {}, expected: {staff_specialties: ids}} — the
 *   staff cards survive (the materials pattern).
 */
export function SpecialtiesTable() {
  const specialtiesTable = useSpecialtiesTable();

  const createSpecialty = useCreateSpecialty();
  const updateSpecialty = useUpdateSpecialty();
  const { showToast } = useUI();

  // ─── Modal state ────────────────────────────────────────────────────────
  const [editSpecialty, setEditSpecialty] = useState<SpecialtyResponse | null>(null);
  const [creatingSpecialty, setCreatingSpecialty] = useState(false);

  // Delete — deferred flow, mirrors PositionsTable. removeSpecialty
  // dry-runs: a clean 204 → ring (optimistic removal + enqueue); a 409 WITH
  // the dependency tree → DeleteDialog (blocked «Услуги: N» / staff-only
  // «потеряют направление»). Toasts on success come from the pending stack
  // («Удалено. Отменить» with the countdown ring).
  const { removeSpecialty, removeSpecialtyResolved } = useDeleteSpecialty();
  const [deleteTarget, setDeleteTarget] = useState<{
    specialty: SpecialtyResponse;
    deps: DependencyNode[];
  } | null>(null);

  const handleDelete = useCallback(async (specialty: SpecialtyResponse) => {
    try {
      await removeSpecialty(specialty);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.dependencies) {
        setDeleteTarget({ specialty, deps: err.dependencies });
        return;
      }
      // Non-409 dry-run errors keep their EXISTING toast surface —
      // parseApiError maps SPECIALTY_NOT_FOUND / SPECIALTY_TITLE_TAKEN to
      // the CODE_DEFAULTS copies.
      showToast(
        err instanceof Error
          ? parseApiError(err).message
          : 'Не удалось удалить. Попробуйте ещё раз.',
        'error',
      );
    }
  }, [removeSpecialty, showToast]);

  // ─── Handlers ───────────────────────────────────────────────────────────

  const handleRename = async (data: Record<string, unknown>) => {
    if (!editSpecialty) return;
    try {
      // PATCH carries the title only — rename is the sole write surface.
      await updateSpecialty.mutateAsync({
        id: editSpecialty.id,
        data: { title: String(data.title ?? '') },
      });
      showToast('Направление обновлено');
      setEditSpecialty(null);
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  const handleCreateSubmit = async (data: Record<string, unknown>) => {
    try {
      await createSpecialty.mutateAsync({ title: String(data.title ?? '') });
      showToast('Направление создано');
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // §6.15 — memoize the factory outputs; handleDelete is a stable
  // useCallback (removeSpecialty identity is stable), so the actions memo
  // recomputes only when it actually changes.
  const columns = useMemo(() => specialtyColumns(), []);
  const actions = useMemo(
    () =>
      specialtyActions({
        onEdit: (s) => setEditSpecialty(s),
        onDelete: (s) => void handleDelete(s),
      }),
    [handleDelete],
  );

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div>
      <DataTable<SpecialtyResponse>
        storageKey="specialties-columns"
        columns={columns}
        tableState={specialtiesTable}
        actions={actions}
        onRowClick={setEditSpecialty}
        rowKey={(s) => s.id}
        rowTestId={(s) => `specialty-row-${s.id}`}
        rowClassName={() => 'hover:opacity-80'}
        toolbarExtras={
          <button
            onClick={() => setCreatingSpecialty(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            + Добавить направление
          </button>
        }
      />

      {/* Rename modal */}
      {editSpecialty && (
        <SpecialtyModal
          specialty={editSpecialty}
          onSubmit={handleRename}
          onClose={() => setEditSpecialty(null)}
          title="Редактирование направления"
          subtitle={editSpecialty.title}
        />
      )}

      {/* Create modal */}
      {creatingSpecialty && (
        <SpecialtyModal
          specialty={null}
          onSubmit={handleCreateSubmit}
          onClose={() => setCreatingSpecialty(false)}
          title="Новое направление"
        />
      )}

      {/* Delete dialog — opened on dry-run 409; the TREE decides the mode:
          the services node blocks (Mode B, acknowledgment only — nothing is
          ever enqueued from it), the staff-only tree confirms into the
          cascade deferred delete (enqueue is synchronous, the dialog closes
          immediately via onDone). */}
      {deleteTarget && (
        <DeleteDialog
          entityName={deleteTarget.specialty.title}
          entityType="specialty"
          entityId={deleteTarget.specialty.id}
          dependencies={deleteTarget.deps}
          onResolve={async (_id, resolutions) => {
            // Enqueue is synchronous — no await, the dialog closes at once.
            void removeSpecialtyResolved(deleteTarget.specialty, resolutions, deleteTarget.deps);
          }}
          onArchive={async () => { /* specialties have no archive flow — never Mode B-archive */ }}
          onDone={() => setDeleteTarget(null)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
