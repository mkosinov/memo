'use client';
import { useQuery } from '@tanstack/react-query';
import { getAllLocations } from '@memo/api-client';
import { transformLocation } from '@/lib/transformers';
import type { LocationResponse } from '@memo/api-client';
import type { Location } from '@memo/domain';
import { qk, DICT_STALE_TIME } from '@/lib/queryKeys';

export function useLocations() {
  return useQuery<LocationResponse[], Error, Location[]>({
    queryKey: qk.locations,
    queryFn: () => getAllLocations(),
    select: (raw) => raw.map(transformLocation),
    staleTime: DICT_STALE_TIME,
  });
}

/** Raw locations incl. `archived` — SAME key as useLocations (dedupe); keep staleTimes aligned. */
export function useLocationsRaw() {
  return useQuery<LocationResponse[]>({
    queryKey: qk.locations,
    queryFn: () => getAllLocations(),
    staleTime: DICT_STALE_TIME,
  });
}
