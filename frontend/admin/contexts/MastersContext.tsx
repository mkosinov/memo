'use client';

import { createPagedListContext } from './createPagedListContext';
import { getMasters } from '@memo/api-client';
import type { MasterResponse } from '@memo/api-client';

const { Provider, usePagedList } = createPagedListContext<MasterResponse>({
  queryKeyPrefix: 'masters',
  fetcher: (p) =>
    getMasters({
      page: p.page,
      per_page: p.per_page,
      status: p.status,
      // Sort params omitted until the user picks a sort — server default order (§4.4).
      ...(p.sort_by ? { sort_by: p.sort_by, sort_order: p.sort_order } : {}),
    }),
  withStatus: true,
  // #139 T3 — dict search is predicate-only (spec §6.7): filters the loaded
  // page into `visibleItems`; `search` stays out of the query key/fetcher.
  // First + last name match, per the MasterFilters placeholder
  // "Имя или фамилия..." (verbatim from the pre-#139 table filter memo).
  searchPredicate: (m, q) => {
    const query = q.toLowerCase();
    return (
      m.first_name.toLowerCase().includes(query) ||
      m.last_name.toLowerCase().includes(query)
    );
  },
});

export const MastersProvider = Provider;
/** Table list state (server-paginated). NOT the lookup hook — that's hooks/useMasters.ts. */
export const useMastersTable = usePagedList;
