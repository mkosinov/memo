'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getRecords,
  getClients,
  getPaymentTotals,
  getActivities,
  getMasters,
  getServices,
  getLocations,
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
  records: RecordResponse[];
  total: number;
  page: number;
  perPage: number;
  filters: RecordFilters;
  sortBy: RecordSortField;
  sortOrder: RecordSortOrder;
  setPage: (page: number) => void;
  setPerPage: (perPage: number) => void;
  setFilters: (newFilters: Partial<RecordFilters>) => void;
  setSort: (field: RecordSortField) => void;
  resetFilters: () => void;
  clients: Map<string, ClientWithStats>;
  payments: Map<string, number>; // record_id → total paid amount
  activities: Map<string, ActivityResponse>;
  masters: Map<string, MasterResponse>;
  services: Map<string, ServiceResponse>;
  locations: Map<string, LocationResponse>;
  loading: boolean;
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
  const { data, isLoading: recordsLoading, error: recordsError } = useQuery<PaginatedResponse<RecordResponse>>({
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

  const setSort = useCallback((field: RecordSortField) => {
    if (field === sortBy) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  }, [sortBy]);

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

  // Always-cached reference data
  const { data: mastersRaw = [] } = useQuery<MasterResponse[]>({
    queryKey: ['masters'],
    queryFn: () => getMasters({ per_page: 100 }).then(r => r.items),
    staleTime: Infinity,
  });

  const { data: servicesRaw = [] } = useQuery<ServiceResponse[]>({
    queryKey: ['services'],
    queryFn: () => getServices({ per_page: 100 }).then(r => r.items),
    staleTime: Infinity,
  });

  const { data: locationsRaw = [] } = useQuery<LocationResponse[]>({
    queryKey: ['locations'],
    queryFn: () => getLocations({ per_page: 100 }).then(r => r.items),
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
      loading: recordsLoading,
      error: recordsError ?? null,
      refetch,
    }),
    [records, total, page, perPage, filters, sortBy, sortOrder, setPerPage, setFilters, setSort, resetFilters, clients, payments, activities, masters, services, locations, recordsLoading, recordsError, refetch],
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
