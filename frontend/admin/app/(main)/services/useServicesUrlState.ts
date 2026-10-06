'use client';

import { useCallback, useMemo, useState } from 'react';
import { useTableUrlState } from '@/hooks/useTableUrlState';
import type { TableUrlConfig, TableUrlState } from '@/hooks/useTableUrlState';
import type { ArchiveFilter, SortOrder } from '@/contexts/createPagedListContext';
import { defaultServiceFilters } from '@/contexts/ServicesContext';
import type { ServiceListFilters } from '@/contexts/ServicesContext';

// #349 Task 6 — services page URL state (wave group 2). ONE URL /services
// carries TWO table param sets: the services table's canonical params
// (q/status/sort_by/sort_order/page/per_page) and the nested materials
// table's params under the `mat_` prefix (spec §2: mat_q, mat_status,
// mat_sort_by, mat_sort_order, mat_page, mat_per_page — the materials table
// shares the DataTable page-size select, so its per_page IS url-addressable).

/**
 * TWO useTableUrlState instances on the single /services URL — the hook's
 * "one instance per URL" warning is about CLOBBERING: each instance keeps a
 * private latestParamsRef write base, and two SIMULTANEOUSLY pending ~16ms
 * flushes would build on different bases and drop each other's params.
 * Here the precondition never materializes:
 *   1. The page renders the two tables in mutually exclusive `view`
 *      branches — only the visible table's provider is mounted, so at most
 *      ONE consumer ever schedules a write at a time (the hidden adapter
 *      just re-renders on the shared searchParams, read-only).
 *   2. The configs are DISJOINT param sets: each instance's serialize()
 *      passes the other's params through as UNMANAGED (preserved verbatim),
 *      so a write from either side can never drop the other's params.
 *   3. A committed navigation clears both instances' write bases (the
 *      searchParamsKey check), so bases can't go stale cross-instance.
 * Conclusion: two instances are safe under the disjoint-config +
 * exclusive-writer discipline enforced by this page. If the tables ever
 * render simultaneously, switch to ONE instance with the merged config.
 */

/** Services sort whitelist = backend ServiceSortBy Literal (schemas/service.py). */
export const SERVICES_SORT_FIELDS = [
  'title',
  'duration',
  'age',
  'tariffs',
  'specialty',
  'archived',
  'created_at',
] as const;

/** Materials sort whitelist = backend MaterialSortBy Literal (schemas/material.py). */
export const MATERIALS_SORT_FIELDS = ['title', 'description', 'archived', 'created_at'] as const;

export const SERVICES_URL_DEFAULT_STATUS: ArchiveFilter = 'active';
export const MATERIALS_URL_DEFAULT_STATUS: ArchiveFilter = 'active';

/**
 * Services half — canonical API names verbatim (spec §2). Sort default =
 * NO sort (§4.4 — server default title ASC, id ASC); per_page default = 10
 * (the dict factory default); status default = active (pre-#349 default).
 */
export const servicesUrlConfig = {
  q: { kind: 'string', maxLength: 200, defaultValue: '' },
  status: {
    kind: 'enum',
    values: ['active', 'all', 'archived'] as const,
    defaultValue: SERVICES_URL_DEFAULT_STATUS,
  },
  sort_by: { kind: 'enum', values: SERVICES_SORT_FIELDS, defaultValue: '' },
  sort_order: {
    kind: 'enum',
    values: ['asc', 'desc'] as const,
    defaultValue: 'asc',
    requires: 'sort_by',
  },
  page: { kind: 'int', min: 1, max: 10000, defaultValue: 1 },
  per_page: { kind: 'enum', values: [10, 20, 50, 100] as const, defaultValue: 10 },
} satisfies TableUrlConfig;

/**
 * Materials half — the same six params under the `mat_` prefix (spec §2).
 * The prefix lives HERE ONLY: the adapter projects mat_* ↔ canonical names
 * at its boundary, so the factory (createPagedListContext) keeps consuming
 * its canonical PagedListUrlState contract unchanged.
 */
export const materialsUrlConfig = {
  mat_q: { kind: 'string', maxLength: 200, defaultValue: '' },
  mat_status: {
    kind: 'enum',
    values: ['active', 'all', 'archived'] as const,
    defaultValue: MATERIALS_URL_DEFAULT_STATUS,
  },
  mat_sort_by: { kind: 'enum', values: MATERIALS_SORT_FIELDS, defaultValue: '' },
  mat_sort_order: {
    kind: 'enum',
    values: ['asc', 'desc'] as const,
    defaultValue: 'asc',
    requires: 'mat_sort_by',
  },
  mat_page: { kind: 'int', min: 1, max: 10000, defaultValue: 1 },
  mat_per_page: { kind: 'enum', values: [10, 20, 50, 100] as const, defaultValue: 10 },
} satisfies TableUrlConfig;

type ServicesUrlState = TableUrlState<typeof servicesUrlConfig>;
type MaterialsUrlState = TableUrlState<typeof materialsUrlConfig>;
// Both aliases are the hook-side patch/state types (literal-narrowed enums);
// the ADAPTER surfaces use the explicit CanonicalTableUrlState view above —
// same widening the clients adapter performs field-by-field.

/** The factory's canonical six, spelled as an explicit view (the hook's
 * literal-narrowed TableUrlState doesn't intersect with the structured
 * filter bag — the clients adapter's explicit-fields precedent). */
export interface CanonicalTableUrlState {
  q: string;
  status: ArchiveFilter;
  sort_by: string;
  sort_order: SortOrder;
  page: number;
  per_page: number;
}

export interface ServicesUrlAdapter {
  // Record-compatible: the factory's PagedListUrlState consumes the state as
  // a plain bag of canonical + structured-filter keys.
  state: CanonicalTableUrlState & { material_id: string } & Record<string, unknown>;
  update: (patch: Record<string, unknown>, options?: { history?: 'push' | 'replace' }) => void;
  /** Full-query replacement through the hook (single-writer escape hatch). */
  navigate: (url: string, options?: { history?: 'push' | 'replace' }) => void;
}

export interface MaterialsUrlAdapter {
  // Canonical names for the factory — the mat_ prefix never leaves this file.
  state: CanonicalTableUrlState & Record<string, unknown>;
  update: (patch: Record<string, unknown>, options?: { history?: 'push' | 'replace' }) => void;
  /** Full-query replacement through the hook (single-writer escape hatch). */
  navigate: (url: string, options?: { history?: 'push' | 'replace' }) => void;
}

/** Canonical patch key → its mat_-prefixed config key. */
const MAT_KEY_OF = {
  q: 'mat_q',
  status: 'mat_status',
  sort_by: 'mat_sort_by',
  sort_order: 'mat_sort_order',
  page: 'mat_page',
  per_page: 'mat_per_page',
} as const;

/**
 * Page-scoped URL adapter for the SERVICES table (#349 Task 6). Created
 * INSIDE the page's Suspense boundary, passed into ServicesProvider as its
 * urlState integration (managed mode, spec §3). The structured material
 * filter (ServiceListFilters.material_id) stays machine-side (spec §4) —
 * same split as the clients adapter, minus the deep-link sentinel.
 */
export function useServicesUrlState(): ServicesUrlAdapter {
  const { state: urlState, update: urlUpdate, navigate } = useTableUrlState(servicesUrlConfig);
  const [structuredFilters, setStructuredFilters] = useState<ServiceListFilters>(defaultServiceFilters);

  const update = useCallback(
    (patch: Record<string, unknown>, options?: { history?: 'push' | 'replace' }) => {
      // Structured keys stay machine-side; canonical keys go to the URL.
      // (The factory's controlled resetFilters lands here as a structured-
      // only patch → no navigation, exactly the spec §4 behavior.)
      const structured: Partial<ServiceListFilters> = {};
      const urlPatch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(patch)) {
        if (key in servicesUrlConfig) urlPatch[key] = value;
        else structured[key as keyof ServiceListFilters] = value as never;
      }
      if (Object.keys(structured).length > 0) {
        setStructuredFilters((prev) => ({ ...prev, ...structured }));
      }
      if (Object.keys(urlPatch).length > 0) {
        urlUpdate(urlPatch as Partial<ServicesUrlState>, options);
      }
    },
    [urlUpdate],
  );

  return useMemo(
    () => ({
      state: {
        q: String(urlState.q),
        status: urlState.status as ArchiveFilter,
        sort_by: String(urlState.sort_by),
        sort_order: urlState.sort_order as SortOrder,
        page: Number(urlState.page),
        per_page: Number(urlState.per_page),
        ...structuredFilters,
      },
      update,
      navigate,
    }),
    [urlState, structuredFilters, update, navigate],
  );
}

/**
 * Page-scoped URL adapter for the MATERIALS table (#349 Task 6, spec §2).
 * Wraps the mat_-prefixed hook instance and PROJECTS its state/patches to
 * the canonical names the factory consumes (PagedListUrlState). The hook's
 * auto page-reset keys the literal `page` config entry — absent from the
 * mat_ config — so the adapter enforces the same rule itself: a filter
 * change (any key except page) resets mat_page→1 in the SAME translated
 * patch (one navigation), explicit `page` in the patch always wins.
 */
export function useMaterialsUrlState(): MaterialsUrlAdapter {
  const { state: matState, update: matUpdate, navigate } = useTableUrlState(materialsUrlConfig);

  const update = useCallback(
    (patch: Record<string, unknown>, options?: { history?: 'push' | 'replace' }) => {
      const translated: Partial<MaterialsUrlState> = {};
      let touchedFilters = false;
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'page') {
          translated.mat_page = value as number;
        } else if (key in MAT_KEY_OF) {
          translated[MAT_KEY_OF[key as keyof typeof MAT_KEY_OF]] = value as never;
          touchedFilters = true;
        }
        // Unknown keys: the materials context has no structured filters —
        // nothing else is legal on this patch, drop defensively.
      }
      if (touchedFilters && !('page' in patch)) {
        translated.mat_page = 1;
      }
      matUpdate(translated, options);
    },
    [matUpdate],
  );

  return useMemo(
    () => ({
      state: {
        q: String(matState.mat_q),
        status: matState.mat_status as ArchiveFilter,
        sort_by: String(matState.mat_sort_by),
        sort_order: matState.mat_sort_order as SortOrder,
        page: Number(matState.mat_page),
        per_page: Number(matState.mat_per_page),
      },
      update,
      navigate,
    }),
    [matState, update, navigate],
  );
}
