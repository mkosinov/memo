'use client';

import React, { useCallback, useMemo, useState } from 'react';
import type { MaterialResponse, MaterialUpdate, DependencyNode } from '@memo/api-client';
import { ApiError } from '@memo/api-client';
import { useUpdateMaterial, useCreateMaterial, useDeleteMaterial, useArchiveMaterial, useRestoreMaterial } from '@/hooks/useMaterialsMutations';
import { useUI } from '@/contexts/UIContext';
import { useMaterialsTable } from '@/contexts/MaterialsContext';
import { MaterialModal } from './MaterialModal';
import { ServiceFilters } from './ServiceFilters';
import { DataTable } from '@/app/components/shared/DataTable';
import { DeleteDialog } from '@/app/components/DeleteDialog';
import { materialColumns, materialActions } from './materialColumns';
import { parseApiError } from '@/app/lib/api/parseApiError';

// ─── Component ────────────────────────────────────────────────────────────

export function MaterialsTable() {
  // Server pagination/sort/search state (MaterialsContext, #205 §5.2 + #139 §6.7)
  const materialsTable = useMaterialsTable();

  const updateMaterial = useUpdateMaterial();
  const createMaterial = useCreateMaterial();
  const { removeMaterial, removeMaterialResolved } = useDeleteMaterial();
  const archiveMaterial = useArchiveMaterial();
  const restoreMaterial = useRestoreMaterial();
  const { showToast } = useUI();

  // ─── Edit modal state ───────────────────────────────────────────────
  const [editingMaterial, setEditingMaterial] = useState<MaterialResponse | null>(null);

  // ─── Create modal state ─────────────────────────────────────────────
  const [creatingMaterial, setCreatingMaterial] = useState(false);

  // ─── Delete dialog state (§7.3: parent owns dry-run + open/close) ────
  const [deleteTarget, setDeleteTarget] = useState<{
    material: MaterialResponse;
    dependencies: DependencyNode[];
  } | null>(null);

  // ─── Edit handlers ──────────────────────────────────────────────────

  const handleEditSubmit = async (data: Record<string, unknown>) => {
    if (!editingMaterial) return;
    // Canonical PUT (GH #178): full typed MaterialUpdate — every field listed.
    // #207: the Update schema carries no archive flag — archive/restore goes
    // through POST /materials/{id}/archive|restore, so PUT never flips it.
    const payload: MaterialUpdate = {
      title: data.title as string,
      description: (data.description as string | null | undefined) ?? '',
    };
    try {
      await updateMaterial.mutateAsync({ id: editingMaterial.id, data: payload });
      showToast('Материал обновлён');
      setEditingMaterial(null);
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // ─── Archive / Restore ──────────────────────────────────────────────
  // #207: dedicated POST endpoints; label and action drive off `row.archived`
  // (inverted response field).

  const handleArchiveToggle = async (material: MaterialResponse) => {
    try {
      if (material.archived) {
        await restoreMaterial.mutateAsync(material.id);
        showToast('Материал восстановлен');
      } else {
        await archiveMaterial.mutateAsync(material.id);
        showToast('Материал в архиве');
      }
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  const handleCreateSubmit = async (data: Record<string, unknown>) => {
    try {
      await createMaterial.mutateAsync(data as never);
      showToast('Материал создан');
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // ─── Delete (GH #345: deferred conveyor — useDeleteTag/useDeleteRecord
  // template). removeMaterial ALWAYS dry-runs (pure preview): an unlinked
  // material is clean (204) → row removed optimistically + the deferred
  // delete enqueued (5s undo window, commit = resolveDeleteMaterial); a
  // LINKED material rejects with 409 + the dependency tree (GH #223 §7)
  // → park the tree + open DeleteDialog Mode A (auto-only information
  // lines). The hook swallows 404 (quiet family invalidation) and
  // network/5xx («Не удалось проверить зависимости» toast) — the catch
  // below handles ONLY the 409-with-tree dialog path. Toasts on success
  // come from the pending stack («Удалено. Отменить» with the ring).

  const handleDelete = useCallback(async (m: MaterialResponse) => {
    try {
      await removeMaterial(m);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.dependencies) {
        setDeleteTarget({ material: m, dependencies: err.dependencies });
        return;
      }
      showToast(parseApiError(err).message, 'error');
    }
  }, [removeMaterial, showToast]);

  // §6.15 — memoize the factory outputs
  const columns = useMemo(() => materialColumns(), []);
  const actions = useMemo(
    () =>
      materialActions({
        onToggleArchive: (m) => void handleArchiveToggle(m),
        onDelete: (m) => void handleDelete(m),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- §6.15 stable identity
    [],
  );

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div>
      <DataTable<MaterialResponse>
        storageKey="materials-columns"
        columns={columns}
        tableState={materialsTable}
        actions={actions}
        onRowClick={setEditingMaterial}
        rowKey={(m) => m.id}
        // Pre-#139 row classes were `border-b cursor-pointer transition-colors
        // hover:opacity-80`; the shared DataTable renders the base three, the
        // hover style is entity-parity and comes through rowClassName.
        rowClassName={() => 'hover:opacity-80'}
        // Addendum #9: the dict *Filters bar rides in the toolbar's left group —
        // search rewired to context search/setSearch (§6.7 predicate-only),
        // status select already context-wired; bar UI/markup untouched.
        toolbarLead={
          <ServiceFilters
            search={materialsTable.search}
            status={materialsTable.status}
            onSearchChange={materialsTable.setSearch}
            onStatusChange={(v) => materialsTable.setStatus(v as 'active' | 'all' | 'archived')}
            onReset={() => { materialsTable.setSearch(''); materialsTable.setStatus('active'); }}
          />
        }
        toolbarExtras={
          <button
            onClick={() => setCreatingMaterial(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            + Добавить материал
          </button>
        }
      />

      {/* Edit Modal */}
      {editingMaterial && (
        <MaterialModal
          mode="edit"
          material={editingMaterial}
          onSubmit={handleEditSubmit}
          onClose={() => setEditingMaterial(null)}
          title="Редактировать материал"
          subtitle={editingMaterial.title}
        />
      )}

      {/* Create Modal */}
      {creatingMaterial && (
        <MaterialModal
          mode="create"
          material={null}
          onSubmit={handleCreateSubmit}
          onClose={() => setCreatingMaterial(false)}
          title="Новый материал"
        />
      )}

      {/* Delete dialog — GH #345: opened on dry-run 409 (linked material,
          GH #223); the confirm enqueues the cascade deferred delete
          (enqueue is synchronous) and the dialog closes immediately via
          onDone. Material matrix (§4.4): NO blocked state — the single
          `service_materials` node is auto-cascade, the tree is
          information-only; commit {resolutions:{}, expected:{}}. */}
      {deleteTarget && (
        <DeleteDialog
          entityName={deleteTarget.material.title}
          entityType="material"
          entityId={deleteTarget.material.id}
          dependencies={deleteTarget.dependencies}
          onResolve={async (_id, resolutions) => {
            // Enqueue is synchronous — no await, the dialog closes at once.
            void removeMaterialResolved(deleteTarget.material, resolutions, deleteTarget.dependencies);
          }}
          onArchive={(id) => archiveMaterial.mutateAsync(id)}
          onDone={() => setDeleteTarget(null)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
