'use client';
import { useQuery } from '@tanstack/react-query';
import { getAllStaff } from '@memo/api-client';
import type { StaffResponse } from '@memo/api-client';
import { qk, DICT_STALE_TIME } from '@/lib/queryKeys';

/**
 * Bare staff lookup (GH #266) — GET /api/v1/staff/all on the ['staff']
 * family. The paged StaffContext list shares the prefix, so family
 * invalidation (SSE `staff` events + own mutations) refreshes both.
 * No domain transform: there is no Staff domain type — the card is consumed
 * as the raw StaffResponse (master section + position ids + has_user).
 */
export function useStaff() {
  return useQuery<StaffResponse[]>({
    queryKey: qk.staff,
    queryFn: () => getAllStaff(),
    staleTime: DICT_STALE_TIME,
  });
}
