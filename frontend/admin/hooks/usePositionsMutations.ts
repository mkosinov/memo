'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import {
  createPosition,
  updatePosition,
  dryRunDeletePosition,
  resolveDeletePosition,
} from '@memo/api-client';
import type {
  DependencyNode,
  PaginatedResponse,
  PositionCreate,
  PositionResponse,
  PositionUpdate,
  ResolveDeletePositionPayload,
} from '@memo/api-client';
import {
  createRowSnapshotSync,
  mapRowListCache,
  type RowSnapshot,
} from '@/lib/cache/rowSnapshotSync';
import { usePendingActions } from '@/contexts/PendingActionsContext';
import { useUI } from '@/contexts/UIContext';
import { staleAwareOnError } from '@/lib/staleAwareOnError';
import { qk } from '@/lib/queryKeys';

/**
 * Positions dictionary mutations (GH #266 T9, spec D4; delete → #324 §6).
 *
 * Invalidation goes DIRECTLY at the ['positions'] prefix instead of through
 * lib/invalidate.ts INVALIDATION_MAP: `positions` is deliberately absent from
 * that map (spec «SSE-сущности» — the backend emits the entity, the frontend
 * SSE mirror skips it, and the drift guard __tests__/invalidate.test.ts pins
 * the absence). react-query prefix matching then covers BOTH cache
 * granularities in one call: the /all lookup (usePositions → StaffModal
 * checkboxes + StaffTable cells) and the paged table key
 * (['positions', page, perPage] — PositionsContext).
 */

export function useCreatePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: PositionCreate) => createPosition(data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.positions }),
  });
}

export function useUpdatePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: PositionUpdate }) => updatePosition(id, data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.positions }),
  });
}

// ── #324 deferred position delete (spec §6) — mirrors useDeleteTag (#318) ───
//
// Same NON-BLOCKING deferred contract as tags/photos: optimistic removal →
// 5s undo window → the real DELETE in commit with the `expected` snapshot.
//
// - `removePosition` — clean path: snapshots → dry-run ?dry_run=true.
//   SYSTEM positions answer 422 POSITION_IS_SYSTEM from the DRY-RUN itself
//   (server-side guard before the fork) — the hook does NOT intercept it:
//   the ApiError propagates upward, the call site surfaces the explanation
//   toast, NOTHING is enqueued. 409 (busy) also rejects upward → the call
//   site opens DeleteDialog («Сотрудники: N потеряют должность»).
// - `removePositionResolved` — cascade path after DeleteDialog confirmation:
//   expected = {staff_positions: [staff ids]} from the tree's items; the
//   staff cards SURVIVE (the join rows die).
//
// Error surface (D4 family): commit errors go through the PendingActions
// pipeline — 404 = quiet success; the shared stale-aware handler (the
// EXPLICIT-PREFIX overload — positions has no INVALIDATION_MAP entry) owns
// the rest: 409 stale → undo + «Не удалось удалить: данные изменились» with
// «Обновить» invalidating ['positions'].

/** Snapshot mechanics over the ['positions', …] family — both granularities
 *  (the /all lookup list + the paged envelope) via the shared factory. */
const positionRowSync = createRowSnapshotSync(qk.positions);

/** expected = id-sets per entity from the dialog tree's `items` (D6). */
function expectedFromDependencies(
  dependencies: DependencyNode[],
): Record<string, string[]> {
  const expected: Record<string, string[]> = {};
  for (const node of dependencies) {
    if (!node.items) continue;
    expected[node.entity] = node.items.map((item) => item.id);
  }
  return expected;
}

/** Positions cache shapes: the /all bare array + the paged envelope. */
type PositionsListCache = PositionResponse[] | PaginatedResponse<PositionResponse>;

/** Prefix-wide removal from EVERY ['positions', …] cache (shape-agnostic) —
 *  the commit-time reconcile safety net. */
function removePositionFromCaches(qc: QueryClient, id: string): void {
  qc.setQueriesData<PositionsListCache | undefined>(
    { queryKey: qk.positions },
    (old) =>
      old == null
        ? old
        : (mapRowListCache<PositionResponse>(old, (items) =>
            items.filter((p) => p.id !== id),
          ) as PositionsListCache),
  );
}

/** Non-fatal invalidation at commit: the ['positions'] prefix only. */
function invalidateAfterDelete(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: qk.positions });
}

/** Shared commit body: real DELETE (with the expected-state contract) →
 *  removal reconcile → non-fatal invalidation. Errors propagate to the
 *  PendingActions pipeline (undo/toast handled there). */
async function commitDeferredDelete(
  qc: QueryClient,
  positionId: string,
  payload: ResolveDeletePositionPayload,
  snapshots: RowSnapshot[],
): Promise<void> {
  await resolveDeletePosition(positionId, payload);
  positionRowSync.remove(qc, snapshots);
  removePositionFromCaches(qc, positionId);
  try {
    invalidateAfterDelete(qc);
  } catch {
    // Non-fatal: server state after 204 is authoritative.
  }
}

/** Toast shower type derived from the UI context (the hook consumes useUI). */
type ShowToast = ReturnType<typeof useUI>['showToast'];

/** Shared enqueue shape (dedupe/cancel key + 5s window + by-key undo). */
function buildDeferredDeleteAction(
  qc: QueryClient,
  position: PositionResponse,
  payload: ResolveDeletePositionPayload,
  snapshots: RowSnapshot[],
  showToast: ShowToast,
): PendingActionShape {
  const undo = () => positionRowSync.restore(qc, snapshots);
  return {
    id: `delete-position-${position.id}`,
    kind: 'delete',
    message: 'Удалено. Отменить',
    delayMs: 5000,
    undo,
    commit: () => commitDeferredDelete(qc, position.id, payload, snapshots),
    // D4 family: the shared stale-aware handler, EXPLICIT-PREFIX overload —
    // positions has no INVALIDATION_MAP entry (drift-guarded), so the
    // ['positions'] family travels directly.
    onError: staleAwareOnError(qc, qk.positions, undo, showToast),
  };
}

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

/**
 * Deferred position delete (#324). Built-ins (is_system) are refused by the
 * SERVER from the dry-run itself (422 POSITION_IS_SYSTEM) — the hook never
 * second-guesses which rows are protected; the ApiError rejects upward and
 * the call site surfaces the explanation as an error toast (D4).
 */
export function useDeletePosition() {
  const queryClient = useQueryClient();
  const { showToast } = useUI();
  const { enqueuePendingAction } = usePendingActions();

  /** Clean deferred delete: snapshots → dry-run → optimistic removal →
   *  enqueue (5s undo window; undo restores snapshots by key). */
  const removePosition = useCallback(
    async (position: PositionResponse): Promise<void> => {
      const snapshots = positionRowSync.capture(queryClient, position.id);
      // Dry-run errors are NEVER intercepted: 422 POSITION_IS_SYSTEM (a
      // built-in) and 409-with-dependencies (busy) both reject upward; the
      // call site owns the surfaces (explanation toast / DeleteDialog).
      await dryRunDeletePosition(position.id);
      positionRowSync.remove(queryClient, snapshots);
      enqueuePendingAction(
        buildDeferredDeleteAction(
          queryClient,
          position,
          { expected: {} },
          snapshots,
          showToast,
        ),
      );
    },
    [queryClient, enqueuePendingAction, showToast],
  );

  /** Cascade deferred delete: same enqueue mechanics, no dry-run — the
   *  DeleteDialog built `resolutions` from the 409 tree it already has. */
  const removePositionResolved = useCallback(
    async (
      position: PositionResponse,
      resolutions: Record<string, string>,
      dependencies: DependencyNode[],
    ): Promise<void> => {
      const snapshots = positionRowSync.capture(queryClient, position.id);
      positionRowSync.remove(queryClient, snapshots);
      enqueuePendingAction(
        buildDeferredDeleteAction(
          queryClient,
          position,
          { resolutions, expected: expectedFromDependencies(dependencies) },
          snapshots,
          showToast,
        ),
      );
    },
    [queryClient, enqueuePendingAction, showToast],
  );

  return { removePosition, removePositionResolved };
}
