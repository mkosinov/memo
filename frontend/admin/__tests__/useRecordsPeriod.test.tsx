/**
 * Tests for useRecordsPeriod — #138 Task 5: /records?from=&to= as the source
 * of truth for the records period.
 *
 * Read semantics (mirror Menubar.readPagePeriod / useScheduleView validation):
 *  - strict `YYYY-MM-DD` AND a real calendar date; anything else = param absent
 *  - no params (or an invalid pair) → monday..sunday of the current week,
 *    SAME `YYYY-MM-DD` string format as the legacy query key
 *    ['records', page, perPage, dateFrom, dateTo, …] (cache keys byte-identical)
 *  - `from > to` → the PAIR is invalid → BOTH sides fall back to defaults
 *    (matches T4 Menubar semantics: red range only for from ≤ to)
 *
 * Write semantics (mirror useScheduleView.updateParams):
 *  - setPeriod replaces via router.replace (no history steps)
 *  - editing one side preserves the other param + all unrelated params
 *  - '' = remove the param (empty string = "param absent")
 *  - sequential synchronous writes compose (latestParamsRef)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('next/navigation', async () => await import('./helpers/nextNavigationMock'));

import { __resetNavigation, __currentQuery, __lastPushedUrl } from './helpers/nextNavigationMock';
import { getMonday, toISODate } from '@/lib/datetime';
import { useRecordsPeriod } from '@/hooks/useRecordsPeriod';

/** Current week's monday..sunday in ISO — the no-params default. */
function expectedDefaultRange(): { from: string; to: string } {
  const monday = getMonday(new Date());
  const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
  return { from: toISODate(monday), to: toISODate(sunday) };
}

beforeEach(() => {
  __resetNavigation('', '/records');
});

describe('useRecordsPeriod — read', () => {
  it('no params → monday..sunday of the current week (same format as the query key)', () => {
    const { result } = renderHook(() => useRecordsPeriod());
    const def = expectedDefaultRange();
    expect(result.current.dateFrom).toBe(def.from);
    expect(result.current.dateTo).toBe(def.to);
  });

  it('valid ?from&to → parsed verbatim as YYYY-MM-DD strings', () => {
    __resetNavigation('?from=2026-02-01&to=2026-02-28', '/records');
    const { result } = renderHook(() => useRecordsPeriod());
    expect(result.current.dateFrom).toBe('2026-02-01');
    expect(result.current.dateTo).toBe('2026-02-28');
  });

  it('one param only → the missing side falls back (from alone → default to; must stay ≤)', () => {
    // from=2026-02-01 with no to: to defaults to sunday of the CURRENT week,
    // which is after 2026-02-01 → the pair is valid, to is the default.
    __resetNavigation('?from=2026-02-01', '/records');
    const { result } = renderHook(() => useRecordsPeriod());
    expect(result.current.dateFrom).toBe('2026-02-01');
    expect(result.current.dateTo).toBe(expectedDefaultRange().to);
  });

  it('invalid date format = param absent → defaults', () => {
    __resetNavigation('?from=2026-13-45&to=2026-02-28', '/records');
    const { result } = renderHook(() => useRecordsPeriod());
    expect(result.current.dateFrom).toBe(expectedDefaultRange().from);
    // to alone is valid and ≥ the default from → kept
    expect(result.current.dateTo).toBe('2026-02-28');
  });

  it('calendar-invalid date (2026-02-31) = param absent → defaults', () => {
    __resetNavigation('?from=2026-02-31&to=2026-02-28', '/records');
    const { result } = renderHook(() => useRecordsPeriod());
    expect(result.current.dateFrom).toBe(expectedDefaultRange().from);
    expect(result.current.dateTo).toBe('2026-02-28');
  });

  it('empty string param = absent → that side defaults', () => {
    __resetNavigation('?from=&to=2026-02-28', '/records');
    const { result } = renderHook(() => useRecordsPeriod());
    expect(result.current.dateFrom).toBe(expectedDefaultRange().from);
    expect(result.current.dateTo).toBe('2026-02-28');
  });

  it('from > to → pair invalid → BOTH sides fall back to the default week', () => {
    __resetNavigation('?from=2026-03-10&to=2026-03-01', '/records');
    const { result } = renderHook(() => useRecordsPeriod());
    const def = expectedDefaultRange();
    expect(result.current.dateFrom).toBe(def.from);
    expect(result.current.dateTo).toBe(def.to);
  });

  it('from == to is a valid single-day pair', () => {
    __resetNavigation('?from=2026-03-05&to=2026-03-05', '/records');
    const { result } = renderHook(() => useRecordsPeriod());
    expect(result.current.dateFrom).toBe('2026-03-05');
    expect(result.current.dateTo).toBe('2026-03-05');
  });

  it('exposes explicitFrom/explicitTo: null for absent sides, ISO for parsed ones', () => {
    __resetNavigation('?from=2026-02-01', '/records');
    const { result } = renderHook(() => useRecordsPeriod());
    expect(result.current.explicitFrom).toBe('2026-02-01');
    expect(result.current.explicitTo).toBeNull();
  });

  it('an inverted pair makes BOTH sides non-explicit (they did not survive the read)', () => {
    __resetNavigation('?from=2026-03-10&to=2026-03-01', '/records');
    const { result } = renderHook(() => useRecordsPeriod());
    expect(result.current.explicitFrom).toBeNull();
    expect(result.current.explicitTo).toBeNull();
  });
});

describe('useRecordsPeriod — write', () => {
  it('setPeriod writes ?from=&to= via router.replace (no push)', () => {
    const { result } = renderHook(() => useRecordsPeriod());
    act(() => result.current.setPeriod('2026-02-01', '2026-02-28'));
    expect(__lastPushedUrl()).toBe('/records?from=2026-02-01&to=2026-02-28');
    expect(__currentQuery()).toBe('?from=2026-02-01&to=2026-02-28');
  });

  it('editing one side preserves the other param', () => {
    __resetNavigation('?from=2026-02-01&to=2026-02-28', '/records');
    const { result } = renderHook(() => useRecordsPeriod());
    act(() => result.current.setPeriod('2026-02-10', '2026-02-28'));
    expect(__currentQuery()).toBe('?from=2026-02-10&to=2026-02-28');
  });

  it("'' removes the param and preserves the other side", () => {
    __resetNavigation('?from=2026-02-01&to=2026-02-28', '/records');
    const { result } = renderHook(() => useRecordsPeriod());
    act(() => result.current.setPeriod('', ''));
    expect(__currentQuery()).toBe('');
  });

  it("'' on one side only removes that side", () => {
    __resetNavigation('?from=2026-02-01&to=2026-02-28', '/records');
    const { result } = renderHook(() => useRecordsPeriod());
    act(() => result.current.setPeriod('', '2026-02-28'));
    expect(__currentQuery()).toBe('?to=2026-02-28');
  });

  it('unrelated params survive a period write', () => {
    __resetNavigation('?x=1&from=2026-02-01&to=2026-02-28', '/records');
    const { result } = renderHook(() => useRecordsPeriod());
    act(() => result.current.setPeriod('2026-02-10', '2026-02-20'));
    const q = __currentQuery();
    expect(q).toContain('x=1');
    expect(q).toContain('from=2026-02-10');
    expect(q).toContain('to=2026-02-20');
  });

  it('sequential synchronous writes compose (second builds on the first)', () => {
    const { result } = renderHook(() => useRecordsPeriod());
    act(() => {
      result.current.setPeriod('2026-02-01', '2026-02-28');
      result.current.setPeriod('2026-02-01', '2026-03-15');
    });
    expect(__currentQuery()).toBe('?from=2026-02-01&to=2026-03-15');
  });

  it('a committed navigation re-adopts the router params (stale ref does not win)', () => {
    const { result } = renderHook(() => useRecordsPeriod());
    act(() => result.current.setPeriod('2026-02-01', '2026-02-28'));
    // Simulate an external navigation (e.g. Menubar link) landing new params.
    act(() => __resetNavigation('?from=2026-05-01&to=2026-05-31', '/records'));
    act(() => result.current.setPeriod('2026-06-01', '2026-06-30'));
    expect(__currentQuery()).toBe('?from=2026-06-01&to=2026-06-30');
  });

  it('the URL round-trips: write → re-render reads the same strings back', () => {
    const { result, rerender } = renderHook(() => useRecordsPeriod());
    act(() => result.current.setPeriod('2026-02-01', '2026-02-28'));
    rerender();
    expect(result.current.dateFrom).toBe('2026-02-01');
    expect(result.current.dateTo).toBe('2026-02-28');
  });
});
