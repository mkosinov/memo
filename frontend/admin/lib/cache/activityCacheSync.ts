/**
 * Cache-sync helpers for the ['activities'] family (#286 D4).
 *
 * Family topology (lib/invalidate.ts — INVALIDATION_MAP.activities):
 *   - ['activities', weekStart, weekEnd]              — grid week range (plain array)
 *   - ['activities', 'for-records', ids]              — activitiesForRecords (plain array)
 *   - ['activities', weekStart, weekEnd, 'copy-source'] — CopyLastWeekPopover (envelope)
 *
 * Deferred-delete mechanics mirror recordCacheSync (#285 D5): snapshot the
 * ROW OBJECT itself from every family cache where it lives; the optimistic
 * removal touches only the captured keys; undo inserts the captured row back
 * into ITS OWN keys replace-by-id — SSE updates to neighbouring rows inside
 * the undo window are never rolled back, and restoring a whole cache value is
 * forbidden. All updaters guard `old == null` (restore must never throw or
 * write into an evicted cache).
 */
import type { QueryClient } from '@tanstack/react-query';

/** The ['activities'] family prefix — same family INVALIDATION_MAP invalidates. */
const ACTIVITIES_PREFIX = ['activities'] as const;

/** Minimal structural contract shared by every cached activity row. */
interface ActivityRowLike {
  id: string;
}

/** One captured pair: the cache key + the row object in its original form. */
export interface ActivitySnapshot {
  queryKey: readonly unknown[];
  row: unknown;
}

/** Shape-agnostic row lookup: plain array (week-range, for-records) or
 *  envelope {items} (copy-source). */
function findActivityRow(cache: unknown, id: string): ActivityRowLike | undefined {
  if (cache == null) return undefined;
  if (Array.isArray(cache)) {
    return (cache as ActivityRowLike[]).find((r) => r.id === id);
  }
  const items = (cache as { items?: unknown }).items;
  if (Array.isArray(items)) return (items as ActivityRowLike[]).find((r) => r.id === id);
  return undefined;
}

/**
 * Snapshot every ['activities', ...] cache holding the row (read-only walk via
 * getQueriesData): each pair captures the row object itself. Caches without
 * the row are not captured.
 */
export function captureActivitySnapshots(
  qc: QueryClient,
  id: string,
): ActivitySnapshot[] {
  const snapshots: ActivitySnapshot[] = [];
  for (const [queryKey, data] of qc.getQueriesData<unknown>({
    queryKey: ACTIVITIES_PREFIX,
  })) {
    const row = findActivityRow(data, id);
    if (row !== undefined) snapshots.push({ queryKey, row });
  }
  return snapshots;
}

/** Shape-preserving value transform: remove-by-id or insert-by-id. */
function updateCacheValue(
  cache: unknown,
  id: string,
  op: 'remove' | 'restore',
  row?: unknown,
): unknown {
  const apply = (items: ActivityRowLike[]): ActivityRowLike[] => {
    if (op === 'remove') return items.filter((r) => r.id !== id);
    const exists = items.some((r) => r.id === id);
    return exists
      ? items.map((r) => (r.id === id ? (row as ActivityRowLike) : r))
      : [...items, row as ActivityRowLike];
  };
  if (Array.isArray(cache)) return apply(cache as ActivityRowLike[]);
  const items = (cache as { items?: unknown } | null)?.items;
  if (Array.isArray(items)) {
    return { ...(cache as object), items: apply(items as ActivityRowLike[]) };
  }
  return cache;
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
  for (const { queryKey, row } of snapshots) {
    const id = (row as ActivityRowLike).id;
    qc.setQueryData<unknown>(
      queryKey,
      (old: unknown) => (old == null ? old : updateCacheValue(old, id, 'remove')),
    );
  }
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
  for (const { queryKey, row } of snapshots) {
    const id = (row as ActivityRowLike).id;
    qc.setQueryData<unknown>(
      queryKey,
      (old: unknown) => (old == null ? old : updateCacheValue(old, id, 'restore', row)),
    );
  }
}
