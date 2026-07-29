'use client';
import { useQuery } from '@tanstack/react-query';
import { getMasters } from '@memo/api-client';
import { transformMaster } from '@/lib/transformers';
import type { MasterResponse } from '@memo/api-client';
import type { Master } from '@memo/domain';

export function useMasters() {
  return useQuery<MasterResponse[], Error, Master[]>({
    queryKey: ['masters'],
    queryFn: () => getMasters({ per_page: 100 }).then(r => r.items),
    select: (raw) => raw.map(transformMaster),
    staleTime: 5 * 60 * 1000,
  });
}
