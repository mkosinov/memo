'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import {
  dryRunDeleteRecord,
  resolveDeleteRecord,
} from '@memo/api-client';
import type {
  DependencyNode,
  RecordView,
  ResolveDeleteRecordPayload,
} from '@memo/api-client';
import {
  captureRecordSnapshots,
  mapRecordsListCache,
  removeRecordRow,
  restoreRecordSnapshots,
  type RecordSnapshot,
  type RecordsListCache,
} from '@/lib/cache/recordCacheSync';
import { usePendingActions } from '@/contexts/PendingActionsContext';
import { invalidateEntities } from '@/lib/invalidate';
import { qk } from '@/lib/queryKeys';

/**
 * Deferred record delete (#285, spec §3 D2/D3/D5) — mirrors the deferred
 * visits/payments scheme (deleteVisitDeferred / deletePaymentDeferred).
 *
 * Both entry points are NON-BLOCKING deferred actions: the row disappears
 * optimistically, the user gets a 5s undo window, the real DELETE runs in
 * commit — carrying the `expected` state snapshot (rev7 contract) so the
 * backend answers 409 `stale_dependencies` on a mid-window race.
 *
 * - `removeRecord` — clean path: item-level snapshots (D5) → dry-run
 *   `?dry_run=true` (pure preview; 409 + dependency tree REJECTS upward —
 *   the call site opens DeleteDialog; any other error also propagates so
 *   existing catches keep their error toasts) → optimistic row removal →
 *   enqueue with `commit = resolveDeleteRecord(id, {expected: {}})`.
 * - `removeRecordResolved` — cascade path after DeleteDialog confirmation:
 *   no dry-run (the tree is already in hand); `expected` id-sets are built
 *   from the tree's `items`; dialog closes immediately (enqueue is sync).
 *
 * Error surface (D4): the hook never intercepts — dry-run and commit errors
 * propagate to the PendingActions pipeline (Task 6 adds the default onError:
 * 404 = quiet success, others → undo + error toast). Invalidation failures
 * inside commit are non-fatal: the screen converges via SSE / next load.
 *
 * Invalidation union (per-site readers, #127 — no 5-key blanket), unchanged:
 *   ['records']  — every list cache (prefix): ScheduleActivityCard
 *                  ['records',df,dt], ClientQuickCard ['records','client',id],
 *                  RecordsTable envelope ['records',page,...]
 *   ['record', id] — canonical store (RecordModal / useRecordData)
 *   ['visitors']   — visits cascade shrinks per-client visitor counts
 * Family rules route through the shared map (#239): invalidateEntities
 * (['records']) = ['records'] + ['visitors']; the point key stays here.
 */

/** expected = id-sets per entity from the dry-run tree's `items` (D9а).
 *  Auto-resolved entities (record_tags) carry no items → skipped. */
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

/** Prefix-wide removal from EVERY ['records', ...] cache (shape-agnostic:
 *  envelope lists + per-client/per-activity arrays). Used in commit as the
 *  reconcile safety net — it also catches caches that appeared or refetched
 *  during the undo window (the snapshot-scoped removeRecordRow covers only
 *  the keys captured at click time). */
function removeRecordFromCaches(qc: QueryClient, id: string): void {
  qc.setQueriesData<RecordsListCache | undefined>(
    { queryKey: qk.records },
    (old) => mapRecordsListCache(old, (items) => items.filter((r) => r.id !== id)),
  );
}

/** Non-fatal invalidation union at commit (spec D4): family rules via the
 *  shared map (#239) + the point key only this hook knows (§4.1: id → hook). */
function invalidateAfterDelete(qc: QueryClient, id: string): void {
  invalidateEntities(qc, ['records']); // ['records'] + ['visitors']
  qc.invalidateQueries({ queryKey: qk.record(id) });
}

/** Shared commit body: real DELETE (with the expected-state contract) →
 *  removal reconcile → non-fatal invalidations. Errors propagate to the
 *  PendingActions pipeline (undo/toast handled there — Task 6). */
async function commitDeferredDelete(
  qc: QueryClient,
  record: RecordView,
  payload: ResolveDeleteRecordPayload,
  snapshots: RecordSnapshot[],
): Promise<void> {
  await resolveDeleteRecord(record.id, payload);
  // Reconcile: ensure the captured keys still reflect the deletion even if
  // a mid-window refetch brought the row back.
  removeRecordRow(qc, snapshots);
  removeRecordFromCaches(qc, record.id);
  try {
    await invalidateAfterDelete(qc, record.id);
  } catch {
    // Non-fatal (spec D4): server state after 204 is authoritative, undo
    // never resurrects a server-deleted record; SSE / next load converge.
  }
}

/** Shared enqueue shape (dedupe/cancel key + 5s window + by-key undo). */
function buildDeferredDeleteAction(
  qc: QueryClient,
  record: RecordView,
  payload: ResolveDeleteRecordPayload,
  snapshots: RecordSnapshot[],
): PendingActionShape {
  return {
    id: `delete-record-${record.id}`,
    kind: 'delete',
    message: 'Удалено. Отменить',
    delayMs: 5000,
    // Undo (D5): pure by-key restore — no server calls (the dry-run
    // guarantees nothing was deleted during the window), no invalidations.
    undo: () => restoreRecordSnapshots(qc, snapshots),
    commit: () => commitDeferredDelete(qc, record, payload, snapshots),
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
}

export function useDeleteRecord() {
  const queryClient = useQueryClient();
  const { enqueuePendingAction } = usePendingActions();

  /** Clean deferred delete (D2): snapshots → dry-run → optimistic removal →
   *  enqueue (5s undo window; undo restores snapshots by key). */
  const removeRecord = useCallback(
    async (record: RecordView): Promise<void> => {
      const snapshots = captureRecordSnapshots(queryClient, record.id);
      // Dry-run errors are NEVER intercepted: 409-with-dependencies → the
      // call site opens DeleteDialog (row stays visible); other errors keep
      // their existing catch/toast surfaces (D2). One thrown ApiError — the
      // single error mechanism of the hook (rev3).
      await dryRunDeleteRecord(record.id);
      removeRecordRow(queryClient, snapshots);
      enqueuePendingAction(
        buildDeferredDeleteAction(queryClient, record, { expected: {} }, snapshots),
      );
    },
    [queryClient, enqueuePendingAction],
  );

  /** Cascade deferred delete (D3): same enqueue mechanics, no dry-run —
   *  the DeleteDialog built `resolutions` from the 409 tree it already has.
   *  `expected` carries the id-sets snapshotted from that tree (D9а). */
  const removeRecordResolved = useCallback(
    async (
      record: RecordView,
      resolutions: Record<string, string>,
      dependencies: DependencyNode[],
    ): Promise<void> => {
      const snapshots = captureRecordSnapshots(queryClient, record.id);
      removeRecordRow(queryClient, snapshots);
      enqueuePendingAction(
        buildDeferredDeleteAction(
          queryClient,
          record,
          { resolutions, expected: expectedFromDependencies(dependencies) },
          snapshots,
        ),
      );
    },
    [queryClient, enqueuePendingAction],
  );

  return { removeRecord, removeRecordResolved };
}
