'use client';

import { createPagedListContext } from './createPagedListContext';
import { getClientsWithStats } from '@memo/api-client';
import type { ClientWithStats } from '@memo/api-client';
import { qk } from '@/lib/queryKeys';

export interface ClientFilters {
  search: string;
  status: 'active' | 'all' | 'archived';
  created_from: string;
  created_to: string;
  updated_from: string;
  updated_to: string;
  min_records: number | null;
  max_records: number | null;
  min_paid: number | null;
  max_paid: number | null;
  missed_from: number | null;
  missed_to: number | null;
}

/** Exported for the test fixture (createMockClientsTableState) — single source. */
export const defaultFilters: ClientFilters = {
  search: '',
  status: 'active',
  created_from: '',
  created_to: '',
  updated_from: '',
  updated_to: '',
  min_records: null,
  max_records: null,
  min_paid: null,
  max_paid: null,
  missed_from: null,
  missed_to: null,
};

// GH #140 — the hand-rolled context dissolved into the shared factory
// (#205). Query key slot order matches the pre-#140 key exactly:
// ['clients', page, perPage, filters, sortBy, sortOrder]. Mutations moved to
// hooks/useClientsMutations (each consumer owns its hook instance).
const { Provider, usePagedList } = createPagedListContext<ClientWithStats, ClientFilters>({
  queryKeyPrefix: qk.clients[0],
  fetcher: (p) =>
    getClientsWithStats({
      page: p.page,
      per_page: p.per_page,
      ...(p.sort_by ? { sort_by: p.sort_by, sort_order: p.sort_order } : {}),
      ...p.filters,
      // search→q rename (#212): ≥2 chars sends q; raw `search` suppressed after spread
      q: p.filters.search.length >= 2 ? p.filters.search : undefined,
      search: undefined,
    }),
  withStatus: false, // status lives inside the 12-field filters
  filters: { defaults: defaultFilters },
  defaultSort: { sortBy: 'name', sortOrder: 'asc' },
  defaultPerPage: 20,
});

export const ClientsProvider = Provider;
/** Table list state (server-paginated, page-scoped). Lookup-by-id = useClient (hooks/useClient). */
export const useClientsTable = usePagedList;
