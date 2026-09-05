'use client';
import { useQuery } from '@tanstack/react-query';
import { getAllMasters } from '@memo/api-client';
import { transformMaster } from '@/lib/transformers';
import type { MasterResponse } from '@memo/api-client';
import type { Master } from '@memo/domain';
import { qk, DICT_STALE_TIME } from '@/lib/queryKeys';

export function useMasters() {
  return useQuery<MasterResponse[], Error, Master[]>({
    queryKey: qk.masters,
    queryFn: () => getAllMasters(),
    select: (raw) => raw.map(transformMaster),
    staleTime: DICT_STALE_TIME,
  });
}

/** Raw masters incl. `archived` — SAME key as useMasters (dedupe); keep staleTimes aligned. */
export function useMastersRaw() {
  return useQuery<MasterResponse[]>({
    queryKey: qk.masters,
    queryFn: () => getAllMasters(),
    staleTime: DICT_STALE_TIME,
  });
}
