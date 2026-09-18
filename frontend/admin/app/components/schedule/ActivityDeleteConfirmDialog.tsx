'use client';

import { useScheduleData } from '@/contexts/schedule/ScheduleDataContext';
import { useUI } from '@/contexts/UIContext';
import { parseApiError } from '@/app/lib/api/parseApiError';
import { DeleteDialog } from '@/app/components/DeleteDialog';

// ─── ActivityDeleteConfirmDialog (#286 Task 6 — DeleteDialog host) ────────────
//
// Thin wrapper: the pending-confirm MECHANISM lives in ScheduleDataContext
// (`pendingActivityConfirm`, set by ActivityCard / ActivityDetailsModal on
// the needs-confirm dry-run outcome), and THIS component mounts the shared
// DeleteDialog at WeekView/DayView level — so it survives the card's
// optimistic unmount and the modal's immediate close.
//
// Contract (plan Task 6 / spec D3):
//   * entityType 'activity' — the pending state carries only the id, so the
//     dialog renders the plain genitive title «Удаление занятия»;
//   * `refetched` → the refetchNote banner («Карточка обновлена по данным
//     сервера»); the clean prime shows nothing;
//   * onResolve = the SYNCHRONOUS enqueue — deleteActivityConfirmed builds
//     `expected` from the FULL tree items (the display-cap is cosmetics) and
//     the PendingActions pipeline owns the real DELETE. The dialog's
//     busy/error branches never engage: an EARLY rejection surfaces via the
//     same call-site error path as the card/modal (parseApiError → error
//     toast) while the dialog stays closed (onDone fires right after);
//   * onDone = close ONLY — no invalidation (a refetch would resurrect the
//     card inside the undo window);
//   * every activity dep is a cascade with a single allowed action, so there
//     is no resolution choice (the dialog's one entity-level checkbox gates
//     the confirm) and the Mode B archive branch never renders.

const REFETCH_NOTE = 'Карточка обновлена по данным сервера';

export function ActivityDeleteConfirmDialog() {
  const {
    pendingActivityConfirm,
    deleteActivityConfirmed,
    setPendingActivityConfirm,
  } = useScheduleData();
  const { showToast } = useUI();

  if (!pendingActivityConfirm) return null;

  const { activityId, dependencies, refetched } = pendingActivityConfirm;

  return (
    <DeleteDialog
      entityName=""
      entityType="activity"
      entityId={activityId}
      dependencies={dependencies}
      refetchNote={refetched ? REFETCH_NOTE : undefined}
      onResolve={async () => {
        // Snapshot-free enqueue — the confirm already carries the confirmed
        // dry-run tree. Never rejects upward: the error toast is the same
        // surface the card/modal call sites use.
        try {
          await deleteActivityConfirmed(activityId, dependencies);
        } catch (err) {
          showToast(parseApiError(err).message, 'error');
        }
      }}
      onArchive={async () => {
        /* activities have no archive flow — Mode B is unreachable (every
           activity dep carries allowed_actions) */
      }}
      onDone={() => setPendingActivityConfirm(null)}
      onCancel={() => setPendingActivityConfirm(null)}
    />
  );
}
