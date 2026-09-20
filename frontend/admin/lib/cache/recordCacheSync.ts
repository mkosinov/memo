/**
 * Cache-sync helpers for records, visits, and payments.
 *
 * The single source of truth for the cache-key topology:
 *   - ['record', id]               — canonical single-record store
 *   - ['records', ...params]        — main list; keyed by all server params
 *                                     (page/per_page/filters/sort) and holds the
 *                                     envelope {items,total,page,per_page} (#191);
 *                                     before #191 it was date-keyed and held a
 *                                     plain array — updaters are shape-agnostic
 *   - ['records', 'client', id]     — per-client list (plain array)
 *   - ['records', 'activity', id]   — per-activity list (plain array)
 *   - ['payments', recordId]        — per-record payments
 *   - ['payments']                  — global payments list
 *
 * Every mutation MUST go through these helpers so canonical and list keys
 * stay consistent. All updaters guard `old == null` (spec §7 — restore must
 * never throw or write into a deleted record).
 */
import type { QueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';
import { createRowSnapshotSync, mapRowListCache, type RowSnapshot } from './rowSnapshotSync';
import type {
  PaginatedResponse,
  PaymentResponse,
  RecordResponse,
  VisitResponse,
} from '@memo/api-client';

export type RecordsListCache<T = RecordResponse> = T[] | PaginatedResponse<T>;

/**
 * Apply `fn` to the items of any ['records', ...] list cache, shape-agnostic:
 * the paged main list caches the envelope {items,total,page,per_page} (#191);
 * per-client/per-activity caches hold plain arrays. `total` is NOT adjusted —
 * every mutation path follows with invalidateQueries(['records']). Typed
 * wrapper over the shared rowSnapshotSync transform (same mechanics serve
 * the ['activities'] family — lib/cache/activityCacheSync.ts).
 */
export function mapRecordsListCache<T>(
  old: RecordsListCache<T> | undefined,
  fn: (items: T[]) => T[],
): RecordsListCache<T> | undefined {
  return mapRowListCache(old, fn) as RecordsListCache<T> | undefined;
}

// ── #285 deferred record delete: item-level snapshots per cache key (§3 D5) ──
// Capture the ROW OBJECT itself from every ['records', ...] cache where it
// lives; undo inserts it back into ITS OWN cache keys only (replace-by-id, no
// broadcast). The canonical ['record', id] key is deliberately not involved:
// the prefix-scoped removal never reaches it and the commit invalidation
// converges it (D5 — snapshotting the canon would be dead code).
//
// The snapshot/remove/restore mechanics are SHARED with the ['activities']
// family (#286) via createRowSnapshotSync (./rowSnapshotSync) — thin
// record-flavored delegates below keep the #285 public API and types.

/** One captured pair: the cache key + the row object in its original form. */
export type RecordSnapshot = RowSnapshot;

const recordRowSync = createRowSnapshotSync(qk.records);

/**
 * Snapshot every ['records', ...] cache holding the row (spec §3 D5): read-only
 * walk via getQueriesData({queryKey: qk.records}); each pair captures the row
 * object itself (RecordView from the paged envelope, RecordResponse from
 * per-client/per-activity lists). Caches without the row are not captured.
 */
export function captureRecordSnapshots(
  qc: QueryClient,
  id: string,
): RecordSnapshot[] {
  return recordRowSync.capture(qc, id);
}

/**
 * Undo path (§3 D5): for each captured pair, take the CURRENT value of its own
 * cache key and insert the captured row replace-by-id — a refetch-returned row
 * is replaced (no duplicates), a shifted list gets the row appended. Never
 * writes into an evicted/deleted cache (updater returns undefined → skip) and
 * performs no server calls — the dry-run (D1) guarantees nothing was deleted
 * during the window.
 */
export function restoreRecordSnapshots(
  qc: QueryClient,
  snapshots: RecordSnapshot[],
): void {
  recordRowSync.restore(qc, snapshots);
}

/**
 * Optimistic row removal (§3 D5): scoped to the CAPTURED pairs only — other
 * ['records', ...] caches (e.g. a foreign client/activity list the row never
 * lived in) are not broadcast-touched. Shape-preserving via mapRecordsListCache;
 * `total` stays untouched (helper invariant).
 */
export function removeRecordRow(
  qc: QueryClient,
  snapshots: RecordSnapshot[],
): void {
  recordRowSync.remove(qc, snapshots);
}

/** Patch a single record everywhere it lives: canonical + every list cache. */
export function patchRecordEverywhere(
  qc: QueryClient,
  recordId: string,
  updater: (record: RecordResponse) => RecordResponse,
): void {
  const canonical = qc.getQueryData<RecordResponse>(['record', recordId]);
  if (canonical == null) return; // null guard — no canonical, no mutation
  qc.setQueryData<RecordResponse>(
    ['record', recordId],
    (old) => (old == null ? old : updater(old)),
  );
  qc.setQueriesData<RecordsListCache | undefined>(
    { queryKey: qk.records },
    (old) =>
      mapRecordsListCache(old, (items) =>
        items.map((r) => (r.id === recordId ? updater(r) : r)),
      ),
  );
}

/** Add/replace a visit in the canonical record + mirror into list caches. */
export function upsertVisit(
  qc: QueryClient,
  recordId: string,
  visit: VisitResponse,
  position: UpsertPosition = {},
): void {
  patchRecordEverywhere(qc, recordId, (record) => ({
    ...record,
    visits: upsertById(record.visits, visit, position.atIndex),
  }));
}

/** Remove a visit from canonical + list caches. */
export function removeVisit(
  qc: QueryClient,
  recordId: string,
  visitId: string,
): void {
  patchRecordEverywhere(qc, recordId, (record) => ({
    ...record,
    visits: record.visits.filter((v) => v.id !== visitId),
  }));
}

/** Upsert a payment: canonical per-record key + global ['payments']. */
export function upsertPayment(
  qc: QueryClient,
  recordId: string,
  payment: PaymentResponse,
  position: PaymentUpsertPosition = {},
): void {
  // Per-record payments
  qc.setQueryData<PaymentResponse[]>(['payments', recordId], (old) => {
    if (old == null) return old;
    return upsertById(old, payment, position.atIndex);
  });
  // Global payments list
  qc.setQueryData<PaymentResponse[]>(['payments'], (old) => {
    if (old == null) return old;
    return upsertById(old, payment, position.globalAtIndex);
  });
}

/** Remove a payment from per-record + global ['payments']. */
export function removePayment(
  qc: QueryClient,
  recordId: string,
  paymentId: string,
): void {
  qc.setQueryData<PaymentResponse[]>(['payments', recordId], (old) => {
    if (old == null) return old;
    return old.filter((p) => p.id !== paymentId);
  });
  qc.setQueryData<PaymentResponse[]>(['payments'], (old) => {
    if (old == null) return old;
    return old.filter((p) => p.id !== paymentId);
  });
}

/** Seed canonical ['record', id] from a list-fetched record (only if absent). */
export function seedRecordFromList(
  qc: QueryClient,
  record: RecordResponse,
): void {
  if (qc.getQueryData<RecordResponse>(['record', record.id]) == null) {
    qc.setQueryData(['record', record.id], record);
  }
}

// ── #243 S5: position-preserving restore ────────────────────────────────────
// Deferred-delete snapshots capture the row's ORIGINAL index per cache key;
// the undo path re-inserts at that position instead of appending (the row must
// not "jump to the end" after «Отменить»). Omitted/negative index (row absent
// at defer time, or a plain add) keeps the append semantics.

/**
 * Insert-or-replace `row` in `list` by id. Replacement keeps the current
 * position (a refetch-returned row is not moved); insertion honors
 * `atIndex` — clamped into [0, list.length] (beyond-the-end and negative
 * indices degrade to append, never sparse arrays).
 */
function upsertById<T extends { id: string }>(
  list: T[],
  row: T,
  atIndex?: number,
): T[] {
  const idx = list.findIndex((r) => r.id === row.id);
  if (idx !== -1) return list.map((r) => (r.id === row.id ? row : r));
  if (atIndex == null || !Number.isFinite(atIndex) || atIndex < 0 || atIndex > list.length) {
    return [...list, row];
  }
  const next = list.slice();
  next.splice(atIndex, 0, row);
  return next;
}

/** Position hints for a restore: original index per affected cache key. */
export interface UpsertPosition {
  /** Original index in the canonical record's visits array. */
  atIndex?: number;
}

/** Position hints for a payment restore: per-record and global keys have INDEPENDENT orderings. */
export interface PaymentUpsertPosition {
  /** Original index in the ['payments', recordId] list. */
  atIndex?: number;
  /** Original index in the global ['payments'] list. */
  globalAtIndex?: number;
}
