'use client';

import { createPagedListContext } from './createPagedListContext';
import { getTags } from '@memo/api-client';
import type { TagResponse } from '@memo/api-client';

const { Provider, usePagedList } = createPagedListContext<TagResponse>({
  queryKeyPrefix: 'tags',
  fetcher: (p) =>
    getTags({
      page: p.page,
      per_page: p.per_page,
      // Tags carry NO archive status (withStatus: false) — no status param,
      // no queryKey slot. undefined sort keys are skipped by listQuery (§5.2).
      // Sort params omitted until the user picks a sort — server default
      // tag ASC, id ASC order (§4.4; no defaultSortBy for tags).
      ...(p.sort_by ? { sort_by: p.sort_by, sort_order: p.sort_order } : {}),
    }),
  withStatus: false,
  // #139 T1 — dict search is predicate-only (spec §6.7): filters the loaded
  // page into `visibleItems`; `search` stays out of the query key/fetcher.
  searchPredicate: (t, q) => t.tag.toLowerCase().includes(q.toLowerCase()),
});

export const TagsProvider = Provider;
/** Table list state (server-paginated). Tags have no lookup hook consumers (§5.5). */
export const useTagsTable = usePagedList;
