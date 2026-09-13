'use client';

import { createPagedListContext } from './createPagedListContext';
import { getPositions } from '@memo/api-client';
import type { PositionResponse } from '@memo/api-client';
import { qk } from '@/lib/queryKeys';

/**
 * Positions dictionary — server-paginated TABLE state (GH #266 T9, D4).
 *
 * Shares the ['positions'] key PREFIX with the /all lookup hook
 * (hooks/usePositions.ts), so one prefix invalidation refreshes both the
 * StaffModal checkbox list and this table. NOT in lib/invalidate.ts's
 * INVALIDATION_MAP (spec «SSE-сущности» — the frontend SSE mirror has no
 * positions family; usePositionsMutations.ts invalidates the prefix directly).
 *
 * No status filter (the dictionary is not archive-aware), no sort and no
 * search: GET /api/v1/positions accepts pagination only — the backend order is
 * `title ASC, id ASC`.
 */
const { Provider, usePagedList } = createPagedListContext<PositionResponse>({
  queryKeyPrefix: qk.positions[0],
  fetcher: (p) => getPositions({ page: p.page, per_page: p.per_page }),
  withStatus: false,
});

export const PositionsProvider = Provider;
/** Table list state (server-paginated). NOT the lookup hook — that's hooks/usePositions.ts. */
export const usePositionsTable = usePagedList;
