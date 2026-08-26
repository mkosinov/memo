'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getRecords,
  getClients,
  getPaymentTotals,
  getActivities,
  getAllMasters,
  getAllServices,
  getAllLocations,
} from '@memo/api-client';
import type {
  PaginatedResponse,
  RecordResponse,
  ClientWithStats,
  ActivityResponse,
  MasterResponse,
  ServiceResponse,
  LocationResponse,
} from '@memo/api-client';
import type { SortOrder } from './createPagedListContext';
import { useNavigation } from '@/contexts/NavigationContext';
import { seedRecordFromList } from '@/lib/cache/recordCacheSync';

export interface RecordFilters {
  locationId: string;
  serviceId: string;
  masterId: string;
  status: string;
}

export type RecordSortField =
  | 'date' | 'client' | 'service' | 'master' | 'location'
  | 'guests' | 'status' | 'total' | 'payment';
export type RecordSortOrder = 'asc' | 'desc';

const DEFAULT_FILTERS: RecordFilters = { locationId: '', serviceId: '', masterId: '', status: '' };

export interface RecordsContextType {
  /** Server-page items — PagedListState.items contract (spec §6.4, #139 T8). */
  items: RecordResponse[];
  /** Kept alongside `items` for backwards compat with non-table consumers. */
  records: RecordResponse[];
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
  clients: Map<string, ClientWithStats>;
  payments: Map<string, number>; // record_id → total paid amount
  activities: Map<string, ActivityResponse>;
  masters: Map<string, MasterResponse>;
  services: Map<string, ServiceResponse>;
  locations: Map<string, LocationResponse>;
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
    void queryClient.refetchQueries({ queryKey: ['records'] });
  }, [queryClient]);

  // Server-driven records list (#191) — queryKey carries every server param
  const { data, isLoading: recordsLoading, isPending, isFetching, error: recordsError } = useQuery<PaginatedResponse<RecordResponse>>({
    queryKey: ['records', page, perPage, dateFrom, dateTo, filters, sortBy, sortOrder],
    queryFn: () => getRecords({
      page,
      per_page: perPage,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      location_id: filters.locationId || undefined,
      service_id: filters.serviceId || undefined,
      master_id: filters.masterId || undefined,
      status: filters.status || undefined,
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

  const { data: activitiesRaw = [] } = useQuery<ActivityResponse[]>({
    queryKey: ['activities', dateFrom, dateTo],
    queryFn: () => getActivities({ date_from: dateFrom, date_to: dateTo, per_page: 100 }).then(r => r.items),
  });

  // Always-cached reference data (bare /all lists — #205)
  const { data: mastersRaw = [] } = useQuery<MasterResponse[]>({
    queryKey: ['masters'],
    queryFn: () => getAllMasters(),
    staleTime: Infinity,
  });

  const { data: servicesRaw = [] } = useQuery<ServiceResponse[]>({
    queryKey: ['services'],
    queryFn: () => getAllServices(),
    staleTime: Infinity,
  });

  const { data: locationsRaw = [] } = useQuery<LocationResponse[]>({
    queryKey: ['locations'],
    queryFn: () => getAllLocations(),
    staleTime: Infinity,
  });

  // Clients (all active clients — not period-based)
  const { data: clientsRaw = [] } = useQuery<ClientWithStats[]>({
    queryKey: ['clients'],
    queryFn: () => getClients(),
    staleTime: Infinity,
  });

  // Payment totals for the currently loaded records (batch aggregate — replaces unfiltered getPayments, #186)
  const recordIds = useMemo(() => records.map((r) => r.id).sort(), [records]);
  const { data: paymentTotals } = useQuery({
    queryKey: ['payments', 'totals', recordIds],
    queryFn: () => getPaymentTotals(recordIds),
    enabled: recordIds.length > 0,
  });

  // Build maps for O(1) lookup
  const activities = useMemo(() => {
    const map = new Map<string, ActivityResponse>();
    activitiesRaw.forEach(a => map.set(a.id, a));
    return map;
  }, [activitiesRaw]);

  const masters = useMemo(() => {
    const map = new Map<string, MasterResponse>();
    mastersRaw.forEach(m => map.set(m.id, m));
    return map;
  }, [mastersRaw]);

  const services = useMemo(() => {
    const map = new Map<string, ServiceResponse>();
    servicesRaw.forEach(s => map.set(s.id, s));
    return map;
  }, [servicesRaw]);

  const locations = useMemo(() => {
    const map = new Map<string, LocationResponse>();
    locationsRaw.forEach(l => map.set(l.id, l));
    return map;
  }, [locationsRaw]);

  const clients = useMemo(() => {
    const map = new Map<string, ClientWithStats>();
    clientsRaw.forEach(c => map.set(c.id, c));
    return map;
  }, [clientsRaw]);

  const payments = useMemo(() => {
    const map = new Map<string, number>();
    if (paymentTotals) {
      Object.entries(paymentTotals).forEach(([recordId, paidTotal]) => map.set(recordId, paidTotal));
    }
    return map;
  }, [paymentTotals]);

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
      clients,
      payments,
      activities,
      masters,
      services,
      locations,
      isLoading: recordsLoading,
      loading: recordsLoading,
      isPending,
      isFetching,
      error: recordsError ?? null,
      refetch,
    }),
    [records, total, page, perPage, filters, sortBy, sortOrder, setPerPage, setFilters, setSort, resetFilters, clients, payments, activities, masters, services, locations, recordsLoading, isPending, isFetching, recordsError, refetch],
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
