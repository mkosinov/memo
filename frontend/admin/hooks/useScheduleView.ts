'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getMonday, toISODate, shiftDateKey } from '@/lib/datetime';

// #138: URL as source of truth for /schedule (?view=&date=&col=).
// Spec: docs/specs/2026-07-17-schedule-view-url-state-138-design.md §2.1.
// Single writer of the schedule URL fields: nav steps (view/date/prev/next/
// today) push; the column display toggle replaces (no history steps).

export type ScheduleViewMode = 'week' | 'day';
export type ScheduleColumnMode = 'masters' | 'locations';

const VIEW_MODES: readonly string[] = ['week', 'day'];
const COLUMN_MODES: readonly string[] = ['masters', 'locations'];

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

function parseEnumParam<T extends string>(raw: string | null, allowed: readonly string[]): T | null {
  return raw !== null && allowed.includes(raw) ? (raw as T) : null;
}

/** Today's local midnight. */
function today(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export interface ScheduleView {
  viewMode: ScheduleViewMode;
  selectedDay: Date;
  columnMode: ScheduleColumnMode;
  /** Derived: the Monday (local) of the week containing `?date`. */
  currentWeek: Date;
  setViewMode(mode: ScheduleViewMode): void;
  setSelectedDay(date: Date): void;
  setColumnMode(mode: ScheduleColumnMode): void;
  goToToday(): void;
  prevPeriod(): void;
  nextPeriod(): void;
}

/**
 * Single read/write point for the schedule page URL state.
 * Invalid or missing params silently fall back to defaults
 * (view=week, col=masters, date=today) — no UI error.
 */
export function useScheduleView(): ScheduleView {
  const router = useRouter();
  const searchParams = useSearchParams();

  const viewMode = parseEnumParam<ScheduleViewMode>(searchParams.get('view'), VIEW_MODES) ?? 'week';
  const selectedDay = parseDateParam(searchParams.get('date')) ?? today();
  const columnMode =
    parseEnumParam<ScheduleColumnMode>(searchParams.get('col'), COLUMN_MODES) ?? 'masters';
  const currentWeek = getMonday(selectedDay);

  /**
   * One serialized writer: apply param updates on top of the current params,
   * preserve the others, write the URL once.
   */
  const updateParams = useCallback(
    (
      updates: Partial<Record<'view' | 'date' | 'col', string>>,
      history: 'push' | 'replace',
    ) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        params.set(key, value);
      }
      const url = `/schedule?${params.toString()}`;
      if (history === 'replace') {
        router.replace(url);
      } else {
        router.push(url);
      }
    },
    [router, searchParams],
  );

  const setViewMode = useCallback(
    (mode: ScheduleViewMode) => {
      const updates: Partial<Record<'view' | 'date' | 'col', string>> = { view: mode };
      if (mode === 'day' && viewMode !== 'day') {
        // Week → Day: today when the viewed week is the current week,
        // else the Monday of the viewed week (moved from Topbar).
        const weekMonday = currentWeek;
        const weekSunday = new Date(weekMonday);
        weekSunday.setDate(weekSunday.getDate() + 6);
        const now = today();
        const anchored = now >= weekMonday && now <= weekSunday ? now : weekMonday;
        if (toISODate(anchored) !== toISODate(selectedDay)) {
          updates.date = toISODate(anchored);
        }
      }
      updateParams(updates, 'push');
    },
    [viewMode, selectedDay, currentWeek, updateParams],
  );

  const setSelectedDay = useCallback(
    (date: Date) => updateParams({ date: toISODate(date) }, 'push'),
    [updateParams],
  );

  const setColumnMode = useCallback(
    (mode: ScheduleColumnMode) => updateParams({ col: mode }, 'replace'),
    [updateParams],
  );

  const goToToday = useCallback(
    () => updateParams({ date: toISODate(today()) }, 'push'),
    [updateParams],
  );

  const step = useCallback(
    (days: number) => {
      // Week view steps a whole week from the anchor; day view steps one day.
      const from = viewMode === 'week' ? currentWeek : selectedDay;
      updateParams({ date: shiftDateKey(toISODate(from), days) }, 'push');
    },
    [viewMode, currentWeek, selectedDay, updateParams],
  );

  const prevPeriod = useCallback(() => step(viewMode === 'week' ? -7 : -1), [step, viewMode]);
  const nextPeriod = useCallback(() => step(viewMode === 'week' ? 7 : 1), [step, viewMode]);

  return {
    viewMode,
    selectedDay,
    columnMode,
    currentWeek,
    setViewMode,
    setSelectedDay,
    setColumnMode,
    goToToday,
    prevPeriod,
    nextPeriod,
  };
}
