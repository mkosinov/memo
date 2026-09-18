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
 * every mutation path follows with invalidateQueries(['records']).
 */
export function mapRecordsListCache<T>(
  old: RecordsListCache<T> | undefined,
  fn: (items: T[]) => T[],
): RecordsListCache<T> | undefined {
  if (old == null) return old;
  if (Array.isArray(old)) return fn(old);
  if (Array.isArray(old.items)) return { ...old, items: fn(old.items) };
  return old;
}

// ── #285 deferred record delete: item-level snapshots per cache key (§3 D5) ──
// Capture the ROW OBJECT itself from every ['records', ...] cache where it
// lives; undo inserts it back into ITS OWN cache keys only (replace-by-id, no
// broadcast). The canonical ['record', id] key is deliberately not involved:
// the prefix-scoped removal never reaches it and the commit invalidation
// converges it (D5 — snapshotting the canon would be dead code).

/** Minimal structural contract shared by RecordView and RecordResponse rows. */
interface RecordRowLike {
  id: string;
}

/** One captured pair: the cache key + the row object in its original form. */
export interface RecordSnapshot {
  queryKey: readonly unknown[];
  row: unknown;
}

/** Shape-agnostic row lookup, mirroring mapRecordsListCache's two shapes. */
function findRecordRow(
  cache: unknown,
  id: string,
): RecordRowLike | undefined {
  if (cache == null) return undefined;
  if (Array.isArray(cache)) {
    return (cache as RecordRowLike[]).find((r) => r.id === id);
  }
  const items = (cache as { items?: unknown }).items;
  if (Array.isArray(items)) return (items as RecordRowLike[]).find((r) => r.id === id);
  return undefined;
}

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
  const snapshots: RecordSnapshot[] = [];
  for (const [queryKey, data] of qc.getQueriesData<unknown>({
    queryKey: qk.records,
  })) {
    const row = findRecordRow(data, id);
    if (row !== undefined) snapshots.push({ queryKey, row });
  }
  return snapshots;
}

/** insertRowById via mapRecordsListCache: same id → replace; absent → append. */
function insertRowById(
  old: RecordsListCache | undefined,
  row: RecordResponse,
): RecordsListCache | undefined {
  return mapRecordsListCache(old, (items) => {
    const exists = items.some((r) => r.id === row.id);
    return exists
      ? items.map((r) => (r.id === row.id ? row : r))
      : [...items, row];
  });
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
  for (const { queryKey, row } of snapshots) {
    qc.setQueryData<RecordsListCache | undefined>(
      queryKey,
      (old) => insertRowById(old, row as RecordResponse),
    );
  }
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
  for (const { queryKey, row } of snapshots) {
    const id = (row as RecordRowLike).id;
    qc.setQueryData<RecordsListCache | undefined>(
      queryKey,
      (old) => mapRecordsListCache(old, (items) => items.filter((r) => r.id !== id)),
    );
  }
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
): void {
  patchRecordEverywhere(qc, recordId, (record) => {
    const idx = record.visits.findIndex((v) => v.id === visit.id);
    const visits =
      idx === -1
        ? [...record.visits, visit]
        : record.visits.map((v) => (v.id === visit.id ? visit : v));
    return { ...record, visits };
  });
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
): void {
  // Per-record payments
  qc.setQueryData<PaymentResponse[]>(['payments', recordId], (old) => {
    if (old == null) return old;
    const idx = old.findIndex((p) => p.id === payment.id);
    return idx === -1
      ? [...old, payment]
      : old.map((p) => (p.id === payment.id ? payment : p));
  });
  // Global payments list
  qc.setQueryData<PaymentResponse[]>(['payments'], (old) => {
    if (old == null) return old;
    const idx = old.findIndex((p) => p.id === payment.id);
    return idx === -1
      ? [...old, payment]
      : old.map((p) => (p.id === payment.id ? payment : p));
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
