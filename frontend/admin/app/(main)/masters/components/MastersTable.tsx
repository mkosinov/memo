'use client';

import React, { useMemo, useState } from 'react';
import type { MasterResponse } from '@memo/api-client';
import { useUpdateMaster, useCreateMaster, useDeleteMaster, useArchiveMaster, useRestoreMaster } from '@/hooks/useMastersMutations';
import type { MasterUpdate, DependencyNode } from '@memo/api-client';
import { resolveDeleteMaster, ApiError } from '@memo/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useUI } from '@/contexts/UIContext';
import { useMastersTable } from '@/contexts/MastersContext';
import { displayMasterName } from '@/lib/utils';
import { MasterModal } from './MasterModal';
import { MasterFilters } from './MasterFilters';
import { DataTable } from '@/app/components/shared/DataTable';
import { DeleteDialog } from '@/app/components/DeleteDialog';
import { masterColumns, masterActions } from './masterColumns';
import { parseApiError } from '@/app/lib/api/parseApiError';

// ─── Component ───────────────────────────────────────────────────────────

export function MastersTable() {
  // Server pagination/sort/search state (MastersContext, #205 §5.2 + #139 §6.7)
  const mastersTable = useMastersTable();

  const updateMaster = useUpdateMaster();
  const createMaster = useCreateMaster();
  const deleteMaster = useDeleteMaster();
  const archiveMaster = useArchiveMaster();
  const restoreMaster = useRestoreMaster();
  const queryClient = useQueryClient();
  const { showToast } = useUI();

  // ─── Edit modal state ────────────────────────────────────────────────
  const [editMaster, setEditMaster] = useState<MasterResponse | null>(null);

  // ─── Create modal state ─────────────────────────────────────────────
  const [creatingMaster, setCreatingMaster] = useState(false);

  // ─── Delete dialog state (§7.3: parent owns dry-run + open/close) ────
  const [deleteTarget, setDeleteTarget] = useState<{
    master: MasterResponse;
    dependencies: DependencyNode[];
  } | null>(null);

  // ─── Edit handlers ───────────────────────────────────────────────────

  const handleEdit = async (data: Record<string, unknown>) => {
    if (!editMaster) return;
    // Canonical PUT (GH #178): every MasterUpdate field listed — tsc fails on
    // missing/extra fields. Form values are untyped → per-field extraction;
    // null optionals coerce to the Create default (backend does the same).
    // #207: the Update schema carries no archive flag — archive/restore goes
    // through POST /masters/{id}/archive|restore, so PUT never flips it.
    const payload: MasterUpdate = {
      first_name: data.first_name as string,
      last_name: data.last_name as string,
      color: data.color as string,
      position: data.position as MasterUpdate['position'],
      specialty: data.specialty as MasterUpdate['specialty'],
      avatar_url: (data.avatar_url as string | null | undefined) ?? '',
    };
    try {
      await updateMaster.mutateAsync({
        id: editMaster.id,
        data: payload,
      });
      showToast('Мастер обновлён');
      setEditMaster(null);
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // ─── Archive / Restore ───────────────────────────────────────────────
  // #207: dedicated POST endpoints (also cascade to the linked user's
  // is_active server-side, §4.2 — transparent to the frontend). Label and
  // action drive off `row.archived` (inverted response field).

  const handleArchiveToggle = async (master: MasterResponse) => {
    try {
      if (master.archived) {
        await restoreMaster.mutateAsync(master.id);
        showToast('Мастер восстановлен');
      } else {
        await archiveMaster.mutateAsync(master.id);
        showToast('Мастер архивирован');
      }
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  const handleCreateSubmit = async (data: Record<string, unknown>) => {
    const payload: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(data)) {
      if (val !== null && val !== undefined) {
        payload[key] = val;
      }
    }
    try {
      await createMaster.mutateAsync(payload as never);
      showToast('Мастер создан');
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // ─── Delete ─────────────────────────────────────────────────────────
  // #207 §7.3 dry-run flow: no-body DELETE → 204 (instant delete, no deps)
  // or 409 + dependency tree → DeleteDialog (Mode A/B). The parent owns the
  // call + open/close state; the dialog receives the parsed tree.

  const handleDelete = async (master: MasterResponse) => {
    try {
      await deleteMaster.mutateAsync(master.id);
      // 204 — already deleted (zero deps): refresh handled by the hook.
      showToast('Мастер удалён');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.dependencies) {
        setDeleteTarget({ master, dependencies: err.dependencies });
      } else {
        showToast(parseApiError(err).message, 'error');
      }
    }
  };

  // §6.15 — memoize the factory outputs
  const columns = useMemo(() => masterColumns(), []);
  const actions = useMemo(
    () =>
      masterActions({
        onToggleArchive: (m) => void handleArchiveToggle(m),
        onDelete: (m) => void handleDelete(m),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- §6.15 stable identity
    [],
  );

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div>
      <DataTable<MasterResponse>
        storageKey="masters-columns"
        columns={columns}
        tableState={mastersTable}
        actions={actions}
        onRowClick={setEditMaster}
        rowKey={(m) => m.id}
        rowTestId={(m) => `master-row-${m.id}`}
        // Pre-#139 row classes were `border-b cursor-pointer transition-colors
        // hover:opacity-80`; the shared DataTable renders the base three, the
        // hover style is entity-parity and comes through rowClassName.
        rowClassName={() => 'hover:opacity-80'}
        // Addendum #9: the dict *Filters bar rides in the toolbar's left group —
        // search rewired to context search/setSearch (§6.7 predicate-only),
        // status select already context-wired; bar UI/markup untouched.
        toolbarLead={
          <MasterFilters
            search={mastersTable.search}
            status={mastersTable.status}
            onSearchChange={mastersTable.setSearch}
            onStatusChange={(v) => mastersTable.setStatus(v as 'active' | 'all' | 'archived')}
            onReset={() => { mastersTable.setSearch(''); mastersTable.setStatus('active'); }}
          />
        }
        toolbarExtras={
          <button
            onClick={() => setCreatingMaster(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            + Добавить мастера
          </button>
        }
      />

      {/* Edit modal */}
      {editMaster && (
        <MasterModal
          mode="edit"
          master={editMaster}
          onSubmit={handleEdit}
          onClose={() => setEditMaster(null)}
          title="Редактирование мастера"
          subtitle={`${editMaster.first_name} ${editMaster.last_name}`}
        />
      )}

      {/* Create modal */}
      {creatingMaster && (
        <MasterModal
          mode="create"
          master={null}
          onSubmit={handleCreateSubmit}
          onClose={() => setCreatingMaster(false)}
          title="Новый мастер"
        />
      )}

      {/* Delete dialog — §7.3: opened on dry-run 409, closed on done/cancel */}
      {deleteTarget && (
        <DeleteDialog
          entityName={displayMasterName(deleteTarget.master)}
          entityType="master"
          entityId={deleteTarget.master.id}
          dependencies={deleteTarget.dependencies}
          onResolve={async (id, resolutions) => {
            await resolveDeleteMaster(id, resolutions);
            // The resolve call bypasses the hook's onSuccess, so refresh
            // here — incl. cross-key ['records'] (useRecordData consumers).
            queryClient.invalidateQueries({ queryKey: ['masters'] });
            queryClient.invalidateQueries({ queryKey: ['records'] });
            showToast('Мастер удалён');
          }}
          onArchive={(id) => archiveMaster.mutateAsync(id)}
          onDone={() => setDeleteTarget(null)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
