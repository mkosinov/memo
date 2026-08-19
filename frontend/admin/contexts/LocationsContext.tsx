'use client';

import { createPagedListContext } from './createPagedListContext';
import { getLocations } from '@memo/api-client';
import type { LocationResponse } from '@memo/api-client';

const { Provider, usePagedList } = createPagedListContext<LocationResponse>({
  queryKeyPrefix: 'locations',
  fetcher: (p) =>
    getLocations({
      page: p.page,
      per_page: p.per_page,
      status: p.status,
      // Sort params omitted until the user picks a sort — server default order (§4.4).
      ...(p.sort_by ? { sort_by: p.sort_by, sort_order: p.sort_order } : {}),
    }),
  withStatus: true,
  // #139 T2 — dict search is predicate-only (spec §6.7): filters the loaded
  // page into `visibleItems`; `search` stays out of the query key/fetcher.
  // Name + address match, per the LocationFilters placeholder
  // "Название или адрес..." (verbatim from the pre-#139 table filter memo).
  searchPredicate: (l, q) => {
    const query = q.toLowerCase();
    return (
      l.name.toLowerCase().includes(query) ||
      (l.address ?? '').toLowerCase().includes(query)
    );
  },
});

export const LocationsProvider = Provider;
/** Table list state (server-paginated). NOT the lookup hook — that's hooks/useLocations.ts. */
export const useLocationsTable = usePagedList;
