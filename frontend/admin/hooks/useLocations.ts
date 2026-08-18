'use client';
import { useQuery } from '@tanstack/react-query';
import { getAllLocations } from '@memo/api-client';
import { transformLocation } from '@/lib/transformers';
import type { LocationResponse } from '@memo/api-client';
import type { Location } from '@memo/domain';

export function useLocations() {
  return useQuery<LocationResponse[], Error, Location[]>({
    queryKey: ['locations'],
    queryFn: () => getAllLocations(),
    select: (raw) => raw.map(transformLocation),
    staleTime: 5 * 60 * 1000,
  });
}
