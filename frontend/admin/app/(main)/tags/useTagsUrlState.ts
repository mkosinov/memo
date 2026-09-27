'use client';

import { useCallback, useMemo } from 'react';
import { useTableUrlState } from '@/hooks/useTableUrlState';
import type { TableUrlConfig, TableUrlState } from '@/hooks/useTableUrlState';

// #349 Task 5 — tags page URL state (wave group 1). The page-scoped hook
// owns the canonical table params (q/sort_by/sort_order/page/per_page) via
// the generic useTableUrlState. Tags carry NO archive status (hard-delete
// dictionary, domain-rules/tags.md) → no status preset.

/**
 * Tags sort whitelist = the backend whitelist (domain-rules/tags.md §List
 * contract): a single sortable column — `title` (the table's only column).
 * A dirty `?sort_by=…` silently falls back to the no-sort default (US-3).
 */
export const TAGS_SORT_FIELDS = ['title'] as const;

/**
 * The hook config — page-scoped, memoized forever (one identity per mount).
 * sort default = NO sort (spec §2 — server default title ASC, §4.4);
 * per_page default = 10 (the dict factory default).
 */
export const tagsUrlConfig = {
  q: { kind: 'string', maxLength: 200, defaultValue: '' },
  sort_by: { kind: 'enum', values: TAGS_SORT_FIELDS, defaultValue: '' },
  sort_order: {
    kind: 'enum',
    values: ['asc', 'desc'] as const,
    defaultValue: 'asc',
    requires: 'sort_by',
  },
  page: { kind: 'int', min: 1, max: 10000, defaultValue: 1 },
  per_page: { kind: 'enum', values: [10, 20, 50, 100] as const, defaultValue: 10 },
} satisfies TableUrlConfig;

type TagsUrlState = TableUrlState<typeof tagsUrlConfig>;

export interface TagsUrlAdapter {
  // Record-compatible: the factory's PagedListUrlState consumes the state as
  // a plain bag of canonical keys.
  state: TagsUrlState & Record<string, unknown>;
  update: (patch: Record<string, unknown>, options?: { history?: 'push' | 'replace' }) => void;
  /** Full-query replacement through the hook (single-writer escape hatch). */
  navigate: (url: string, options?: { history?: 'push' | 'replace' }) => void;
}

/**
 * Page-scoped URL adapter for /tags (#349 Task 5). Created INSIDE the page's
 * Suspense boundary, passed into TagsProvider as its urlState integration
 * (managed mode, spec §3). Pure passthrough — the page has no structured
 * filters, so every patch key is a canonical URL param.
 */
export function useTagsUrlState(): TagsUrlAdapter {
  const { state, update, navigate } = useTableUrlState(tagsUrlConfig);

  // PagedListUrlState writes a plain Record; the generic hook types the patch
  // narrowly — bridge with one cast (the config owns every legal key).
  const updateRecord = useCallback(
    (patch: Record<string, unknown>, options?: { history?: 'push' | 'replace' }) => {
      update(patch as Partial<TagsUrlState>, options);
    },
    [update],
  );

  return useMemo(
    () => ({ state, update: updateRecord, navigate }),
    [state, updateRecord, navigate],
  );
}
