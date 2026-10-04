'use client';

import { useCallback, useMemo } from 'react';
import { useTableUrlState } from '@/hooks/useTableUrlState';
import type { TableUrlConfig, TableUrlState } from '@/hooks/useTableUrlState';

// #349 Task 8 — staff page URL state (wave group 3). The page-scoped hook
// owns the canonical table params (q/status/sort_by/sort_order/page/per_page)
// via the generic useTableUrlState, passed into StaffProvider as its
// urlState integration (managed mode, spec §3) — the locations precedent
// (wave group 1). /masters (read-only, no filters) is NOT touched.

/**
 * Staff sort whitelist = the backend whitelist (domain-rules/staff.md
 * §List contract) = the table's sortable column keys. `position` is
 * EXCLUDED (M2M makes it ambiguous); a dirty `?sort_by=position` silently
 * falls back to the no-sort default (US-3 dirty-URL contract).
 */
export const STAFF_SORT_FIELDS = [
  'name',
  'specialty',
  'color',
  'avatar',
  'status',
] as const;

/**
 * The hook config — page-scoped, memoized forever (one identity per mount).
 * sort default = NO sort (spec §2 — server default order: sort_order ASC,
 * first_name ASC, id ASC, §4.4); per_page default = 10 (the dict factory
 * default); status default = active (the factory's pre-#349 default).
 */
export const staffUrlConfig = {
  q: { kind: 'string', maxLength: 200, defaultValue: '' },
  status: {
    kind: 'enum',
    values: ['active', 'all', 'archived'] as const,
    defaultValue: 'active',
  },
  sort_by: { kind: 'enum', values: STAFF_SORT_FIELDS, defaultValue: '' },
  sort_order: {
    kind: 'enum',
    values: ['asc', 'desc'] as const,
    defaultValue: 'asc',
    requires: 'sort_by',
  },
  page: { kind: 'int', min: 1, max: 10000, defaultValue: 1 },
  per_page: { kind: 'enum', values: [10, 20, 50, 100] as const, defaultValue: 10 },
} satisfies TableUrlConfig;

type StaffUrlState = TableUrlState<typeof staffUrlConfig>;

export interface StaffUrlAdapter {
  // Record-compatible: the factory's PagedListUrlState consumes the state as
  // a plain bag of canonical keys (no navigate member — the factory contract
  // never calls it; precedent: 0a07a102 dropped it from the records adapter).
  state: StaffUrlState & Record<string, unknown>;
  update: (patch: Record<string, unknown>, options?: { history?: 'push' | 'replace' }) => void;
}

/**
 * Page-scoped URL adapter for /staff (#349 Task 8). Created INSIDE the
 * page's Suspense boundary, passed into StaffProvider as its urlState
 * integration (managed mode, spec §3). Pure passthrough — the page has no
 * structured filters, so every patch key is a canonical URL param.
 */
export function useStaffUrlState(): StaffUrlAdapter {
  const { state, update } = useTableUrlState(staffUrlConfig);

  // The factory writes a plain Record; the generic hook types the patch
  // narrowly — bridge with one cast (the config owns every legal key).
  const updateRecord = useCallback(
    (patch: Record<string, unknown>, options?: { history?: 'push' | 'replace' }) => {
      update(patch as Partial<StaffUrlState>, options);
    },
    [update],
  );

  return useMemo(() => ({ state, update: updateRecord }), [state, updateRecord]);
}
