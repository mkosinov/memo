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

export type RecordsListCache =
  | RecordResponse[]
  | PaginatedResponse<RecordResponse>;

/**
 * Apply `fn` to the items of any ['records', ...] list cache, shape-agnostic:
 * the paged main list caches the envelope {items,total,page,per_page} (#191);
 * per-client/per-activity caches hold plain arrays. `total` is NOT adjusted —
 * every mutation path follows with invalidateQueries(['records']).
 */
export function mapRecordsListCache(
  old: RecordsListCache | undefined,
  fn: (items: RecordResponse[]) => RecordResponse[],
): RecordsListCache | undefined {
  if (old == null) return old;
  if (Array.isArray(old)) return fn(old);
  if (Array.isArray(old.items)) return { ...old, items: fn(old.items) };
  return old;
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
