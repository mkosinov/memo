'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRecordsView } from '@memo/api-client';
import type { PaginatedResponse, RecordView } from '@memo/api-client';
import type { SortOrder } from './createPagedListContext';
import type { RecordsUrlAdapter } from '@/app/(main)/records/useRecordsUrlState';
import { seedRecordFromList } from '@/lib/cache/recordCacheSync';
import { qk } from '@/lib/queryKeys';

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
  const { state, update, setPeriod } = urlState;
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
  } = state;
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

  // #349 Task 7 — setters are URL writes through the adapter: the hook's
  // filter-change rule resets page→1 in the SAME navigation (spec §3),
  // replacing the manual setPage(1) calls of the local-state era.
  const setPage = useCallback((p: number) => update({ page: p }), [update]);

  const setFilters = useCallback(
    (newFilters: Partial<RecordFilters>) => update(newFilters),
    [update],
  );

  const resetFilters = useCallback(
    () =>
      update({
        locationId: '',
        serviceId: '',
        masterId: '',
        status: '',
        search: '',
      }),
    [update],
  );

  const setPerPage = useCallback((pp: number) => update({ perPage: pp }), [update]);

  // PagedListState.setSort contract (spec §6.4): field+order applied verbatim
  // + page reset (§6.10.2, via the hook's auto-reset). Toggle-on-repeat was
  // REMOVED — DataTable owns it (§6.10.4). `field` is `string` per the
  // contract; the URL enum + server whitelist validate it upstream.
  const setSort = useCallback(
    (field: string, order: SortOrder) => update({ sortBy: field, sortOrder: order }),
    [update],
  );

  // Spec §6.7 page clamp — after a SETTLED fetch returns an empty non-first
  // page (e.g. last row of page N deleted), step back. `!isFetching` guards
  // against mid-refetch races with keepPreviousData. #349: a service
  // correction — written with history:'replace' (no extra history entry).
  useEffect(() => {
    const items = data?.items || [];
    if (!isPending && !isFetching && items.length === 0 && page > 1) {
      update({ page: page - 1 }, { history: 'replace' });
    }
  }, [isPending, isFetching, data, page, update]);

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
