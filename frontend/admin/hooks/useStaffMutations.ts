'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import {
  createStaff,
  updateStaff,
  archiveStaff,
  restoreStaff,
  patchUser,
  issuePasswordLink,
  dryRunDeleteStaff,
  resolveDeleteStaff,
  ApiError,
} from '@memo/api-client';
import type {
  StaffCreate,
  StaffUpdate,
  StaffArchiveRequest,
  DependencyNode,
  UserPhonePatch,
  PasswordLinkResponse,
  PaginatedResponse,
  StaffResponse,
} from '@memo/api-client';
import {
  createRowSnapshotSync,
  mapRowListCache,
  type RowSnapshot,
} from '@/lib/cache/rowSnapshotSync';
import { expectedFromDependencies } from '@/lib/expectedFromDependencies';
import { usePendingActions } from '@/contexts/PendingActionsContext';
import { useUI } from '@/contexts/UIContext';
import { invalidateEntities } from '@/lib/invalidate';
import { staleAwareOnError } from '@/lib/staleAwareOnError';
import { qk } from '@/lib/queryKeys';

// GH #266: every staff write invalidates the ['staff'] family, which the
// shared INVALIDATION_MAP fans out to ['staff'] + ['masters'] + ['records']
// (the read-only /masters view is staff ⨝ masters, and records render
// master_name/master_color from that join). One call site, one source of
// truth — never hand-list the cross-keys here (lib/invalidate.ts §4.1).

export function useCreateStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: StaffCreate) => createStaff(data),
    onSuccess: () => invalidateEntities(queryClient, ['staff']),
  });
}

export function useUpdateStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: StaffUpdate }) => updateStaff(id, data),
    onSuccess: () => invalidateEntities(queryClient, ['staff']),
  });
}


// ── #345 Task 6: deferred staff delete — the useDeleteTag (#318) /
// useDeleteRecord (#285) conveyor ──────────────────────────────────────────
//
// Both entry points are NON-BLOCKING deferred actions: the row disappears
// optimistically, the user gets a 5s undo window, the real DELETE runs in
// commit — carrying the `expected` state snapshot so the backend answers
// 409 `stale_dependencies` on a mid-window race.
//
// - `removeStaff` — clean path: item-level snapshots → dry-run
//   `?dry_run=true` (pure preview; 409 + dependency tree REJECTS upward —
//   the call site parks the tree + opens DeleteDialog) → optimistic row
//   removal → enqueue with `commit = resolveDeleteStaff(id, {expected: {}})`.
// - `removeStaffResolved` — cascade path after DeleteDialog confirmation:
//   no dry-run (the tree is already in hand); `expected` id-sets are built
//   from the FULL tree via the shared expectedFromDependencies (the staff
//   tree's nodes are auto/blocked and carry no items → expected {}); the
//   dialog closes immediately (enqueue is sync).
//
// Preview phase (§5.3): `isPending` gates the delete button (double click —
// ONE request, the in-flight guard skips re-entry); dry-run 404 → quiet
// family invalidation (the row leaves on refetch, no dialog, no toast);
// network/5xx → error toast «Не удалось проверить зависимости», page state
// unchanged. Both are swallowed INSIDE the hook — the call site's catch
// handles only the 409-with-tree dialog path.
//
// Commit errors go through the PendingActions pipeline — 404 = quiet
// success, the shared stale-aware handler owns every other failure (409
// `stale_dependencies` → undo + «Не удалось удалить: данные изменились»
// with «Обновить» invalidating the staff family); any other error → undo +
// generic error toast. Invalidation failures inside commit are non-fatal:
// the screen converges via SSE / next load.

/** Snapshot mechanics over the ['staff', …] family (paged envelope + bare
 *  lookup list — StaffContext factory + useStaff, shared key prefix). */
const staffRowSync = createRowSnapshotSync(qk.staff);

/** Staff cache shape: paged envelope ({items,…} — StaffContext factory) or
 *  a plain-array lookup list (useStaff). Shape-agnostic via mapRowListCache. */
type StaffListCache = StaffResponse[] | PaginatedResponse<StaffResponse>;

/** Prefix-wide removal from EVERY ['staff', …] cache (shape-agnostic).
 *  Used in commit as the reconcile safety net — it also catches caches that
 *  appeared or refetched during the undo window. */
function removeStaffFromCaches(qc: QueryClient, id: string): void {
  qc.setQueriesData<StaffListCache | undefined>(
    { queryKey: qk.staff },
    (old) =>
      old == null
        ? old
        : (mapRowListCache<StaffResponse>(old, (items) =>
            items.filter((s) => s.id !== id),
          ) as StaffListCache),
  );
}

/** Non-fatal invalidation at commit (spec §5.2): the staff family map
 *  (#239/#266) — ['staff'] + ['masters'] + ['records']. No point key:
 *  staff has no canonical single-entity cache. */
function invalidateAfterDelete(qc: QueryClient): void {
  invalidateEntities(qc, ['staff']);
}

/** Payload type for the execute path — `expected` is mandatory on the new
 *  contract (T5), resolutions optional (all-auto staff trees send {}). */
type ResolveDeleteStaffPayload = {
  expected: Record<string, string[]>;
  resolutions?: Record<string, string>;
};

/** Toast shower type derived from the UI context (the hook consumes useUI). */
type ShowToast = ReturnType<typeof useUI>['showToast'];

/** Structural mirror of PendingAction (imported type keeps this file
 *  provider-agnostic in tests that mock the context). */
interface PendingActionShape {
  id: string;
  kind: 'delete';
  message: string;
  delayMs: number;
  commit: () => Promise<void>;
  undo: () => void;
  onError?: (err: unknown) => void;
}

/** Shared commit body: real DELETE (with the expected-state contract) →
 *  removal reconcile → non-fatal invalidation. Errors propagate to the
 *  PendingActions pipeline (undo/toast handled there). */
async function commitDeferredDelete(
  qc: QueryClient,
  staffId: string,
  payload: ResolveDeleteStaffPayload,
  snapshots: RowSnapshot[],
): Promise<void> {
  await resolveDeleteStaff(staffId, payload);
  // Reconcile: ensure the captured keys still reflect the deletion even if
  // a mid-window refetch brought the row back.
  staffRowSync.remove(qc, snapshots);
  removeStaffFromCaches(qc, staffId);
  try {
    invalidateAfterDelete(qc);
  } catch {
    // Non-fatal: server state after 204 is authoritative, undo never
    // resurrects a server-deleted staff; SSE / next load converge.
  }
}

/** Shared enqueue shape (dedupe/cancel key + 5s window + by-key undo). */
function buildDeferredDeleteAction(
  qc: QueryClient,
  staff: StaffResponse,
  payload: ResolveDeleteStaffPayload,
  snapshots: RowSnapshot[],
  showToast: ShowToast,
): PendingActionShape {
  const undo = () => staffRowSync.restore(qc, snapshots);
  return {
    id: `delete-staff-${staff.id}`,
    kind: 'delete',
    message: 'Удалено. Отменить',
    delayMs: 5000,
    // Undo (§5.2): pure by-key restore — no server calls (the dry-run
    // guarantees nothing was deleted during the window), no invalidations.
    undo,
    commit: () => commitDeferredDelete(qc, staff.id, payload, snapshots),
    // Commit failures: 409+dependencies → undo + «Не удалось удалить:
    // данные изменились» with the «Обновить» action (staff family map);
    // 404 — quiet success; any other error — context-default (undo + toast).
    onError: staleAwareOnError(qc, 'staff', undo, showToast),
  };
}

/**
 * Deferred hard delete (GH #345): dry-run preview → optimistic removal →
 * 5s undo window → commit `resolveDeleteStaff({expected, resolutions?})`.
 * Staff matrix (#266): activities BLOCK; users, the masters row,
 * master_tags and staff_positions auto-cascade.
 */
export function useDeleteStaff() {
  const queryClient = useQueryClient();
  const { showToast } = useUI();
  const { enqueuePendingAction } = usePendingActions();
  const [isPending, setIsPending] = useState(false);
  // Synchronous re-entry guard (§5.3): `isPending` renders the button
  // disabled, but the state update lands after the tick — a second call
  // inside the same tick must consult the ref, not the closure state.
  const inFlightRef = useRef(false);

  /** Clean deferred delete: snapshots → dry-run → optimistic removal →
   *  enqueue (5s undo window; undo restores snapshots by key). */
  const removeStaff = useCallback(
    async (staff: StaffResponse): Promise<void> => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setIsPending(true);
      try {
        const snapshots = staffRowSync.capture(queryClient, staff.id);
        // Dry-run errors: 409-with-dependencies REJECTS upward (the call
        // site parks the tree + opens DeleteDialog — the row stays
        // visible). 404 → quiet family invalidation; network/5xx →
        // «Не удалось проверить зависимости» toast (§5.3) — both swallowed.
        try {
          await dryRunDeleteStaff(staff.id);
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            invalidateEntities(queryClient, ['staff']);
            return;
          }
          if (!(err instanceof ApiError && err.status === 409 && err.dependencies)) {
            showToast('Не удалось проверить зависимости', 'error');
            return;
          }
          throw err;
        }
        staffRowSync.remove(queryClient, snapshots);
        enqueuePendingAction(
          buildDeferredDeleteAction(
            queryClient,
            staff,
            { expected: {} },
            snapshots,
            showToast,
          ),
        );
      } finally {
        inFlightRef.current = false;
        setIsPending(false);
      }
    },
    [queryClient, enqueuePendingAction, showToast],
  );

  /** Cascade deferred delete: same enqueue mechanics, no dry-run — the
   *  DeleteDialog built `resolutions` from the 409 tree it already has.
   *  `expected` carries the id-sets snapshotted from that FULL tree. */
  const removeStaffResolved = useCallback(
    async (
      staff: StaffResponse,
      resolutions: Record<string, string>,
      dependencies: DependencyNode[],
    ): Promise<void> => {
      const snapshots = staffRowSync.capture(queryClient, staff.id);
      staffRowSync.remove(queryClient, snapshots);
      enqueuePendingAction(
        buildDeferredDeleteAction(
          queryClient,
          staff,
          { resolutions, expected: expectedFromDependencies(dependencies) },
          snapshots,
          showToast,
        ),
      );
    },
    [queryClient, enqueuePendingAction, showToast],
  );

  return { removeStaff, removeStaffResolved, isPending };
}

/**
 * Archive a staff card (#207) with the D6 dismissal checkboxes.
 * `checkboxes` = `{archive_master, archive_user}` — both default true on the
 * backend (a body-less call consents to the preselected dialog choice); the
 * dialog always sends an explicit body so the admin's choice is visible.
 * No hidden cascade: each flag applies only to an existing ACTIVE link.
 */
export function useArchiveStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...checkboxes }: { id: string } & StaffArchiveRequest) =>
      archiveStaff(id, checkboxes),
    onSuccess: () => invalidateEntities(queryClient, ['staff']),
  });
}

/** Restore an archived staff card (#207). Person only — master/user flags are explicit toggles (D3). */
export function useRestoreStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => restoreStaff(id),
    onSuccess: () => invalidateEntities(queryClient, ['staff']),
  });
}

// ─── Users vertical (#348 spec §5 — the «Учётка» block operations) ─────────

/**
 * Edit the linked account's phone (S5) — a SEPARATE write from the card's
 * own PUT: PATCH /users/:id with strictly {phone}. 422 PHONE_TAKEN /
 * PHONE_INVALID are DOMAIN outcomes the modal renders inline, so the
 * rejection PROPAGATES (as a typed ApiError) instead of toasting.
 */
export function usePatchUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UserPhonePatch }) => patchUser(id, data),
    onSuccess: () => invalidateEntities(queryClient, ['staff']),
  });
}

/**
 * Issue a one-time password-setup link (S1/S3). The RAW token surfaces
 * exactly once, here — the caller assembles the handover URL from the page
 * origin and shows it in the dialog; repeat viewing is impossible by
 * construction. Errors: 404 unknown account, 422 ACCOUNT_DEACTIVATED.
 *
 * Invalidation: the card's account block carries `link_expires_at` — a
 * fresh link must surface as «Ссылка выдана, действует до …» right away,
 * not on the next unrelated refresh.
 */
export function useIssuePasswordLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string): Promise<PasswordLinkResponse> => issuePasswordLink(id),
    onSuccess: () => invalidateEntities(queryClient, ['staff']),
  });
}
