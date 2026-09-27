'use client';

import { useCallback, useMemo } from 'react';
import { useTableUrlState } from '@/hooks/useTableUrlState';
import type { TableUrlConfig, TableUrlState } from '@/hooks/useTableUrlState';

// #349 Task 5 — locations page URL state (wave group 1). The page-scoped hook
// owns the canonical table params (q/status/sort_by/sort_order/page/per_page)
// via the generic useTableUrlState. Locations ARE archive-aware (status
// filter in the *Filters bar) — unlike tags/positions, the status preset is
// part of the page's URL contract.

/**
 * Locations sort whitelist = the backend whitelist (domain-rules/locations.md
 * §List contract) = the table's sortable column keys. A dirty `?sort_by=…`
 * silently falls back to the no-sort default (US-3 dirty-URL contract).
 */
export const LOCATIONS_SORT_FIELDS = [
  'title',
  'short_title',
  'capacity',
  'address',
  'location_hint',
  'description',
  'archived',
  'yandex_map_url',
  'created_at',
] as const;

export const LOCATIONS_URL_DEFAULT_STATUS = 'active' as const;

/**
 * The hook config — page-scoped, memoized forever (one identity per mount).
 * sort default = NO sort (spec §2 — server default order, §4.4); per_page
 * default = 10 (the dict factory default); status default = active (the
 * page's pre-#349 factory default).
 */
export const locationsUrlConfig = {
  q: { kind: 'string', maxLength: 200, defaultValue: '' },
  status: {
    kind: 'enum',
    values: ['active', 'all', 'archived'] as const,
    defaultValue: LOCATIONS_URL_DEFAULT_STATUS,
  },
  sort_by: { kind: 'enum', values: LOCATIONS_SORT_FIELDS, defaultValue: '' },
  sort_order: {
    kind: 'enum',
    values: ['asc', 'desc'] as const,
    defaultValue: 'asc',
    requires: 'sort_by',
  },
  page: { kind: 'int', min: 1, max: 10000, defaultValue: 1 },
  per_page: { kind: 'enum', values: [10, 20, 50, 100] as const, defaultValue: 10 },
} satisfies TableUrlConfig;

type LocationsUrlState = TableUrlState<typeof locationsUrlConfig>;

export interface LocationsUrlAdapter {
  // Record-compatible: the factory's PagedListUrlState consumes the state as
  // a plain bag of canonical keys.
  state: LocationsUrlState & Record<string, unknown>;
  update: (patch: Record<string, unknown>, options?: { history?: 'push' | 'replace' }) => void;
  /** Full-query replacement through the hook (single-writer escape hatch). */
  navigate: (url: string, options?: { history?: 'push' | 'replace' }) => void;
}

/**
 * Page-scoped URL adapter for /locations (#349 Task 5). Created INSIDE the
 * page's Suspense boundary, passed into LocationsProvider as its urlState
 * integration (managed mode, spec §3). Pure passthrough — the page has no
 * structured filters, so every patch key is a canonical URL param.
 */
export function useLocationsUrlState(): LocationsUrlAdapter {
  const { state, update, navigate } = useTableUrlState(locationsUrlConfig);

  // PagedListUrlState writes a plain Record; the generic hook types the patch
  // narrowly — bridge with one cast (the config owns every legal key).
  const updateRecord = useCallback(
    (patch: Record<string, unknown>, options?: { history?: 'push' | 'replace' }) => {
      update(patch as Partial<LocationsUrlState>, options);
    },
    [update],
  );

  return useMemo(
    () => ({ state, update: updateRecord, navigate }),
    [state, updateRecord, navigate],
  );
}
