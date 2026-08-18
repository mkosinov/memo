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
});

export const LocationsProvider = Provider;
/** Table list state (server-paginated). NOT the lookup hook — that's hooks/useLocations.ts. */
export const useLocationsTable = usePagedList;
