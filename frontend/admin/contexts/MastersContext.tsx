'use client';

import { createPagedListContext } from './createPagedListContext';
import { getMasters } from '@memo/api-client';
// GH #266: /masters is a READ-ONLY view (acting masters, masters.is_active =
// true) — MasterViewResponse carries no `archived`/`position` (the view only
// returns acting rows; positions live on the staff card). Writes moved to
// /api/v1/staff (the «Сотрудники» screen owns them via StaffContext).
import type { MasterViewResponse } from '@memo/api-client';
import { qk } from '@/lib/queryKeys';

const { Provider, usePagedList } = createPagedListContext<MasterViewResponse>({
  queryKeyPrefix: qk.masters[0],
  fetcher: (p) =>
    getMasters({
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
  // first+last name matching now lives in the backend list ?q=.
  serverSearch: true,
});

export const MastersProvider = Provider;
/** Table list state (server-paginated). NOT the lookup hook — that's hooks/useMasters.ts.
 *  GH #266: retained as the read-only /masters paged-list state; the staff
 *  directory screen uses StaffContext (/api/v1/staff) instead. */
export const useMastersTable = usePagedList;
