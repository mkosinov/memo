'use client';

import { useCallback, useMemo } from 'react';
import { useTableUrlState } from '@/hooks/useTableUrlState';
import type { TableUrlConfig, TableUrlState } from '@/hooks/useTableUrlState';

// #349 Task 5 — positions page URL state (wave group 1). The page-scoped hook
// owns the canonical table params (sort_by/sort_order/page/per_page) via the
// generic useTableUrlState; the dictionary has no search (GET /positions
// accepts pagination only, D4) and no archive status → no q/status presets.

/**
 * Positions sort whitelist — EMPTY by design: every column of the positions
 * table is `sortable: false` (positionColumns.tsx, D4 — the backend order is
 * fixed at `title ASC, id ASC`), so no sort_by value is ever valid. A dirty
 * `?sort_by=…` silently falls back to the no-sort default (US-3 contract) and
 * sort params never reach the server.
 */
export const POSITIONS_SORT_FIELDS = [] as const;

/**
 * The hook config — page-scoped, memoized forever (one identity per mount).
 * sort default = NO sort (spec §2); per_page default = 10 (the dict contexts
 * use the factory's defaultPerPage, not the clients' 20).
 */
export const positionsUrlConfig = {
  sort_by: { kind: 'enum', values: POSITIONS_SORT_FIELDS, defaultValue: '' },
  sort_order: {
    kind: 'enum',
    values: ['asc', 'desc'] as const,
    defaultValue: 'asc',
    requires: 'sort_by',
  },
  page: { kind: 'int', min: 1, max: 10000, defaultValue: 1 },
  per_page: { kind: 'enum', values: [10, 20, 50, 100] as const, defaultValue: 10 },
} satisfies TableUrlConfig;

type PositionsUrlState = TableUrlState<typeof positionsUrlConfig>;

export interface PositionsUrlAdapter {
  // Record-compatible: the factory's PagedListUrlState consumes the state as
  // a plain bag of canonical keys.
  state: PositionsUrlState & Record<string, unknown>;
  update: (patch: Record<string, unknown>, options?: { history?: 'push' | 'replace' }) => void;
  /** Full-query replacement through the hook (single-writer escape hatch). */
  navigate: (url: string, options?: { history?: 'push' | 'replace' }) => void;
}

/**
 * Page-scoped URL adapter for /positions (#349 Task 5). Created INSIDE the
 * page's Suspense boundary, passed into PositionsProvider as its urlState
 * integration (managed mode, spec §3). Pure passthrough — the page has no
 * structured filters, so every patch key is a canonical URL param.
 */
export function usePositionsUrlState(): PositionsUrlAdapter {
  const { state, update, navigate } = useTableUrlState(positionsUrlConfig);

  // PagedListUrlState writes a plain Record; the generic hook types the patch
  // narrowly — bridge with one cast (the config owns every legal key).
  const updateRecord = useCallback(
    (patch: Record<string, unknown>, options?: { history?: 'push' | 'replace' }) => {
      update(patch as Partial<PositionsUrlState>, options);
    },
    [update],
  );

  return useMemo(
    () => ({ state, update: updateRecord, navigate }),
    [state, updateRecord, navigate],
  );
}
