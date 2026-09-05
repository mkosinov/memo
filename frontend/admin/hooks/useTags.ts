'use client';
import { useQuery } from '@tanstack/react-query';
import { getAllTags } from '@memo/api-client';
import type { TagResponse } from '@memo/api-client';
import { qk, DICT_STALE_TIME } from '@/lib/queryKeys';

/** Raw tags (post-#213 canonical /all fetcher) — PhotosFilters chips typeahead. */
export function useTagsRaw() {
  return useQuery<TagResponse[]>({
    queryKey: qk.tags,
    queryFn: () => getAllTags(),
    staleTime: DICT_STALE_TIME,
  });
}
