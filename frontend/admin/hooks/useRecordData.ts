'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  getRecord, getClientVisitors, getActivity, getServices,
  getMasters, getLocations, getPayments,
} from '@memo/api-client';

export function useRecordData(recordId: string, clientId: string) {
  const { data: record, isLoading } = useQuery({
    queryKey: ['record', recordId],
    queryFn: () => getRecord(recordId),
  });

  const { data: visitors = [] } = useQuery({
    queryKey: ['visitors', clientId],
    queryFn: () => getClientVisitors(clientId),
    enabled: !!clientId,
  });

  const { data: activity } = useQuery({
    queryKey: ['activity', record?.activity_id],
    queryFn: () => getActivity(record!.activity_id),
    enabled: !!record?.activity_id,
  });

  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: () => getServices(),
  });

  const { data: masters = [] } = useQuery({
    queryKey: ['masters'],
    queryFn: () => getMasters(),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => getLocations(),
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['payments', recordId],
    queryFn: () => getPayments({ record_id: recordId }),
    enabled: !!recordId,
  });

  const visitorsMap = useMemo(() => {
    const map = new Map<string, { name: string; age: number | null }>();
    if (Array.isArray(visitors)) {
      visitors.forEach(v => map.set(v.id, { name: v.name, age: v.age }));
    }
    return map;
  }, [visitors]);

  const tariffs = useMemo(() => {
    if (!Array.isArray(services)) return [];
    const service = services.find(s => s.id === activity?.service_id);
    return service?.tariffs ?? [];
  }, [services, activity]);

  return {
    record, visitors, activity, services, masters, locations,
    payments, visitorsMap, tariffs, isLoading,
  };
}
