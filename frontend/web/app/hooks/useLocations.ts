'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getLocations } from '@memo/api-client';
import { toLocationViewFromResponse } from '@/app/lib/mappers/to-location-vm';
import type { LocationView } from '@/app/lib/model/view/location';

export interface UseLocationsResult {
  locations: LocationView[];
  isLoading: boolean;
  error: Error | null;
}

/** Locations directory via the shared ['locations'] react-query cache —
 * same key and stale/gc policy as useSchedule, so a page mounting both
 * hooks issues a single request (GH #479). */
export function useLocations(): UseLocationsResult {
  const { data, isLoading, error } = useQuery({
    queryKey: ['locations'],
    queryFn: () => getLocations(),
    staleTime: 300_000,
    gcTime: 600_000,
  });

  const locations = useMemo(
    () => data?.items.map(toLocationViewFromResponse) ?? [],
    [data],
  );

  return { locations, isLoading, error };
}
