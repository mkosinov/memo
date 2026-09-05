'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRecordsView } from '@memo/api-client';
import type { PaginatedResponse, RecordView } from '@memo/api-client';
import type { SortOrder } from './createPagedListContext';
import { useNavigation } from '@/contexts/NavigationContext';
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

const DEFAULT_FILTERS: RecordFilters = { locationId: '', serviceId: '', masterId: '', status: '', search: '' };

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

export function RecordsProvider({ children }: { children: React.ReactNode }) {
  const { dateFrom, dateTo } = useNavigation();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [perPage, setPerPageState] = useState(10);
  const [filters, setFiltersState] = useState<RecordFilters>(DEFAULT_FILTERS);
  const [sortBy, setSortBy] = useState<RecordSortField>('date');
  const [sortOrder, setSortOrder] = useState<RecordSortOrder>('asc');

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

  const setFilters = useCallback((newFilters: Partial<RecordFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...newFilters }));
    setPage(1);
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState(DEFAULT_FILTERS);
    setPage(1);
  }, []);

  const setPerPage = useCallback((pp: number) => {
    setPerPageState(pp);
    setPage(1);
  }, []);

  // PagedListState.setSort contract (spec §6.4): field+order applied verbatim
  // + page reset (§6.10.2). Toggle-on-repeat was REMOVED — DataTable owns it
  // (§6.10.4). `field` is `string` per the contract; the server whitelist
  // validates it upstream.
  const setSort = useCallback((field: string, order: SortOrder) => {
    setSortBy(field as RecordSortField);
    setSortOrder(order);
    setPage(1);
  }, []);

  // Spec §6.7 page clamp — after a SETTLED fetch returns an empty non-first
  // page (e.g. last row of page N deleted), step back. `!isFetching` guards
  // against mid-refetch races with keepPreviousData.
  useEffect(() => {
    const items = data?.items || [];
    if (!isPending && !isFetching && items.length === 0 && page > 1) {
      setPage(page - 1);
    }
  }, [isPending, isFetching, data, page]);

  // Date-range change (NavigationContext) resets to page 1
  useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo]);

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
      isLoading: recordsLoading,
      loading: recordsLoading,
      isPending,
      isFetching,
      error: recordsError ?? null,
      refetch,
    }),
    [records, total, page, perPage, filters, sortBy, sortOrder, setPerPage, setFilters, setSort, resetFilters, recordsLoading, isPending, isFetching, recordsError, refetch],
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
