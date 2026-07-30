'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  RecordResponse,
  ClientWithStats,
  ActivityResponse,
  MasterResponse,
  ServiceResponse,
  LocationResponse,
} from '@memo/api-client';
import { useNavigation } from '@/contexts/NavigationContext';
import { seedRecordFromList } from '@/lib/cache/recordCacheSync';

export interface RecordsContextType {
  records: RecordResponse[];
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

  const refetch = useCallback(() => {
    void queryClient.refetchQueries({ queryKey: ['records'] });
  }, [queryClient]);

  // Period-based data
  const { data: records = [], isLoading: recordsLoading, error: recordsError } = useQuery<RecordResponse[]>({
    queryKey: ['records', dateFrom, dateTo],
    queryFn: () => getRecords({ date_from: dateFrom, date_to: dateTo, per_page: 100 }).then(r => r.items),
  });

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
      Object.entries(paymentTotals).forEach(([recordId, total]) => map.set(recordId, total));
    }
    return map;
  }, [paymentTotals]);

  const contextValue = useMemo(
    () => ({
      records,
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
    [records, clients, payments, activities, masters, services, locations, recordsLoading, recordsError, refetch],
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
