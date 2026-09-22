'use client';

import { createPagedListContext } from './createPagedListContext';
import { getAuditLogs } from '@memo/api-client';
import type { AuditLogResponse } from '@memo/api-client';
import { qk } from '@/lib/queryKeys';

/** GH #344 §7 — the «Журнал» filters: author dropdown + action + entity +
 *  period. All strings ('' = unset); empty values never reach the wire. */
export interface AuditLogFilters {
  user_id: string;
  action: string;
  entity: string;
  date_from: string; // YYYY-MM-DD ('' = unset)
  date_to: string;
}

/** Exported for the test fixture — single source. */
export const defaultAuditFilters: AuditLogFilters = {
  user_id: '',
  action: '',
  entity: '',
  date_from: '',
  date_to: '',
};

// GH #344 — page-scoped paged-list state over GET /api/v1/audit-logs,
// the ClientsContext precedent. Sorting is SERVER-FIXED created_at DESC
// (spec §7): no defaultSort and the fetcher DROPS the factory's sort
// params (sortBy stays null for the page's lifetime — headers render
// non-sortable via column config). Empty filter strings ('' = unset,
// ClientsContext `search` suppression precedent) are stripped AFTER the
// spread so they never reach the wire params at all.
const { Provider, usePagedList } = createPagedListContext<AuditLogResponse, AuditLogFilters>({
  queryKeyPrefix: qk.auditLogs[0],
  fetcher: (p) => {
    const { user_id, action, entity, date_from, date_to } = p.filters;
    return getAuditLogs({
      page: p.page,
      per_page: p.per_page,
      // Sort deliberately NOT forwarded — created_at DESC is fixed server-side.
      ...(user_id ? { user_id } : {}),
      ...(action ? { action } : {}),
      ...(entity ? { entity } : {}),
      ...(date_from ? { date_from } : {}),
      ...(date_to ? { date_to } : {}),
    });
  },
  withStatus: false, // the journal has no archive dimension
  filters: { defaults: defaultAuditFilters },
  defaultPerPage: 20,
});

export const AuditLogProvider = Provider;
/** Table list state (server-paginated, page-scoped). */
export const useAuditLogTable = usePagedList;
