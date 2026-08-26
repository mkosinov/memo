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
      ...(p.q ? { q: p.q } : {}),
    }),
  withStatus: true,
  // GH #212 T11 — dict search is server-side: the factory clamps q to ≥2
  // chars, puts it in the query key, and the fetcher sends it on. The #139
  // predicate mechanism (temporary degradation, §6.7) is retired here; the
  // name+address field matching now lives in the backend list ?q=.
  serverSearch: true,
});

export const LocationsProvider = Provider;
/** Table list state (server-paginated). NOT the lookup hook — that's hooks/useLocations.ts. */
export const useLocationsTable = usePagedList;
