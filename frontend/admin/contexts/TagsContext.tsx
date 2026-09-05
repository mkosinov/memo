'use client';

import { createPagedListContext } from './createPagedListContext';
import { getTags } from '@memo/api-client';
import type { TagResponse } from '@memo/api-client';
import { qk } from '@/lib/queryKeys';

const { Provider, usePagedList } = createPagedListContext<TagResponse>({
  queryKeyPrefix: qk.tags[0],
  fetcher: (p) =>
    getTags({
      page: p.page,
      per_page: p.per_page,
      // Tags carry NO archive status (withStatus: false) — no status param,
      // no queryKey slot. undefined sort keys are skipped by listQuery (§5.2).
      // Sort params omitted until the user picks a sort — server default
      // tag ASC, id ASC order (§4.4; no defaultSortBy for tags).
      ...(p.sort_by ? { sort_by: p.sort_by, sort_order: p.sort_order } : {}),
      ...(p.q ? { q: p.q } : {}),
    }),
  withStatus: false,
  // GH #212 T11 — dict search is server-side: the factory clamps q to ≥2
  // chars, puts it in the query key, and the fetcher sends it on. The #139
  // predicate mechanism (temporary degradation, §6.7) is retired here.
  serverSearch: true,
});

export const TagsProvider = Provider;
/** Table list state (server-paginated). Tags have no lookup hook consumers (§5.5). */
export const useTagsTable = usePagedList;
