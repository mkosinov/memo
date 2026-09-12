'use client';
import { useQuery } from '@tanstack/react-query';
import { getAllMasters } from '@memo/api-client';
import { transformMaster } from '@/lib/transformers';
// GH #266: /masters is the read-only ACTING-master view (MasterViewResponse).
// No `archived` field — the view only returns masters.is_active = true rows,
// so consumers no longer filter by archived (they already get acting ones).
import type { MasterViewResponse } from '@memo/api-client';
import type { Master } from '@memo/domain';
import { qk, DICT_STALE_TIME } from '@/lib/queryKeys';

export function useMasters() {
  return useQuery<MasterViewResponse[], Error, Master[]>({
    queryKey: qk.masters,
    queryFn: () => getAllMasters(),
    select: (raw) => raw.map(transformMaster),
    staleTime: DICT_STALE_TIME,
  });
}

/** Raw acting masters (view shape) — SAME key as useMasters (dedupe); keep staleTimes aligned. */
export function useMastersRaw() {
  return useQuery<MasterViewResponse[]>({
    queryKey: qk.masters,
    queryFn: () => getAllMasters(),
    staleTime: DICT_STALE_TIME,
  });
}
