'use client';

import { createPagedListContext } from './createPagedListContext';
import { getSpecialties } from '@memo/api-client';
import type { SpecialtyResponse } from '@memo/api-client';
import { qk } from '@/lib/queryKeys';

/**
 * Specialties dictionary — server-paginated TABLE state (GH #599 Task 8.1,
 * the «Направления» third view of the /services page — the materials
 * precedent, spec §2.3).
 *
 * Shares the ['specialties'] key PREFIX with the future /all lookup hook
 * (the Task 8.2/8.3 dropdown consumers), so one prefix invalidation
 * refreshes both. NOT in lib/invalidate.ts's INVALIDATION_MAP (the positions
 * SSE-omission rule — the frontend mirror has no specialties family;
 * useSpecialtiesMutations.ts invalidates the prefix directly).
 *
 * No status filter (the dictionary is not archive-aware — hard-delete
 * family), no sort and no search: GET /api/v1/specialties accepts pagination
 * only (domain-rules/specialties.md List contract); the backend order is
 * fixed at `title ASC, id ASC`.
 */
const { Provider, usePagedList } = createPagedListContext<SpecialtyResponse>({
  queryKeyPrefix: qk.specialties[0],
  fetcher: (p) => getSpecialties({ page: p.page, per_page: p.per_page }),
  withStatus: false,
});

export const SpecialtiesProvider = Provider;
/** Table list state (server-paginated). NOT the lookup hook — that lands with the Task 8.2/8.3 dropdowns. */
export const useSpecialtiesTable = usePagedList;
