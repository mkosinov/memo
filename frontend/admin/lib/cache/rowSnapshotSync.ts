/**
 * Shared row-snapshot sync factory for deferred deletes (#285 D5 → #286):
 * ONE implementation of the cache mechanics consumed by BOTH
 * lib/cache/recordCacheSync.ts (the ['records', ...] family) and
 * lib/cache/activityCacheSync.ts (the ['activities'] family).
 *
 * Mechanics (identical for both families): snapshot the ROW OBJECT itself
 * from every cache of the family prefix where the row lives (read-only walk
 * via getQueriesData); the optimistic removal touches only the captured
 * keys; undo inserts the captured row back into ITS OWN keys replace-by-id —
 * mid-window refetch/SSE updates to neighbouring rows are never rolled back,
 * and restoring a whole cache value is forbidden. All updaters guard
 * `old == null` (restore must never throw or write into an evicted cache).
 *
 * Cache shapes are handled shape-agnostic (mapRowListCache below): plain
 * arrays (main/date lists, week range, per-client/per-activity lists,
 * activitiesForRecords) and paginated envelopes {items, ...} (#191 envelope,
 * copy-source). `total` is never adjusted — every consumer follows with a
 * family invalidation.
 */
import type { QueryClient } from '@tanstack/react-query';

/** One captured pair: the cache key + the row object in its original form. */
export interface RowSnapshot {
  queryKey: readonly unknown[];
  row: unknown;
}

/** Minimal structural contract shared by every cached row. */
interface RowLike {
  id: string;
}

/**
 * Shape-agnostic list transform: plain array → mapped array; envelope
 * {items} → {...envelope, items: mapped}; anything else (incl. null) passes
 * through untouched. Shared by the record (RecordsListCache) and activity
 * (array-or-envelope) cache shapes. `T` carries no constraint — the id-based
 * mechanics live in the factory below; callers needing typed rows pass their
 * own row type (e.g. RecordResponse).
 */
export function mapRowListCache<T>(
  old: unknown,
  fn: (items: T[]) => T[],
): unknown {
  if (old == null) return old;
  if (Array.isArray(old)) return fn(old as T[]);
  const items = (old as { items?: unknown }).items;
  if (Array.isArray(items)) return { ...(old as object), items: fn(items as T[]) };
  return old;
}

/** Shape-agnostic row lookup over both cache shapes. */
function findRow(cache: unknown, id: string): RowLike | undefined {
  if (cache == null) return undefined;
  if (Array.isArray(cache)) return (cache as RowLike[]).find((r) => r.id === id);
  const items = (cache as { items?: unknown }).items;
  if (Array.isArray(items)) return (items as RowLike[]).find((r) => r.id === id);
  return undefined;
}

export interface RowSnapshotSync {
  /**
   * Snapshot every cache of the family prefix holding the row: read-only walk
   * via getQueriesData({queryKey: prefix}); each pair captures the row object
   * itself. Caches without the row are not captured.
   */
  capture: (qc: QueryClient, id: string) => RowSnapshot[];
  /**
   * Optimistic removal scoped to the CAPTURED pairs only — other family
   * caches the row never lived in are not broadcast-touched. Shape is
   * preserved via mapRowListCache.
   */
  remove: (qc: QueryClient, snapshots: RowSnapshot[]) => void;
  /**
   * Undo path: for each captured pair, take the CURRENT value of its own
   * cache key and insert the captured row replace-by-id — a refetch-returned
   * row is replaced (no duplicates), a shifted list gets the row appended.
   * Never writes into an evicted/deleted cache (updater returns undefined →
   * skip) and performs no server calls.
   */
  restore: (qc: QueryClient, snapshots: RowSnapshot[]) => void;
}

/** Build the sync for ONE family prefix (e.g. qk.records, ['activities']). */
export function createRowSnapshotSync(
  prefix: readonly unknown[],
): RowSnapshotSync {
  function capture(qc: QueryClient, id: string): RowSnapshot[] {
    const snapshots: RowSnapshot[] = [];
    for (const [queryKey, data] of qc.getQueriesData<unknown>({ queryKey: prefix })) {
      const row = findRow(data, id);
      if (row !== undefined) snapshots.push({ queryKey, row });
    }
    return snapshots;
  }

  function remove(qc: QueryClient, snapshots: RowSnapshot[]): void {
    for (const { queryKey, row } of snapshots) {
      const id = (row as RowLike).id;
      qc.setQueryData<unknown>(
        queryKey,
        (old: unknown) =>
          old == null
            ? old
            : mapRowListCache<RowLike>(old, (items) => items.filter((r) => r.id !== id)),
      );
    }
  }

  function restore(qc: QueryClient, snapshots: RowSnapshot[]): void {
    for (const { queryKey, row } of snapshots) {
      const id = (row as RowLike).id;
      qc.setQueryData<unknown>(
        queryKey,
        (old: unknown) =>
          old == null
            ? old
            : mapRowListCache<RowLike>(old, (items) => {
                const exists = items.some((r) => r.id === id);
                return exists
                  ? items.map((r) => (r.id === id ? (row as RowLike) : r))
                  : [...items, row as RowLike];
              }),
      );
    }
  }

  return { capture, remove, restore };
}
