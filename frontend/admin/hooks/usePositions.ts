'use client';
import { useQuery } from '@tanstack/react-query';
import { getAllPositions } from '@memo/api-client';
import type { PositionResponse } from '@memo/api-client';
import { qk, DICT_STALE_TIME } from '@/lib/queryKeys';

/**
 * Positions dictionary lookup (GH #266 D4) — bare GET /api/v1/positions/all.
 * Consumers: StaffTable (id → title cells) and StaffModal (checkbox list).
 * The ['positions'] key is NOT in the SSE invalidate map (spec
 * «SSE-сущности»: the backend emits the entity, the frontend mirror has no
 * positions family — drift guard __tests__/invalidate.test.ts). Freshness comes
 * from the dictionary staleTime plus the T9 directory screen, whose mutations
 * invalidate this prefix directly (hooks/usePositionsMutations.ts) — one prefix
 * covers both this /all lookup and the paged PositionsContext table.
 */
export function usePositions() {
  return useQuery<PositionResponse[]>({
    queryKey: qk.positions,
    queryFn: () => getAllPositions(),
    staleTime: DICT_STALE_TIME,
  });
}
