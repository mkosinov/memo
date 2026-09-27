'use client';

import React, { useCallback, useMemo, useState } from 'react';
import type { StaffResponse, StaffCreate, StaffUpdate, StaffArchiveRequest, DependencyNode } from '@memo/api-client';
import { resolveDeleteStaff, ApiError } from '@memo/api-client';
import { useQueryClient } from '@tanstack/react-query';
import {
  useUpdateStaff,
  useCreateStaff,
  useDeleteStaff,
  useArchiveStaff,
  useRestoreStaff,
  usePatchUser,
  useIssuePasswordLink,
} from '@/hooks/useStaffMutations';
import { usePositions } from '@/hooks/usePositions';
import { useUI } from '@/contexts/UIContext';
import { useStaffTable } from '@/contexts/StaffContext';
import { displayMasterName } from '@/lib/utils';
import { StaffModal, type StaffFormData } from './StaffModal';
import { PasswordLinkDialog, type IssuedPasswordLink } from './PasswordLinkDialog';
import { StaffFilters } from './StaffFilters';
import { ArchiveStaffDialog } from './ArchiveStaffDialog';
import { DataTable } from '@/app/components/shared/DataTable';
import { DeleteDialog } from '@/app/components/DeleteDialog';
import { staffColumns, staffActions } from './staffColumns';
import { parseApiError } from '@/app/lib/api/parseApiError';
import { invalidateEntities } from '@/lib/invalidate';

// ─── Component ───────────────────────────────────────────────────────────

/**
 * StaffTable — the «Сотрудники» directory screen (GH #266). Replaces the
 * pre-#266 MastersTable: rows are staff cards (person + optional master
 * section + position ids + has_user), reads come from GET /api/v1/staff via
 * StaffContext (server pagination/sort/search), writes go through the staff
 * mutation family. The read-only /masters view (schedule filters) is a
 * SEPARATE concern (MastersContext) and is untouched here.
 */
export function StaffTable() {
  // Server pagination/sort/search state (StaffContext, #205 §5.2 + #212).
  const staffTable = useStaffTable();

  const { data: positions = [] } = usePositions();

  const updateStaff = useUpdateStaff();
  const createStaff = useCreateStaff();
  const deleteStaff = useDeleteStaff();
  const archiveStaff = useArchiveStaff();
  const restoreStaff = useRestoreStaff();
  // #348: users-vertical ops for the «Учётка» block (S1/S3/S5).
  const patchUser = usePatchUser();
  const issuePasswordLink = useIssuePasswordLink();
  const queryClient = useQueryClient();
  const { showToast } = useUI();

  // ─── Edit modal state ────────────────────────────────────────────────
  const [editStaff, setEditStaff] = useState<StaffResponse | null>(null);

  // ─── Create modal state ─────────────────────────────────────────────
  const [creating, setCreating] = useState(false);

  // ─── Archive (D6) dialog state ──────────────────────────────────────
  const [archiveTarget, setArchiveTarget] = useState<StaffResponse | null>(null);

  // ─── Delete dialog state (§7.3: parent owns dry-run + open/close) ────
  const [deleteTarget, setDeleteTarget] = useState<{
    staff: StaffResponse;
    dependencies: DependencyNode[];
  } | null>(null);

  // position id → title (D4); unknown ids fall back to the raw id.
  const positionTitle = useCallback(
    (id: string) => positions.find((p) => p.id === id)?.title ?? id,
    [positions],
  );

  // ─── #348: one-time link issuance corridor (S1 post-create / S3 block) ──
  // The table owns the handover dialog so it stays visible after the create
  // modal closes; the edit-block button routes through the modal's own
  // dialog via `issueLinkForModal`.
  const [linkDialog, setLinkDialog] = useState<{
    link: IssuedPasswordLink | null;
    error: string | null;
    retryUserId: string | null;
  } | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);

  const issueFor = async (userId: string): Promise<void> => {
    setLinkBusy(true);
    try {
      const link = await issuePasswordLink.mutateAsync(userId);
      setLinkDialog({ link, error: null, retryUserId: null });
    } catch (err) {
      setLinkDialog({
        link: null,
        error: parseApiError(err).message,
        retryUserId: userId,
      });
    } finally {
      setLinkBusy(false);
    }
  };

  // Shared prop for the modals: returns the link for the dialog THEY render
  // (the edit-block issuance stays inside the modal; its errors surface there).
  const issueLinkForModal = useCallback(
    async (userId: string): Promise<IssuedPasswordLink> => {
      const link = await issuePasswordLink.mutateAsync(userId);
      return { token: link.token, expires_at: link.expires_at };
    },
    [issuePasswordLink],
  );

  // #348 S5: the modal hands the CHANGED phone here; the typed ApiError
  // propagates back so the modal renders the PHONE_TAKEN inline error.
  const handlePatchUserPhone = useCallback(
    async (userId: string, phone: string): Promise<void> => {
      try {
        await patchUser.mutateAsync({ id: userId, data: { phone } });
        showToast('Телефон учётки обновлён');
      } catch (err) {
        throw err instanceof ApiError ? err : new ApiError(0, parseApiError(err).message);
      }
    },
    [patchUser],
  );

  // ─── Create / Edit submit ────────────────────────────────────────────
  // The modal yields a structured StaffFormData; map it onto the typed wire
  // schemas here (tsc fails on a missing/extra field — canonical PUT, GH #178).
  // The person archive is NEVER set via PUT (#207): lifecycle goes through the
  // archive/restore POST endpoints, so editing an archived card can't
  // resurrect it.

  const handleCreateSubmit = async (data: StaffFormData) => {
    const payload: StaffCreate = {
      first_name: data.first_name,
      last_name: data.last_name,
      avatar_url: data.avatar_url ?? '',
      sort_order: data.sort_order,
      master: data.master ? { specialty: data.master.specialty, color: data.master.color } : null,
      position_ids: data.position_ids,
      // D6/#348: create-only account flag — passwordless {phone, role?} | false;
      // D10: role — a sent value beats the backend position template.
      create_user: data.create_user,
    };
    let created: StaffResponse;
    try {
      created = await createStaff.mutateAsync(payload);
      showToast('Сотрудник создан');
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
      throw err; // let the modal keep its state open
    }
    // #348 S1: the account was just born passwordless — issue its FIRST
    // setup link right away (a separate request). Failure is NOT a create
    // failure: the error dialog offers «Повторить», and the account waits
    // for the block button. Awaiting keeps the modal open until the link
    // is on screen — the admin must not miss the one-time URL.
    if (created.account && created.account.is_active) {
      await issueFor(created.account.id);
    }
  };

  const handleEdit = async (data: StaffFormData) => {
    if (!editStaff) return;
    const payload: StaffUpdate = {
      first_name: data.first_name,
      last_name: data.last_name,
      avatar_url: data.avatar_url ?? '',
      sort_order: data.sort_order,
      // `archived` (Gap A) toggles the section's schedule flag WITHOUT
      // deleting the row (D7); `null` removes the section (blocked by
      // activities server-side).
      master: data.master
        ? {
            specialty: data.master.specialty,
            color: data.master.color,
            ...(data.master.archived !== undefined ? { archived: data.master.archived } : {}),
          }
        : null,
      position_ids: data.position_ids,
      // D10: manual role override for the linked account — sent only when the
      // field has a value; absent → the backend position template decides.
      ...(data.role !== undefined ? { role: data.role } : {}),
    };
    try {
      await updateStaff.mutateAsync({ id: editStaff.id, data: payload });
      showToast('Сотрудник обновлён');
      setEditStaff(null);
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
      throw err;
    }
  };

  // ─── Archive (D6 dialog) / Restore ───────────────────────────────────
  // Archive opens the dismissal dialog (preselected checkboxes); restore is a
  // one-click action (the person only — master/user flags are explicit, D3).

  const handleArchiveConfirm = async (checkboxes: StaffArchiveRequest) => {
    if (!archiveTarget) return;
    try {
      await archiveStaff.mutateAsync({ id: archiveTarget.id, ...checkboxes });
      showToast('Сотрудник архивирован');
      setArchiveTarget(null);
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
      throw err; // dialog stays open, shows the error
    }
  };

  const handleRestore = async (s: StaffResponse) => {
    try {
      await restoreStaff.mutateAsync(s.id);
      showToast('Сотрудник возвращён из архива');
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // ─── Delete (GH #207 §7.3 dry-run flow) ──────────────────────────────
  // no-body DELETE → 204 (instant, no deps) or 409 + dependency tree →
  // DeleteDialog (Mode A/B). Staff matrix (#266): activities BLOCK; users,
  // the masters row, master_tags and staff_positions auto-cascade.

  const handleDelete = async (s: StaffResponse) => {
    try {
      await deleteStaff.mutateAsync(s.id);
      showToast('Сотрудник удалён');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.dependencies) {
        setDeleteTarget({ staff: s, dependencies: err.dependencies });
      } else {
        showToast(parseApiError(err).message, 'error');
      }
    }
  };

  // §6.15 — memoize the factory outputs.
  const columns = useMemo(() => staffColumns(positionTitle), [positionTitle]);
  const actions = useMemo(
    () =>
      staffActions({
        onArchive: (s) => setArchiveTarget(s),
        onRestore: (s) => void handleRestore(s),
        onDelete: (s) => void handleDelete(s),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- §6.15 stable identity
    [],
  );

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div>
      <DataTable<StaffResponse>
        storageKey="staff-columns"
        columns={columns}
        tableState={staffTable}
        actions={actions}
        onRowClick={setEditStaff}
        rowKey={(s) => s.id}
        // DoD: the master-row-* testid is preserved across the move (staff.id
        // == master.id for sectioned cards; seed ids m1–m5, m7). Schedule e2e
        // and visual baselines anchor on this.
        rowTestId={(s) => `master-row-${s.id}`}
        rowClassName={() => 'hover:opacity-80'}
        toolbarLead={
          <StaffFilters
            search={staffTable.search}
            status={staffTable.status}
            onSearchChange={staffTable.setSearch}
            onStatusChange={(v) => staffTable.setStatus(v as 'active' | 'all' | 'archived')}
            onReset={() => { staffTable.setSearch(''); staffTable.setStatus('active'); }}
          />
        }
        toolbarExtras={
          <button
            onClick={() => setCreating(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            + Добавить сотрудника
          </button>
        }
      />

      {/* Edit modal */}
      {editStaff && (
        <StaffModal
          mode="edit"
          staff={editStaff}
          positions={positions}
          onSubmit={handleEdit}
          onPatchPhone={handlePatchUserPhone}
          onIssueLink={issueLinkForModal}
          onClose={() => setEditStaff(null)}
          title="Редактирование сотрудника"
          subtitle={displayMasterName(editStaff)}
        />
      )}

      {/* Create modal */}
      {creating && (
        <StaffModal
          mode="create"
          staff={null}
          positions={positions}
          onSubmit={handleCreateSubmit}
          onClose={() => setCreating(false)}
          title="Новый сотрудник"
        />
      )}

      {/* #348 S1: post-create one-time link handover (the table owns it so it
          stays visible after the create modal closes). */}
      {linkDialog && (
        <PasswordLinkDialog
          link={linkDialog.link}
          error={linkDialog.error}
          busy={linkBusy}
          onRetry={() => {
            if (linkDialog.retryUserId) void issueFor(linkDialog.retryUserId);
          }}
          onClose={() => setLinkDialog(null)}
        />
      )}

      {/* Archive (D6) dialog — preselected master/account checkboxes */}
      {archiveTarget && (
        <ArchiveStaffDialog
          staff={archiveTarget}
          onConfirm={handleArchiveConfirm}
          onClose={() => setArchiveTarget(null)}
        />
      )}

      {/* Delete dialog — §7.3: opened on dry-run 409, closed on done/cancel */}
      {deleteTarget && (
        <DeleteDialog
          entityName={displayMasterName(deleteTarget.staff)}
          entityType="staff"
          entityId={deleteTarget.staff.id}
          dependencies={deleteTarget.dependencies}
          onResolve={async (id, resolutions) => {
            await resolveDeleteStaff(id, resolutions);
            // The resolve call bypasses the hook's onSuccess, so refresh here.
            // Family rules via the shared map (#239/#266): ['staff'] +
            // ['masters'] + ['records'].
            invalidateEntities(queryClient, ['staff']);
            showToast('Сотрудник удалён');
          }}
          onArchive={async (id) => archiveStaff.mutateAsync({ id, archive_master: true, archive_user: true })}
          onDone={() => setDeleteTarget(null)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
