'use client';
import { useQuery } from '@tanstack/react-query';
import { getServices } from '@memo/api-client';
import { transformService } from '@/lib/transformers';
import type { ServiceResponse } from '@memo/api-client';
import type { Service } from '@memo/domain';

export function useServices() {
  return useQuery<ServiceResponse[], Error, Service[]>({
    queryKey: ['services'],
    queryFn: () => getServices({ per_page: 100 }).then(r => r.items),
    select: (raw) => raw.map(transformService),
    staleTime: 5 * 60 * 1000,
  });
}
