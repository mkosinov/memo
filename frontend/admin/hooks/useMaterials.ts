'use client';
import { useQuery } from '@tanstack/react-query';
import { getAllMaterials } from '@memo/api-client';
import type { MaterialResponse } from '@memo/api-client';
import { qk, DICT_STALE_TIME } from '@/lib/queryKeys';

/**
 * Raw ACTIVE materials for pickers (GH #223 spec §8): the admin picker for
 * new links is `/all?status=active` — archived materials are not offered.
 * Bare `qk.materials` key (useTagsRaw precedent) shares the prefix with the
 * paged MaterialsContext queries, so material mutations invalidate it too.
 */
export function useMaterialsRaw() {
  return useQuery<MaterialResponse[]>({
    queryKey: qk.materials,
    queryFn: () => getAllMaterials({ status: 'active' }),
    staleTime: DICT_STALE_TIME,
  });
}
