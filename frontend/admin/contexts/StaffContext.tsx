'use client';

import { createPagedListContext } from './createPagedListContext';
import { getStaff } from '@memo/api-client';
import type { StaffResponse, StaffSortBy } from '@memo/api-client';
import { qk } from '@/lib/queryKeys';

/**
 * Staff directory table state (GH #266) — the «Сотрудники» screen's
 * server-paginated list over GET /api/v1/staff.
 *
 * Mirrors the former MastersContext wiring (#205 §5.2 + #212 serverSearch):
 * status filter (active|archived|all), server sort (whitelist WITHOUT
 * `position` — M2M makes it ambiguous, spec «API»), ?q= name search.
 * MastersContext stays alive as the read-only /masters consumer (schedule
 * filters) — this context owns the directory screen only.
 */
const { Provider, usePagedList } = createPagedListContext<StaffResponse>({
  queryKeyPrefix: qk.staff[0],
  fetcher: (p) =>
    getStaff({
      page: p.page,
      per_page: p.per_page,
      status: p.status,
      // Sort params omitted until the user picks a sort — server default
      // order (sort_order ASC, first_name ASC, id ASC; §4.4).
      ...(p.sort_by ? { sort_by: p.sort_by as StaffSortBy, sort_order: p.sort_order } : {}),
      ...(p.q ? { q: p.q } : {}),
    }),
  withStatus: true,
  // GH #212 — dict search is server-side: the factory clamps q to ≥2 chars,
  // puts it in the query key, and the fetcher sends it on (first_name +
  // last_name substring + exact-uuid, now on /staff).
  serverSearch: true,
});

export const StaffProvider = Provider;
/** Table list state (server-paginated). The bare lookup hook is hooks/useStaff.ts. */
export const useStaffTable = usePagedList;
