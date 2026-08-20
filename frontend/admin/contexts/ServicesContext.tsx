'use client';

import { createPagedListContext } from './createPagedListContext';
import { getServices } from '@memo/api-client';
import type { ServiceResponse } from '@memo/api-client';

const { Provider, usePagedList } = createPagedListContext<ServiceResponse>({
  queryKeyPrefix: 'services',
  fetcher: (p) =>
    getServices({
      page: p.page,
      per_page: p.per_page,
      status: p.status,
      // Sort params omitted until the user picks a sort — server default
      // title ASC, id ASC order (§4.4; no defaultSortBy for services).
      // `age`/`tariffs` keys pass through — the backend whitelist (Task 3)
      // maps them to min_age and the tariffs-count subquery.
      ...(p.sort_by ? { sort_by: p.sort_by, sort_order: p.sort_order } : {}),
    }),
  withStatus: true,
  // #139 T5 — dict search is predicate-only (spec §6.7): filters the loaded
  // page into `visibleItems`; `search` stays out of the query key/fetcher.
  // Title-only match, per the pre-#139 table filter memo (title lowercase
  // includes) — verbatim behavior moved from ServicesTable.
  searchPredicate: (s, q) => s.title.toLowerCase().includes(q.toLowerCase()),
});

export const ServicesProvider = Provider;
/** Table list state (server-paginated). NOT the lookup hook — that's hooks/useServices.ts. */
export const useServicesTable = usePagedList;
