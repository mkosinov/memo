'use client';
import { useQuery } from '@tanstack/react-query';
import { getAllPositions } from '@memo/api-client';
import type { PositionResponse } from '@memo/api-client';
import { qk, DICT_STALE_TIME } from '@/lib/queryKeys';

/**
 * Positions dictionary lookup (GH #266 D4) — bare GET /api/v1/positions/all.
 * Consumers: StaffTable (id → title cells) and StaffModal (checkbox list).
 * The ['positions'] key is NOT in the SSE invalidate map (spec
 * «SSE-сущности»: positions events are a no-op until the T9 directory screen
 * lands); dictionary staleTime keeps it fresh enough, and T9 mutations will
 * invalidate this key directly.
 */
export function usePositions() {
  return useQuery<PositionResponse[]>({
    queryKey: qk.positions,
    queryFn: () => getAllPositions(),
    staleTime: DICT_STALE_TIME,
  });
}
