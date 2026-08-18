'use client';

import { createPagedListContext } from './createPagedListContext';
import { getMaterials } from '@memo/api-client';
import type { MaterialResponse } from '@memo/api-client';

const { Provider, usePagedList } = createPagedListContext<MaterialResponse>({
  queryKeyPrefix: 'materials',
  fetcher: (p) =>
    getMaterials({
      page: p.page,
      per_page: p.per_page,
      status: p.status,
      // Sort params omitted until the user picks a sort — server default
      // title ASC, id ASC order (§4.4; no defaultSortBy for materials).
      ...(p.sort_by ? { sort_by: p.sort_by, sort_order: p.sort_order } : {}),
    }),
  withStatus: true,
});

export const MaterialsProvider = Provider;
/** Table list state (server-paginated). NOT the lookup hook — that's hooks/useMaterials.ts. */
export const useMaterialsTable = usePagedList;
