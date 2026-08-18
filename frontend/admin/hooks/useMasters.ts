'use client';
import { useQuery } from '@tanstack/react-query';
import { getAllMasters } from '@memo/api-client';
import { transformMaster } from '@/lib/transformers';
import type { MasterResponse } from '@memo/api-client';
import type { Master } from '@memo/domain';

export function useMasters() {
  return useQuery<MasterResponse[], Error, Master[]>({
    queryKey: ['masters'],
    queryFn: () => getAllMasters(),
    select: (raw) => raw.map(transformMaster),
    staleTime: 5 * 60 * 1000,
  });
}
