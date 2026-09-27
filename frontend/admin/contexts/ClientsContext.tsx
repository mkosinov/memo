'use client';

import { createPagedListContext } from './createPagedListContext';
import { getClientsWithStats } from '@memo/api-client';
import type { ClientWithStats } from '@memo/api-client';
import { qk } from '@/lib/queryKeys';

/**
 * #349 Task 4 — structured (machine-side) clients filters. The canonical
 * table params (q/status/sort_by/sort_order/page/per_page) moved to the URL
 * via useClientsUrlState (spec §4); only the structured filters below stay
 * context-side. #232 §3.3 machine narrowing field `clientIds` stays: the URL
 * (?clientId=) is its single writer, exposed read-only by the page adapter.
 */
export interface ClientFilters {
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
  /**
   * #232 §3.3 — machine narrowing field: the exact client ids from the
   * deep-link address (`?clientId=…` repeated). Never rendered in the search
   * box nor part of its controlled state; the URL is its single writer.
   * null/undefined = no narrowing.
   */
  clientIds?: string[] | null;
}

/** Exported for the test fixture (createMockClientsTableState) — single source. */
export const defaultFilters: ClientFilters = {
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
// (#205). #349 Task 4: managed mode — q/status are the factory's canonical
// members (serverSearch + withStatus), the structured filters bag carries the
// machine-side fields, and the deep-link status=all overlay is fed by the
// page adapter as `effectiveStatus`. Query key slot order matches the
// pre-#349 key minus the inlined search/status: ['clients', page, perPage,
// filters, status, sortBy, sortOrder, q].
const { Provider, usePagedList } = createPagedListContext<ClientWithStats, ClientFilters>({
  queryKeyPrefix: qk.clients[0],
  fetcher: (p) =>
    getClientsWithStats({
      page: p.page,
      per_page: p.per_page,
      ...(p.sort_by ? { sort_by: p.sort_by, sort_order: p.sort_order } : {}),
      ...(p.status ? { status: p.status } : {}),
      // serverSearch ≥2-char clamp lives in the factory (#212 §5.5)
      ...(p.q ? { q: p.q } : {}),
      ...p.filters,
      // #232: machine narrowing ids — the api-client serializes `ids` as
      // repeated `id` query keys (explicit keys, no filters-bag spread);
      // the raw machine field itself is suppressed after the spread.
      ids: p.filters.clientIds ?? undefined,
      clientIds: undefined,
      // #349: adapter-only overlay keys never reach the wire (the effective
      // status above already carries the overlay value).
      effectiveStatus: undefined,
    }),
  withStatus: true, // #349: canonical status (URL-managed + effective overlay)
  serverSearch: true, // #349: canonical q with the factory's ≥2-char clamp
  filters: { defaults: defaultFilters },
  defaultPerPage: 20,
});

export const ClientsProvider = Provider;
/** Table list state (server-paginated, page-scoped). Lookup-by-id = useClient (hooks/useClient). */
export const useClientsTable = usePagedList;
