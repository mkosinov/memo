'use client';
import { useQuery } from '@tanstack/react-query';
import { getMasters } from '@memo/api-client';
import { transformMaster } from '@/lib/transformers';
import type { MasterResponse } from '@memo/api-client';
import type { Artist } from '@memo/domain';

export function useMasters() {
  return useQuery<MasterResponse[], Error, Artist[]>({
    queryKey: ['masters'],
    queryFn: () => getMasters(),
    select: (raw) => raw.map(transformMaster),
    staleTime: 5 * 60 * 1000,
  });
}
