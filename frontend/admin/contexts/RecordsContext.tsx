'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getRecords,
  getClients,
  getPayments,
  getActivities,
  getMasters,
  getServices,
  getLocations,
} from '@memo/api-client';
import type {
  RecordResponse,
  ClientResponse,
  PaymentResponse,
  ActivityResponse,
  MasterResponse,
  ServiceResponse,
  LocationResponse,
} from '@memo/api-client';
import { useNavigation } from '@/contexts/NavigationContext';
import { seedRecordFromList } from '@/lib/cache/recordCacheSync';

export interface RecordsContextType {
  records: RecordResponse[];
  clients: Map<string, ClientResponse>;
  payments: Map<string, PaymentResponse[]>;
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
  const { data: clientsRaw = [] } = useQuery<ClientResponse[]>({
    queryKey: ['clients'],
    queryFn: () => getClients(),
    staleTime: Infinity,
  });

  // Payments (all — API only supports record_id filter, not date range)
  const { data: paymentsRaw = [] } = useQuery<PaymentResponse[]>({
    queryKey: ['payments'],
    queryFn: () => getPayments({ per_page: 100 }).then(r => r.items),
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
    const map = new Map<string, ClientResponse>();
    clientsRaw.forEach(c => map.set(c.id, c));
    return map;
  }, [clientsRaw]);

  const payments = useMemo(() => {
    const map = new Map<string, PaymentResponse[]>();
    paymentsRaw.forEach(p => {
      const arr = map.get(p.record_id) ?? [];
      arr.push(p);
      map.set(p.record_id, arr);
    });
    return map;
  }, [paymentsRaw]);

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
