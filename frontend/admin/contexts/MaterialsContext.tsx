'use client';

import { createPagedListContext } from './createPagedListContext';
import { getMaterials } from '@memo/api-client';
import type { MaterialResponse } from '@memo/api-client';
import { qk } from '@/lib/queryKeys';

const { Provider, usePagedList } = createPagedListContext<MaterialResponse>({
  queryKeyPrefix: qk.materials[0],
  fetcher: (p) =>
    getMaterials({
      page: p.page,
      per_page: p.per_page,
      status: p.status,
      // Sort params omitted until the user picks a sort — server default
      // title ASC, id ASC order (§4.4; no defaultSortBy for materials).
      ...(p.sort_by ? { sort_by: p.sort_by, sort_order: p.sort_order } : {}),
      ...(p.q ? { q: p.q } : {}),
    }),
  withStatus: true,
  // GH #212 T11 — dict search is server-side: the factory clamps q to ≥2
  // chars, puts it in the query key, and the fetcher sends it on. The #139
  // predicate mechanism (temporary degradation, §6.7) is retired here; the
  // title matching now lives in the backend list ?q=.
  serverSearch: true,
});

export const MaterialsProvider = Provider;
/** Table list state (server-paginated). NOT the lookup hook — that's hooks/useMaterials.ts. */
export const useMaterialsTable = usePagedList;
