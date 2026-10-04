'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRecordsView } from '@memo/api-client';
import type { PaginatedResponse, RecordView } from '@memo/api-client';
import type { SortOrder } from './createPagedListContext';
import type { RecordsUrlAdapter, RecordsUrlPatch, RecordsUrlStateView } from '@/app/(main)/records/useRecordsUrlState';
import { defaultRecordsPeriod } from '@/app/(main)/records/useRecordsUrlState';
import { seedRecordFromList } from '@/lib/cache/recordCacheSync';
import { qk } from '@/lib/queryKeys';

/** Field-wise view equality (primitives + a flat filters bag). */
function recordsStateEq(a: RecordsUrlStateView, b: RecordsUrlStateView): boolean {
  return (
    a.page === b.page &&
    a.perPage === b.perPage &&
    a.sortBy === b.sortBy &&
    a.sortOrder === b.sortOrder &&
    a.dateFrom === b.dateFrom &&
    a.dateTo === b.dateTo &&
    a.explicitFrom === b.explicitFrom &&
    a.explicitTo === b.explicitTo &&
    a.filters.locationId === b.filters.locationId &&
    a.filters.serviceId === b.filters.serviceId &&
    a.filters.masterId === b.filters.masterId &&
    a.filters.status === b.filters.status &&
    a.filters.search === b.filters.search
  );
}

export interface RecordFilters {
  locationId: string;
  serviceId: string;
  masterId: string;
  status: string;
  /** Server-side search (GH #212 Task 12) — sent to getRecordsView as `q`. */
  search: string;
}

export type RecordSortField =
  | 'date' | 'client' | 'service' | 'master' | 'location'
  | 'guests' | 'status' | 'total' | 'payment';
export type RecordSortOrder = 'asc' | 'desc';

export interface RecordsContextType {
  /** Server-page items — PagedListState.items contract (spec §6.4, #139 T8). */
  items: RecordView[];
  /** Kept alongside `items` for backwards compat with non-table consumers. */
  records: RecordView[];
  total: number;
  page: number;
  perPage: number;
  filters: RecordFilters;
  /** `RecordSortField` is assignable to `string | null`; initial 'date' preserved (B2 cat 15). */
  sortBy: RecordSortField;
  sortOrder: RecordSortOrder;
  setPage: (page: number) => void;
  setPerPage: (perPage: number) => void;
  setFilters: (newFilters: Partial<RecordFilters>) => void;
  /**
   * PagedListState.setSort contract (spec §6.4): two-arg, param widened to
   * `string` (DataTable passes string keys), sets field+order verbatim and
   * resets to page 1 (§6.10.2). The asc/desc toggle lives in DataTable (§6.10.4).
   */
  setSort: (field: string, order: SortOrder) => void;
  resetFilters: () => void;
  /**
   * #349 Task 7 — write the records period to the URL (?from=&to=, PUSH —
   * Gate B: a period change is a history step). '' removes a param; the
   * committed navigation updates dateFrom/dateTo and resets the page to 1
   * (the hook's filter-change auto-reset).
   */
  setPeriod: (from: string, to: string) => void;
  /** #349 Task 7 — effective period (a missing side falls back to its default). */
  dateFrom: string;
  /** #349 Task 7 — effective period (a missing side falls back to its default). */
  dateTo: string;
  /** The EXPLICIT ?from value, or null when absent/inverted (half-filter). */
  explicitFrom: string | null;
  /** The EXPLICIT ?to value, or null when absent/inverted (half-filter). */
  explicitTo: string | null;
  isLoading: boolean;
  /** Kept alongside `isLoading` for backwards compat with non-table consumers. */
  loading: boolean;
  /** Spec §6.4 — pass-through from React Query. */
  isPending: boolean;
  /** Spec §6.4 — pass-through from React Query. */
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
}

const RecordsContext = createContext<RecordsContextType | null>(null);

/** The cleared filters bag (module const — stable identity for callbacks). */
const DEFAULT_URL_FILTERS: RecordFilters = { locationId: '', serviceId: '', masterId: '', status: '', search: '' };

export function RecordsProvider({
  children,
  urlState,
}: {
  children: React.ReactNode;
  /** #349 Task 7 — the page-scoped URL adapter (managed mode): ALL records
   * table state is URL state; every setter is a URL write through the
   * adapter's single useTableUrlState instance. */
  urlState: RecordsUrlAdapter;
}) {
  const queryClient = useQueryClient();
  const { state: urlSnapshot, update } = urlState;

  // #349 follow-up — OPTIMISTIC MIRROR. The URL is the source of truth, but
  // a query-key switch driven by a router navigation Transition (the
  // useSearchParams re-render lands inside startTransition) lets the React
  // Query data notification race the DOM read — records e2e #11/#12 family:
  // desc fetched + 200, tbody kept the placeholder. The mirror restores the
  // pre-#349 synchronous flow: every setter applies its value LOCALLY at
  // once (instant re-render + fetch outside any Transition) and the URL
  // write follows; EXTERNAL navigations (deep link / «назад») are adopted by
  // the effect below once the URL state actually differs from a pending
  // write (a pending push's values are already in the mirror).
  const [mirror, setMirror] = useState(urlSnapshot);
  /** Read-latest base for same-tick writes — never re-subscribes effects. */
  const mirrorRef = useRef(mirror);
  const pendingWriteRef = useRef<RecordsUrlStateView | null>(null);

  /** Keep ref + state in lockstep (single-writer discipline). */
  const commitMirror = useCallback((next: RecordsUrlStateView) => {
    mirrorRef.current = next;
    setMirror(next);
  }, []);

  // Deps include `mirror` as a TRIGGER only (values are read from refs):
  // a write whose target URL equals the current URL (e.g. a coalesced
  // no-op like setPage back to the default) produces NO URL event, so the
  // pending comparison must also run right after each commitMirror.
  useEffect(() => {
    const pending = pendingWriteRef.current;
    if (pending) {
      // Our own write is in flight: adopt NOTHING until its navigation
      // commits (the URL then equals the pending values). NB: an EXTERNAL
      // navigation landing inside the ~16ms window is indistinguishable
      // from an uncommitted write — same limitation the hook's write base
      // has; real navigations never straddle the window (they wait for
      // responses/commits).
      if (recordsStateEq(pending, urlSnapshot)) {
        pendingWriteRef.current = null;
      }
      return;
    }
    if (!recordsStateEq(mirrorRef.current, urlSnapshot)) {
      commitMirror(urlSnapshot);
    }
  }, [urlSnapshot, mirror, commitMirror]);

  /**
   * Apply a write optimistically: mirror now, URL right after. The next
   * state is BUILT from the latest committed view (an in-flight pending,
   * else the mirror ref) — NOT from the render's closure `mirror` — so two
   * writes in the same tick (RecordsFilters handleReset: resetFilters() +
   * setPeriod('', '')) compose instead of the second overwriting the first
   * from a stale snapshot (quality-review blocker: filter resurrection +
   * pendingWriteRef pinned forever).
   */
  const applyWrite = useCallback(
    (
      build: (prev: RecordsUrlStateView) => RecordsUrlStateView,
      urlPatch: RecordsUrlPatch,
      options?: { history?: 'push' | 'replace' },
    ) => {
      const next = build(pendingWriteRef.current ?? mirrorRef.current);
      pendingWriteRef.current = next;
      commitMirror(next);
      update(urlPatch, options);
    },
    [update, commitMirror],
  );

  // The query-key range format is unchanged: the adapter defaults a missing
  // period side to the current-week monday..sunday — the same strings the
  // legacy useRecordsPeriod produced (cache keys byte-identical).
  const {
    dateFrom,
    dateTo,
    explicitFrom,
    explicitTo,
    filters,
    sortBy: urlSortBy,
    sortOrder,
    page,
    perPage,
  } = mirror;
  const sortBy = urlSortBy as RecordSortField;

  const refetch = useCallback(() => {
    void queryClient.refetchQueries({ queryKey: qk.records });
  }, [queryClient]);

  // Server-driven records list (#191) — queryKey carries every server param.
  // GH #213 Task 6: fetcher swapped to the composite view endpoint
  // (records + display fields in one request); key + options unchanged.
  const { data, isLoading: recordsLoading, isPending, isFetching, error: recordsError } = useQuery<PaginatedResponse<RecordView>>({
    queryKey: [qk.records[0], page, perPage, dateFrom, dateTo, filters, sortBy, sortOrder],
    queryFn: () => getRecordsView({
      page,
      per_page: perPage,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      location_id: filters.locationId || undefined,
      service_id: filters.serviceId || undefined,
      master_id: filters.masterId || undefined,
      status: filters.status || undefined,
      // GH #212 Task 12 — server-side search. The ≥2-char clamp mirrors the
      // server min_length=2 (shorter values are treated as unset — no 422s).
      q: filters.search.length >= 2 ? filters.search : undefined,
      sort_by: sortBy,
      sort_order: sortOrder,
    }),
    placeholderData: keepPreviousData,
  });
  const records = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;

  // #349 Task 7 — setters are optimistic URL writes: the value lands in the
  // mirror at once (synchronous re-render) and the URL navigation follows;
  // the hook's filter-change rule resets page→1 in the SAME navigation
  // (spec §3) — the mirror applies the identical reset to stay in lockstep.
  // The hook clamps `page` into 1…10⁴ on its URL read; the mirror must clamp
  // on WRITE too — an out-of-range mirror page never equals the clamped URL
  // snapshot and would pin pendingWriteRef forever (quality-review minor).
  const setPage = useCallback(
    (p: number) => {
      const clamped = Math.min(10_000, Math.max(1, p));
      applyWrite((prev) => ({ ...prev, page: clamped }), { page: clamped });
    },
    [applyWrite],
  );

  const setFilters = useCallback(
    (newFilters: Partial<RecordFilters>) =>
      applyWrite(
        (prev) => ({ ...prev, filters: { ...prev.filters, ...newFilters }, page: 1 }),
        newFilters as RecordsUrlPatch,
      ),
    [applyWrite],
  );

  const resetFilters = useCallback(
    () => applyWrite((prev) => ({ ...prev, filters: DEFAULT_URL_FILTERS, page: 1 }), { ...DEFAULT_URL_FILTERS }),
    [applyWrite],
  );

  const setPerPage = useCallback(
    (pp: number) => applyWrite((prev) => ({ ...prev, perPage: pp, page: 1 }), { perPage: pp }),
    [applyWrite],
  );

  // PagedListState.setSort contract (spec §6.4): field+order applied verbatim
  // + page reset (§6.10.2). Toggle-on-repeat was REMOVED — DataTable owns it
  // (§6.10.4). `field` is `string` per the contract; the URL enum + server
  // whitelist validate it upstream.
  const setSort = useCallback(
    (field: string, order: SortOrder) =>
      applyWrite(
        (prev) => ({ ...prev, sortBy: field, sortOrder: order, page: 1 }),
        { sortBy: field, sortOrder: order },
      ),
    [applyWrite],
  );

  // #349 Task 7 / Gate B — the period write ('' removes a side). The mirror
  // derives the effective range (a missing side → its own default) exactly
  // like the adapter read; page resets with the same hook rule.
  const setPeriod = useCallback(
    (from: string, to: string) => {
      const nextFrom = from === '' ? null : from;
      const nextTo = to === '' ? null : to;
      const def = defaultRecordsPeriod();
      applyWrite(
        (prev) => ({
          ...prev,
          explicitFrom: nextFrom,
          explicitTo: nextTo,
          dateFrom: nextFrom ?? def.from,
          dateTo: nextTo ?? def.to,
          page: 1,
        }),
        { period: { from: nextFrom, to: nextTo } },
      );
    },
    [applyWrite],
  );

  // Spec §6.7 page clamp — after a SETTLED fetch returns an empty non-first
  // page (e.g. last row of page N deleted), step back. `!isFetching` guards
  // against mid-refetch races with keepPreviousData. #349: a service
  // correction — written with history:'replace' (no extra history entry).
  useEffect(() => {
    const items = data?.items || [];
    if (!isPending && !isFetching && items.length === 0 && page > 1) {
      const stepBack = Math.max(1, page - 1);
      applyWrite((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }), { page: stepBack }, { history: 'replace' });
    }
  }, [isPending, isFetching, data, page, applyWrite]);

  // Seed canonical ['record', id] from list responses. Avoids a redundant
  // getRecord() request the first time a record is opened (spec §2.1).
  // The helper no-ops if ['record', id] is already populated, so a fresher
  // entry (e.g. from an in-flight useRecordData fetch) is never overwritten.
  useEffect(() => {
    records.forEach((r) => seedRecordFromList(queryClient, r));
  }, [records, queryClient]);

  const contextValue = useMemo(
    () => ({
      items: records,
      records,
      total,
      page,
      perPage,
      filters,
      sortBy,
      sortOrder,
      setPage,
      setPerPage,
      setFilters,
      setSort,
      resetFilters,
      setPeriod,
      dateFrom,
      dateTo,
      explicitFrom,
      explicitTo,
      isLoading: recordsLoading,
      loading: recordsLoading,
      isPending,
      isFetching,
      error: recordsError ?? null,
      refetch,
    }),
    [records, total, page, perPage, filters, sortBy, sortOrder, setPage, setPerPage, setFilters, setSort, resetFilters, setPeriod, dateFrom, dateTo, explicitFrom, explicitTo, recordsLoading, isPending, isFetching, recordsError, refetch],
  );

  return (
    <RecordsContext.Provider value={contextValue}>
      {children}
    </RecordsContext.Provider>
  );
}

export function useRecords(): RecordsContextType {
  const context = useContext(RecordsContext);
  if (!context) throw new Error('useRecords must be used within RecordsProvider');
  return context;
}
