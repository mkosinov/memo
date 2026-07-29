'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  getRecord, getClientVisitors, getActivity, getServices,
  getMasters, getLocations, getPayments,
} from '@memo/api-client';
import type { VisitStatus } from '@memo/domain';
import { computeRecordStatus } from '@memo/domain';
import type { RecordWithDerived } from '@/app/components/shared/records/types';

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
    queryFn: () => getServices({ per_page: 100 }).then(r => r.items),
  });

  const { data: masters = [] } = useQuery({
    queryKey: ['masters'],
    queryFn: () => getMasters({ per_page: 100 }).then(r => r.items),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => getLocations({ per_page: 100 }).then(r => r.items),
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['payments', recordId],
    queryFn: () => getPayments({ record_id: recordId, per_page: 100 }).then(r => r.items),
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

  // Derive record status from visits
  const status: VisitStatus = useMemo(() => {
    if (!record?.visits) return 'waiting';
    return computeRecordStatus(
      record.visits.map(v => ({ id: v.id, status: (v.status || 'waiting') as VisitStatus })),
    );
  }, [record]);

  // Build RecordWithDerived for shared atom consumption
  const recordData: RecordWithDerived | null = useMemo(() => {
    if (!record) return null;
    return {
      record,
      status,
      visits: record.visits ?? [],
      payments: Array.isArray(payments) ? payments : [],
      client: null, // Parents provide client info via props when available
      tariffs,
    };
  }, [record, status, payments, tariffs]);

  return {
    recordData,
    record, visitors, activity, services, masters, locations,
    payments, visitorsMap, tariffs, isLoading, status,
  };
}
