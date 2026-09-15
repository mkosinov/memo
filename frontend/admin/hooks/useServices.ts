'use client';
import { useQuery } from '@tanstack/react-query';
import { getAllServices } from '@memo/api-client';
import { transformService } from '@/lib/transformers';
import type { ServiceResponse } from '@memo/api-client';
import type { Service } from '@memo/domain';
import { qk, DICT_STALE_TIME } from '@/lib/queryKeys';

export function useServices() {
  return useQuery<ServiceResponse[], Error, Service[]>({
    queryKey: qk.services,
    queryFn: () => getAllServices(),
    select: (raw) => raw.map(transformService),
    staleTime: DICT_STALE_TIME,
  });
}

/** Raw services (active rows — no status param) — SAME key as useServices (dedupe); keep staleTimes aligned. */
export function useServicesRaw() {
  return useQuery<ServiceResponse[]>({
    queryKey: qk.services,
    queryFn: () => getAllServices(),
    staleTime: DICT_STALE_TIME,
  });
}

/**
 * Schedule grid dictionary (GH #267): FULL list incl. archived via status=all,
 * OWN key nested under the ['services'] prefix — prefix-invalidation from
 * lib/invalidate.ts and the SSE channel reaches it untouched.
 */
export function useScheduleServices() {
  return useQuery<ServiceResponse[]>({
    queryKey: qk.scheduleServices,
    queryFn: () => getAllServices({ status: 'all' }),
    staleTime: DICT_STALE_TIME,
  });
}
