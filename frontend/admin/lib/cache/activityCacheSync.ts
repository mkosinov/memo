/**
 * Cache-sync helpers for the ['activities'] family (#286 D4).
 *
 * Family topology (lib/invalidate.ts — INVALIDATION_MAP.activities):
 *   - ['activities', weekStart, weekEnd]              — grid week range (plain array)
 *   - ['activities', 'for-records', ids]              — activitiesForRecords (plain array)
 *   - ['activities', weekStart, weekEnd, 'copy-source'] — CopyLastWeekPopover (envelope)
 *
 * Deferred-delete mechanics are SHARED with the record family (#285 D5) via
 * createRowSnapshotSync (./rowSnapshotSync): snapshot the ROW OBJECT itself
 * from every family cache where it lives; the optimistic removal touches only
 * the captured keys; undo inserts the captured row back into ITS OWN keys
 * replace-by-id — SSE updates to neighbouring rows inside the undo window are
 * never rolled back, and restoring a whole cache value is forbidden.
 */
import type { QueryClient } from '@tanstack/react-query';
import { createRowSnapshotSync, type RowSnapshot } from './rowSnapshotSync';

/** The ['activities'] family prefix — same family INVALIDATION_MAP invalidates. */
const ACTIVITIES_PREFIX = ['activities'] as const;

/** One captured pair: the cache key + the row object in its original form. */
export type ActivitySnapshot = RowSnapshot;

const activityRowSync = createRowSnapshotSync(ACTIVITIES_PREFIX);

/**
 * Snapshot every ['activities', ...] cache holding the row (read-only walk via
 * getQueriesData): each pair captures the row object itself. Caches without
 * the row are not captured.
 */
export function captureActivitySnapshots(
  qc: QueryClient,
  id: string,
): ActivitySnapshot[] {
  return activityRowSync.capture(qc, id);
}

/**
 * Optimistic row removal (D4): scoped to the CAPTURED pairs only — other
 * family caches the row never lived in are not broadcast-touched. Shape is
 * preserved (plain array stays plain, envelope stays envelope).
 */
export function removeActivityRows(
  qc: QueryClient,
  snapshots: ActivitySnapshot[],
): void {
  activityRowSync.remove(qc, snapshots);
}

/**
 * Undo path (D4): for each captured pair, take the CURRENT value of its own
 * cache key and insert the captured row replace-by-id — a refetch-returned
 * row is replaced (no duplicates), a shifted list gets the row appended. SSE
 * updates to OTHER rows inside the window are untouched. Never writes into an
 * evicted/deleted cache (updater returns undefined → skip) and performs no
 * server calls — the dry-run guarantees nothing was deleted during the window.
 */
export function restoreActivitySnapshots(
  qc: QueryClient,
  snapshots: ActivitySnapshot[],
): void {
  activityRowSync.restore(qc, snapshots);
}
