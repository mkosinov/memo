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
});

export const MastersProvider = Provider;
/** Table list state (server-paginated). NOT the lookup hook — that's hooks/useMasters.ts. */
export const useMastersTable = usePagedList;
