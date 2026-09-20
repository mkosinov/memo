'use client';

import { useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getMonday, toISODate } from '@/lib/datetime';

// #138 Task 5: URL as source of truth for /records (?from=&to=).
// Spec: docs/specs/2026-07-17-schedule-view-url-state-138-design.md §2.2.
// Single writer of the records period: the date inputs (and the reset button)
// write via router.replace — the period is not history-navigable state.
//
// Validation mirrors the T4 readers (useScheduleView / Menubar.readPagePeriod):
// strict `YYYY-MM-DD` + a real calendar date; `from > to` invalidates the
// PAIR (both sides fall back), matching the server's cross-field 422 rule
// (docs/domain-rules/records.md — date_from > date_to is rejected).

/** Strict `YYYY-MM-DD` AND a real calendar date. Anything else → null. */
function parseDateParam(raw: string | null): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  // Reject rollovers like 2026-02-31 (Date would silently land in March)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null;
  }
  return date;
}

/** Today's local midnight. */
function today(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * The default records period: monday..sunday of the current week — the SAME
 * `YYYY-MM-DD` strings the legacy NavigationContext produced, so the
 * ['records', page, perPage, dateFrom, dateTo, …] query keys stay
 * byte-identical.
 */
function currentWeekRange(): { from: Date; to: Date } {
  const monday = getMonday(today());
  const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
  return { from: monday, to: sunday };
}

export interface RecordsPeriod {
  /** ISO `YYYY-MM-DD` — cache-key format unchanged (RecordsContext :81). */
  dateFrom: string;
  /** ISO `YYYY-MM-DD` — cache-key format unchanged (RecordsContext :81). */
  dateTo: string;
  /**
   * The EXPLICIT `?from`/`?to` values (valid `YYYY-MM-DD`), or null when the
   * param is absent/empty/invalid or the pair is inverted. Writers use this
   * to keep an untouched side ABSENT (the spec's deliberate half-filter:
   * editing one input preserves the other side — an absent side stays absent).
   */
  explicitFrom: string | null;
  explicitTo: string | null;
  /**
   * Write the period. `''` removes the param (empty string = "param absent");
   * the other side and any unrelated params are preserved. replace (no push):
   * the period is not a history step.
   */
  setPeriod: (from: string, to: string) => void;
}

/**
 * Single read/write point for the records page URL period.
 * Invalid or missing params silently fall back to the default
 * current-week monday..sunday — no UI error.
 */
export function useRecordsPeriod(): RecordsPeriod {
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawFrom = parseDateParam(searchParams.get('from'));
  const rawTo = parseDateParam(searchParams.get('to'));
  // Read: an absent/empty/invalid param defaults THAT side only; an explicit
  // `from > to` pair invalidates BOTH sides (both fall back to the default
  // current-week range — matches the T4 Menubar semantics: an explicit range
  // only for from ≤ to; the server likewise 422s date_from > date_to,
  // docs/domain-rules/records.md).
  const def = currentWeekRange();
  const dateFrom = toISODate(rawFrom ?? def.from);
  const dateTo = toISODate(rawTo ?? def.to);
  const pairInvalid =
    rawFrom !== null && rawTo !== null && rawFrom.getTime() > rawTo.getTime();
  const effectiveFrom = pairInvalid ? toISODate(def.from) : dateFrom;
  const effectiveTo = pairInvalid ? toISODate(def.to) : dateTo;
  // A side is "explicit" only when it individually parsed AND the pair (when
  // both present) is not inverted — inverted sides do not survive a read.
  const explicitFrom =
    rawFrom !== null && !pairInvalid ? toISODate(rawFrom) : null;
  const explicitTo = rawTo !== null && !pairInvalid ? toISODate(rawTo) : null;

  /**
   * Latest params as seen by the writer — sequential synchronous writes
   * compose (same rationale as useScheduleView.updateParams).
   */
  const latestParamsRef = useRef<string | null>(null);

  const setPeriod = useCallback(
    (from: string, to: string) => {
      const base = latestParamsRef.current ?? searchParams.toString();
      const params = new URLSearchParams(base);
      if (from === '') {
        params.delete('from');
      } else {
        params.set('from', from);
      }
      if (to === '') {
        params.delete('to');
      } else {
        params.set('to', to);
      }
      latestParamsRef.current = params.toString();
      const qs = params.toString();
      router.replace(qs ? `/records?${qs}` : '/records');
    },
    [router, searchParams],
  );

  // A committed navigation re-renders the hook with fresh searchParams —
  // adopt them as the new base (same rule as useScheduleView).
  const searchParamsKey = searchParams.toString();
  if (latestParamsRef.current !== null && latestParamsRef.current !== searchParamsKey) {
    latestParamsRef.current = null;
  }

  return {
    dateFrom: effectiveFrom,
    dateTo: effectiveTo,
    explicitFrom,
    explicitTo,
    setPeriod,
  };
}
