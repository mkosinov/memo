'use client';

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTableUrlState } from '@/hooks/useTableUrlState';
import type { TableUrlConfig } from '@/hooks/useTableUrlState';
import { getMonday, toISODate } from '@/lib/datetime';
import type { RecordFilters } from '@/contexts/RecordsContext';

// #349 Task 7 — records page URL state. ONE adapter instance per /records
// mount (created inside the page's Suspense boundary, consumed by
// RecordsProvider — the single-writer discipline of useTableUrlState). The
// period ports the legacy ?from=&to= (useRecordsPeriod, #138 T5) into the
// datePair preset; the table params follow spec §2:
// q/status/location_id/service_id/master_id/sort_by/sort_order/page/per_page.

/** Records sort whitelist = backend RecordSortBy (schemas/record.py). */
export const RECORDS_SORT_FIELDS = [
  'date',
  'client',
  'service',
  'master',
  'location',
  'guests',
  'status',
  'total',
  'payment',
] as const;

/** VisitStatus whitelist (@memo/domain) — '' (param absent) = all statuses. */
export const RECORDS_STATUS_VALUES = ['waiting', 'visited', 'cancelled', 'missed'] as const;

/**
 * The default records period: monday..sunday of the current week — the SAME
 * `YYYY-MM-DD` strings the legacy useRecordsPeriod produced, so the
 * ['records', page, perPage, dateFrom, dateTo, …] query keys stay
 * byte-identical. A function (read-time), per spec §1 datePair.
 */
export function defaultRecordsPeriod(): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monday = getMonday(today);
  const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
  return { from: toISODate(monday), to: toISODate(sunday) };
}

/**
 * The hook config. Page deviations (spec §2): the period params are
 * from/to (the existing #138 deviation, kept); the sort defaults are
 * date/asc — a MEANINGFUL sort (unlike services' no-sort ''), so sort_order
 * carries NO `requires` linkage (date-desc must round-trip: ?sort_order=desc
 * alone sorts the default date column desc). per_page IS url-addressable —
 * the records DataTable renders the shared page-size select (10/20/50/100).
 */
export const recordsUrlConfig = {
  period: {
    kind: 'datePair',
    fromName: 'from',
    toName: 'to',
    defaults: defaultRecordsPeriod,
  },
  q: { kind: 'string', maxLength: 200, defaultValue: '' },
  status: { kind: 'enum', values: RECORDS_STATUS_VALUES, defaultValue: '' },
  location_id: { kind: 'string', maxLength: 64, defaultValue: '' },
  service_id: { kind: 'string', maxLength: 64, defaultValue: '' },
  master_id: { kind: 'string', maxLength: 64, defaultValue: '' },
  sort_by: { kind: 'enum', values: RECORDS_SORT_FIELDS, defaultValue: 'date' },
  sort_order: { kind: 'enum', values: ['asc', 'desc'] as const, defaultValue: 'asc' },
  page: { kind: 'int', min: 1, max: 10000, defaultValue: 1 },
  per_page: { kind: 'enum', values: [10, 20, 50, 100] as const, defaultValue: 10 },
} satisfies TableUrlConfig;

/** The adapter's state view — camelCase, consumed by RecordsProvider. */
export interface RecordsUrlStateView {
  /** Effective period — a missing side falls back to its own default. */
  dateFrom: string;
  dateTo: string;
  /** The EXPLICIT ?from/?to values (null = absent/inverted side). */
  explicitFrom: string | null;
  explicitTo: string | null;
  filters: RecordFilters;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  page: number;
  perPage: number;
}

/** camelCase patch (the context's vocabulary) — translated to URL keys. */
export interface RecordsUrlPatch {
  locationId?: string;
  serviceId?: string;
  masterId?: string;
  status?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  perPage?: number;
  period?: { from: string | null; to: string | null };
}

export interface RecordsUrlAdapter {
  state: RecordsUrlStateView;
  update: (patch: RecordsUrlPatch, options?: { history?: 'push' | 'replace' }) => void;
  /** Legacy setPeriod shape: '' removes the side (empty string = absent). */
  setPeriod: (from: string, to: string) => void;
  /** Full-query replacement through the hook (single-writer escape hatch). */
  navigate: (url: string, options?: { history?: 'push' | 'replace' }) => void;
}

/** camelCase patch key → URL config key. */
const URL_KEY_OF = {
  locationId: 'location_id',
  serviceId: 'service_id',
  masterId: 'master_id',
  search: 'q',
  status: 'status',
  sortBy: 'sort_by',
  sortOrder: 'sort_order',
  page: 'page',
  perPage: 'per_page',
  period: 'period',
} as const;

/**
 * Strict `YYYY-MM-DD` AND a real calendar date (mirrors useTableUrlState's
 * parseDateKey / the legacy useRecordsPeriod validation). Anything else → null.
 */
function parseDateParam(raw: string | null): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null;
  }
  return raw;
}

/**
 * Explicitness CANNOT come from the preset state: the datePair read
 * substitutes the default week when BOTH sides are absent, so
 * state.period.to would leak the default sunday as "explicit" — and a
 * half-filter write would seed the defaulted display value into the URL.
 * Derived from the RAW params instead (the clients-adapter clientIds
 * precedent): a side is explicit only when individually valid, and an
 * explicitly inverted pair invalidates BOTH sides (they did not survive).
 */
function readExplicitPeriod(params: URLSearchParams): {
  from: string | null;
  to: string | null;
} {
  const from = parseDateParam(params.get('from'));
  const to = parseDateParam(params.get('to'));
  if (from !== null && to !== null && from > to) return { from: null, to: null };
  return { from, to };
}

/**
 * Page-scoped URL adapter for /records (#349 Task 7). Created INSIDE the
 * page's Suspense boundary, passed into RecordsProvider as its urlState
 * integration — the ONE useTableUrlState instance on the /records URL.
 *
 * Gate B: a period change is a HISTORY STEP — update()/setPeriod() use the
 * hook's default push (the legacy useRecordsPeriod replaced).
 */
export function useRecordsUrlState(): RecordsUrlAdapter {
  const { state, update: urlUpdate, navigate } = useTableUrlState(recordsUrlConfig);
  const searchParams = useSearchParams();

  const update = useCallback(
    (patch: RecordsUrlPatch, options?: { history?: 'push' | 'replace' }) => {
      const urlPatch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(patch)) {
        const urlKey = URL_KEY_OF[key as keyof typeof URL_KEY_OF];
        // Unknown keys are dropped defensively (no structured filters here).
        if (urlKey !== undefined) urlPatch[urlKey] = value;
      }
      if (Object.keys(urlPatch).length > 0) {
        urlUpdate(urlPatch as never, options);
      }
    },
    [urlUpdate],
  );

  // Legacy setPeriod shape ('' = remove the side) over the datePair preset:
  // a null side serializes to "param absent".
  const setPeriod = useCallback(
    (from: string, to: string) => {
      update({
        period: { from: from === '' ? null : from, to: to === '' ? null : to },
      });
    },
    [update],
  );

  // The datePair preset substitutes the default week only when BOTH sides
  // are absent; a missing side of a partial pair stays null — the effective
  // range fills it with its OWN default (the legacy useRecordsPeriod read,
  // wire behavior unchanged).
  const def = defaultRecordsPeriod();
  const defFrom = def.from;
  const defTo = def.to;

  // Explicitness from the RAW params (see readExplicitPeriod/parseDateParam):
  // an absent side is NEVER explicit, even though the display/effective
  // value falls back to the default week.
  const explicit = readExplicitPeriod(searchParams);
  const explicitFrom = explicit.from;
  const explicitTo = explicit.to;

  return useMemo(
    () => ({
      state: {
        dateFrom: state.period.from ?? defFrom,
        dateTo: state.period.to ?? defTo,
        explicitFrom,
        explicitTo,
        filters: {
          locationId: state.location_id,
          serviceId: state.service_id,
          masterId: state.master_id,
          status: state.status,
          search: state.q,
        },
        sortBy: state.sort_by,
        // Enum literal widening (the services-adapter cast precedent).
        sortOrder: state.sort_order as 'asc' | 'desc',
        page: state.page,
        perPage: state.per_page,
      },
      update,
      setPeriod,
      navigate,
    }),
    // Identity-stable on VALUES: the raw hook state object is rebuilt every
    // render, but the mirror effect in RecordsProvider keys on this state's
    // identity — it must NOT see a "new" state when the URL didn't change
    // (otherwise the mirror would loop). The key covers every field above;
    // defFrom/defTo shift at week boundaries, explicit* track the raw params.
    [
      state.q,
      state.status,
      state.location_id,
      state.service_id,
      state.master_id,
      state.sort_by,
      state.sort_order,
      state.page,
      state.per_page,
      state.period.from,
      state.period.to,
      defFrom,
      defTo,
      explicitFrom,
      explicitTo,
      update,
      setPeriod,
      navigate,
    ],
  );
}
