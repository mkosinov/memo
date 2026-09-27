'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTableUrlState } from '@/hooks/useTableUrlState';
import type { TableUrlConfig } from '@/hooks/useTableUrlState';
import { parseClientIds } from '@/lib/client-id-param';
import type { ArchiveFilter, SortOrder } from '@/contexts/createPagedListContext';
import type { ClientFilters } from '@/contexts/ClientsContext';

// #349 Task 4 — clients page URL state. The page-scoped hook owns the
// canonical table params (q/status/sort_by/sort_order/page/per_page) via the
// generic useTableUrlState; the structured clients filters (dates/numbers)
// stay machine-side (spec §4: only the canonical six go to the URL); the
// deep-link narrowing (?clientId=) stays an UNMANAGED param the generic hook
// already preserves (modality ≠ filters, #232).

/** Clients sort whitelist = sortable table columns (backend §"Sort columns"). */
export const CLIENTS_SORT_FIELDS = [
  'name',
  'phone',
  'records_count',
  'last_record',
  'total_paid',
  'missed_records',
  'created_at',
  'updated_at',
] as const;

export const CLIENTS_URL_DEFAULT_STATUS: ArchiveFilter = 'active';

/**
 * The hook config — page-scoped, memoized forever (one identity per mount).
 * sort default = NO sort (spec §2: «дефолт каждой страницы — сортировки нет»)
 * — sort params reach the server only after a user pick, mirroring the
 * factory's uncontrolled `sortBy: null` seed (§4.4). sort_by is an ENUM over
 * the whitelist (CLIENTS_SORT_FIELDS): a dirty `?sort_by=bogus` silently
 * falls back to the no-sort default (US-3 dirty-URL contract).
 */
export const clientsUrlConfig = {
  q: { kind: 'string', maxLength: 200, defaultValue: '' },
  status: {
    kind: 'enum',
    values: ['active', 'all', 'archived'] as const,
    defaultValue: CLIENTS_URL_DEFAULT_STATUS,
  },
  sort_by: { kind: 'enum', values: CLIENTS_SORT_FIELDS, defaultValue: '' },
  sort_order: {
    kind: 'enum',
    values: ['asc', 'desc'] as const,
    defaultValue: 'asc',
    requires: 'sort_by',
  },
  page: { kind: 'int', min: 1, max: 10000, defaultValue: 1 },
  per_page: { kind: 'enum', values: [10, 20, 50, 100] as const, defaultValue: 20 },
} satisfies TableUrlConfig;

/** Structured-machine default = defaultFilters of ClientsContext. */
import { defaultFilters as clientsDefaultFilters } from '@/contexts/ClientsContext';

type ClientsUrlAdapterState = {
  q: string;
  status: ArchiveFilter;
  sort_by: string;
  sort_order: SortOrder;
  page: number;
  per_page: number;
  /** Effective status: `status from URL ?? (clientId present → 'all' : 'active')`. */
  effectiveStatus: ArchiveFilter;
  /** Deep-link narrowing ids (null = no param) — read-only view over ?clientId=. */
  clientIds: string[] | null;
} & ClientFilters;

export interface ClientsUrlAdapter {
  // Record-compatible: the factory's PagedListUrlState consumes the state as
  // a plain bag of canonical + structured-filter keys.
  state: ClientsUrlAdapterState & Record<string, unknown>;
  update: (patch: Record<string, unknown>, options?: { history?: 'push' | 'replace' }) => void;
  reset: () => void;
  /** Full-query replacement through the hook (drops unmanaged params). */
  navigate: (url: string, options?: { history?: 'push' | 'replace' }) => void;
}

/**
 * Page-scoped URL adapter for /clients (#349 Task 4). Created INSIDE the
 * page's Suspense boundary, passed into ClientsProvider as its urlState
 * integration (managed mode, spec §3).
 */
export function useClientsUrlState(): ClientsUrlAdapter {
  const searchParams = useSearchParams();
  const { state: urlState, update: urlUpdate, navigate } = useTableUrlState(clientsUrlConfig);
  const [structuredFilters, setStructuredFilters] = useState<ClientFilters>(clientsDefaultFilters);

  // Deep-link narrowing — read directly from the params object (stable per
  // navigation identity; memo keeps the array identity stable too).
  const clientIds = useMemo(() => parseClientIds(searchParams), [searchParams]);

  // Effective status rule (spec §3): the URL status wins; without an explicit
  // status a present clientId forces 'all' (archived deep links must find the
  // client, #216 behavior preserved) — and the force is NEVER written back to
  // the URL (no user-less navigation).
  // Edge (architect-accepted, US-3): `?status=xyz&clientId=X` — the status
  // param IS present but invalid, so the enum already fell it back to the
  // page default 'active' and the clientId force does NOT apply (presence of
  // a DIRTY value counts as an explicit status → dirty URL → defaults).
  const hasUrlStatus = searchParams.get('status') !== null;
  const effectiveStatus: ArchiveFilter = hasUrlStatus ? urlState.status : clientIds ? 'all' : urlState.status;

  const update = useCallback(
    (patch: Record<string, unknown>, options?: { history?: 'push' | 'replace' }) => {
      // Reset sentinel from the factory's controlled resetFilters: ONE push to
      // the clean /clients (defaults = URL without filter params, spec §4) —
      // which also drops clientId (reset's documented extra job, #232 §3.5).
      // The hook's update() can never strip the UNMANAGED clientId param
      // (unmanaged params are preserved by contract), so the reset navigates
      // to the bare pathname itself — same single-navigation guarantee.
      if (patch.clientIds === null && Object.keys(patch).every((k) => k === 'clientIds')) {
        navigate('/clients');
        setStructuredFilters(clientsDefaultFilters);
        return;
      }
      // Structured keys stay machine-side; canonical keys go to the URL.
      const structured: Partial<ClientFilters> = {};
      const urlPatch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(patch)) {
        if (key in clientsUrlConfig) urlPatch[key] = value;
        else structured[key as keyof ClientFilters] = value as never;
      }
      if (Object.keys(structured).length > 0) {
        setStructuredFilters((prev) => ({ ...prev, ...structured }));
      }
      if (Object.keys(urlPatch).length > 0) {
        urlUpdate(urlPatch, options);
      }
    },
    [urlUpdate, navigate],
  );

  // The adapter object is consumed by the factory Provider per render; the
  // urlUpdate identity is stable (useCallback on a stable flush), and clientIds
  // is memoized — the composite stays stable enough for the factory's
  // useCallback deps.
  //
  // The structured filters are exposed FLAT (each field a top-level state
  // key): the factory collects every non-canonical key into its
  // `effectiveFilters`, which is exactly the ClientFilters shape the context
  // fetcher spreads onto the wire. `effectiveStatus` and `clientIds` are
  // adapter-only keys consumed by the factory (urlStatus overlay) / the page
  // (deep-link chip + auto-open) before the fetcher's suppression pass.
  return useMemo(
    () => ({
      state: {
        q: String(urlState.q),
        status: urlState.status as ArchiveFilter,
        sort_by: String(urlState.sort_by),
        sort_order: urlState.sort_order as SortOrder,
        page: Number(urlState.page),
        per_page: Number(urlState.per_page),
        effectiveStatus,
        clientIds,
        ...structuredFilters,
      },
      update,
      reset: () => update({ clientIds: null }),
      /** Full-query replacement through the single writer (chip ✕). */
      navigate,
    }),
    [urlState, effectiveStatus, clientIds, structuredFilters, update, navigate],
  );
}
