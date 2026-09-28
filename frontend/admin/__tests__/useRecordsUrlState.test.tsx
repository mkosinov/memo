/**
 * Tests for useRecordsUrlState — #349 Task 7: the /records URL-state adapter
 * (period datePair + canonical table params) over the generic useTableUrlState.
 *
 * Period read semantics (ported from the useRecordsPeriod tests, #138 T5):
 *  - strict `YYYY-MM-DD` AND a real calendar date; anything else = param absent
 *  - no params → monday..sunday of the current week, the SAME strings as the
 *    legacy query key ['records', page, perPage, dateFrom, dateTo, …]
 *  - one side absent → that side falls back to its default
 *  - `from > to` → the PAIR is invalid → BOTH sides fall back; the URL is
 *    never rewritten on read
 *
 * Write semantics (Gate B, #349): a period change is a HISTORY STEP —
 * setPeriod()/update() navigate via router.push (the legacy useRecordsPeriod
 * used replace). '' in setPeriod removes the param (empty = absent).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('next/navigation', async () => await import('./helpers/nextNavigationMock'));

import {
  __resetNavigation,
  __currentQuery,
  __lastPushedUrl,
  __lastNavMethod,
} from './helpers/nextNavigationMock';
import { getMonday, toISODate } from '@/lib/datetime';
import { useRecordsUrlState } from '../app/(main)/records/useRecordsUrlState';

/** Current week's monday..sunday in ISO — the no-params default. */
function expectedDefaultRange(): { from: string; to: string } {
  const monday = getMonday(new Date());
  const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
  return { from: toISODate(monday), to: toISODate(sunday) };
}

/** Advance past the ~16ms coalescing window so the scheduled flush fires. */
async function flushFrame(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  __resetNavigation('', '/records');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useRecordsUrlState — period read', () => {
  it('no params → monday..sunday of the current week (same format as the query key)', () => {
    const { result } = renderHook(() => useRecordsUrlState());
    const def = expectedDefaultRange();
    expect(result.current.state.dateFrom).toBe(def.from);
    expect(result.current.state.dateTo).toBe(def.to);
  });

  it('valid ?from&to → parsed verbatim as YYYY-MM-DD strings', () => {
    __resetNavigation('?from=2026-02-01&to=2026-02-28', '/records');
    const { result } = renderHook(() => useRecordsUrlState());
    expect(result.current.state.dateFrom).toBe('2026-02-01');
    expect(result.current.state.dateTo).toBe('2026-02-28');
  });

  it('one param only → the missing side falls back to its own default', () => {
    // from=2026-02-01 with no to: to defaults to sunday of the CURRENT week
    // (the legacy useRecordsPeriod read — wire behavior unchanged).
    __resetNavigation('?from=2026-02-01', '/records');
    const { result } = renderHook(() => useRecordsUrlState());
    expect(result.current.state.dateFrom).toBe('2026-02-01');
    expect(result.current.state.dateTo).toBe(expectedDefaultRange().to);
  });

  it('invalid date format = param absent → that side defaults', () => {
    __resetNavigation('?from=2026-13-45&to=2026-02-28', '/records');
    const { result } = renderHook(() => useRecordsUrlState());
    expect(result.current.state.dateFrom).toBe(expectedDefaultRange().from);
    expect(result.current.state.dateTo).toBe('2026-02-28');
  });

  it('calendar-invalid date (2026-02-31) = param absent → that side defaults', () => {
    __resetNavigation('?from=2026-02-31&to=2026-02-28', '/records');
    const { result } = renderHook(() => useRecordsUrlState());
    expect(result.current.state.dateFrom).toBe(expectedDefaultRange().from);
    expect(result.current.state.dateTo).toBe('2026-02-28');
  });

  it('empty string param = absent → that side defaults', () => {
    __resetNavigation('?from=&to=2026-02-28', '/records');
    const { result } = renderHook(() => useRecordsUrlState());
    expect(result.current.state.dateFrom).toBe(expectedDefaultRange().from);
    expect(result.current.state.dateTo).toBe('2026-02-28');
  });

  it('from > to → pair invalid → BOTH sides fall back to the default week, URL NOT rewritten', () => {
    __resetNavigation('?from=2026-03-10&to=2026-03-01', '/records');
    const { result } = renderHook(() => useRecordsUrlState());
    const def = expectedDefaultRange();
    expect(result.current.state.dateFrom).toBe(def.from);
    expect(result.current.state.dateTo).toBe(def.to);
    // Read is silent — no navigation correct the dirty URL.
    expect(__lastNavMethod()).toBeNull();
  });

  it('from == to is a valid single-day pair', () => {
    __resetNavigation('?from=2026-03-05&to=2026-03-05', '/records');
    const { result } = renderHook(() => useRecordsUrlState());
    expect(result.current.state.dateFrom).toBe('2026-03-05');
    expect(result.current.state.dateTo).toBe('2026-03-05');
  });

  it('exposes explicitFrom/explicitTo: null for absent sides, ISO for parsed ones', () => {
    __resetNavigation('?from=2026-02-01', '/records');
    const { result } = renderHook(() => useRecordsUrlState());
    expect(result.current.state.explicitFrom).toBe('2026-02-01');
    expect(result.current.state.explicitTo).toBeNull();
  });

  it('no params at all → BOTH explicit sides null (defaults are display-only, never written back)', () => {
    const { result } = renderHook(() => useRecordsUrlState());
    const def = expectedDefaultRange();
    // Effective display values = the default week…
    expect(result.current.state.dateFrom).toBe(def.from);
    expect(result.current.state.dateTo).toBe(def.to);
    // …but neither side is EXPLICIT (a half-filter write must not seed the
    // defaulted display value into the URL).
    expect(result.current.state.explicitFrom).toBeNull();
    expect(result.current.state.explicitTo).toBeNull();
  });

  it('an inverted pair makes BOTH sides non-explicit (they did not survive the read)', () => {
    __resetNavigation('?from=2026-03-10&to=2026-03-01', '/records');
    const { result } = renderHook(() => useRecordsUrlState());
    expect(result.current.state.explicitFrom).toBeNull();
    expect(result.current.state.explicitTo).toBeNull();
  });
});

describe('useRecordsUrlState — table params read', () => {
  it('no params → empty filters, default sort date/asc, page 1, perPage 10', () => {
    const { result } = renderHook(() => useRecordsUrlState());
    expect(result.current.state.filters).toEqual({
      locationId: '', serviceId: '', masterId: '', status: '', search: '',
    });
    expect(result.current.state.sortBy).toBe('date');
    expect(result.current.state.sortOrder).toBe('asc');
    expect(result.current.state.page).toBe(1);
    expect(result.current.state.perPage).toBe(10);
  });

  it('valid params map to the camelCase view (q→search, ids→filters)', () => {
    __resetNavigation(
      '?q=%D0%B0%D0%BD%D0%BD%D0%B0&status=waiting&location_id=loc-1&service_id=svc-1&master_id=m-1',
      '/records',
    );
    const { result } = renderHook(() => useRecordsUrlState());
    expect(result.current.state.filters).toEqual({
      locationId: 'loc-1', serviceId: 'svc-1', masterId: 'm-1',
      status: 'waiting', search: 'анна',
    });
  });

  it('?sort_by=total&sort_order=desc → sortBy/sortOrder verbatim', () => {
    __resetNavigation('?sort_by=total&sort_order=desc', '/records');
    const { result } = renderHook(() => useRecordsUrlState());
    expect(result.current.state.sortBy).toBe('total');
    expect(result.current.state.sortOrder).toBe('desc');
  });

  it('?sort_order=desc alone → date desc (NO requires linkage — default sort is meaningful)', () => {
    __resetNavigation('?sort_order=desc', '/records');
    const { result } = renderHook(() => useRecordsUrlState());
    expect(result.current.state.sortBy).toBe('date');
    expect(result.current.state.sortOrder).toBe('desc');
  });

  it('?page=3&per_page=50 → page/perPage', () => {
    __resetNavigation('?page=3&per_page=50', '/records');
    const { result } = renderHook(() => useRecordsUrlState());
    expect(result.current.state.page).toBe(3);
    expect(result.current.state.perPage).toBe(50);
  });

  it('dirty values fall back silently (bogus status/sort, page=0, per_page=7)', () => {
    __resetNavigation('?status=bogus&sort_by=bogus&page=0&per_page=7', '/records');
    const { result } = renderHook(() => useRecordsUrlState());
    expect(result.current.state.filters.status).toBe('');
    expect(result.current.state.sortBy).toBe('date');
    expect(result.current.state.page).toBe(1);
    expect(result.current.state.perPage).toBe(10);
    // Dirty URL is NOT rewritten on read.
    expect(__lastNavMethod()).toBeNull();
  });
});

describe('useRecordsUrlState — setPeriod write (Gate B: push, not replace)', () => {
  it('setPeriod writes ?from=&to= via router.push (a period change is a history step)', async () => {
    const { result } = renderHook(() => useRecordsUrlState());
    act(() => result.current.setPeriod('2026-02-01', '2026-02-28'));
    await flushFrame();
    expect(__lastPushedUrl()).toBe('/records?from=2026-02-01&to=2026-02-28');
    expect(__lastNavMethod()).toBe('push');
    expect(__currentQuery()).toBe('?from=2026-02-01&to=2026-02-28');
  });

  it('editing one side preserves the other param', async () => {
    __resetNavigation('?from=2026-02-01&to=2026-02-28', '/records');
    const { result } = renderHook(() => useRecordsUrlState());
    act(() => result.current.setPeriod('2026-02-10', '2026-02-28'));
    await flushFrame();
    expect(__currentQuery()).toBe('?from=2026-02-10&to=2026-02-28');
  });

  it("'' removes BOTH params (reset → clean URL)", async () => {
    __resetNavigation('?from=2026-02-01&to=2026-02-28', '/records');
    const { result } = renderHook(() => useRecordsUrlState());
    act(() => result.current.setPeriod('', ''));
    await flushFrame();
    expect(__currentQuery()).toBe('');
  });

  it("'' on one side only removes that side", async () => {
    __resetNavigation('?from=2026-02-01&to=2026-02-28', '/records');
    const { result } = renderHook(() => useRecordsUrlState());
    act(() => result.current.setPeriod('', '2026-02-28'));
    await flushFrame();
    expect(__currentQuery()).toBe('?to=2026-02-28');
  });

  it('unrelated params survive a period write', async () => {
    __resetNavigation('?x=1&from=2026-02-01&to=2026-02-28', '/records');
    const { result } = renderHook(() => useRecordsUrlState());
    act(() => result.current.setPeriod('2026-02-10', '2026-02-20'));
    await flushFrame();
    const q = __currentQuery();
    expect(q).toContain('x=1');
    expect(q).toContain('from=2026-02-10');
    expect(q).toContain('to=2026-02-20');
  });

  it('sequential synchronous writes compose (coalesced into one navigation)', async () => {
    const { result } = renderHook(() => useRecordsUrlState());
    act(() => {
      result.current.setPeriod('2026-02-01', '2026-02-28');
      result.current.setPeriod('2026-02-01', '2026-03-15');
    });
    await flushFrame();
    expect(__currentQuery()).toBe('?from=2026-02-01&to=2026-03-15');
  });

  it('a committed navigation re-adopts the router params (stale ref does not win)', async () => {
    const { result } = renderHook(() => useRecordsUrlState());
    act(() => result.current.setPeriod('2026-02-01', '2026-02-28'));
    await flushFrame();
    // Simulate an external navigation (e.g. Menubar link) landing new params.
    act(() => __resetNavigation('?from=2026-05-01&to=2026-05-31', '/records'));
    act(() => result.current.setPeriod('2026-06-01', '2026-06-30'));
    await flushFrame();
    expect(__currentQuery()).toBe('?from=2026-06-01&to=2026-06-30');
  });

  it('the URL round-trips: write → re-render reads the same strings back', async () => {
    const { result } = renderHook(() => useRecordsUrlState());
    act(() => result.current.setPeriod('2026-02-01', '2026-02-28'));
    await flushFrame();
    expect(result.current.state.dateFrom).toBe('2026-02-01');
    expect(result.current.state.dateTo).toBe('2026-02-28');
  });

  it('writing a period equal to the current week strips both params (default state)', async () => {
    const def = expectedDefaultRange();
    const { result } = renderHook(() => useRecordsUrlState());
    act(() => result.current.setPeriod(def.from, def.to));
    await flushFrame();
    expect(__currentQuery()).toBe('');
  });
});

describe('useRecordsUrlState — update (camelCase patch → URL)', () => {
  it('filter patch translates to canonical URL names (search→q, ids→*_id)', async () => {
    const { result } = renderHook(() => useRecordsUrlState());
    act(() => {
      result.current.update({
        search: 'анна',
        status: 'waiting',
        locationId: 'loc-1',
        serviceId: 'svc-1',
        masterId: 'm-1',
      });
    });
    await flushFrame();
    const q = __currentQuery();
    expect(q).toContain('q=%D0%B0%D0%BD%D0%BD%D0%B0');
    expect(q).toContain('status=waiting');
    expect(q).toContain('location_id=loc-1');
    expect(q).toContain('service_id=svc-1');
    expect(q).toContain('master_id=m-1');
  });

  it('a filter change resets page→1 in the same navigation (page stripped as default)', async () => {
    __resetNavigation('?page=3&status=waiting', '/records');
    const { result } = renderHook(() => useRecordsUrlState());
    act(() => result.current.update({ status: 'visited' }));
    await flushFrame();
    const q = __currentQuery();
    expect(q).toContain('status=visited');
    expect(q).not.toContain('page=');
    expect(result.current.state.page).toBe(1);
  });

  it('explicit page in the patch wins over the auto-reset', async () => {
    const { result } = renderHook(() => useRecordsUrlState());
    act(() => result.current.update({ status: 'waiting', page: 2 }));
    await flushFrame();
    const q = __currentQuery();
    expect(q).toContain('status=waiting');
    expect(q).toContain('page=2');
  });

  it('sort patch writes sort_by/sort_order; back-to-default strips both', async () => {
    const { result } = renderHook(() => useRecordsUrlState());
    act(() => result.current.update({ sortBy: 'total', sortOrder: 'desc' }));
    await flushFrame();
    expect(__currentQuery()).toBe('?sort_by=total&sort_order=desc');
    act(() => result.current.update({ sortBy: 'date', sortOrder: 'asc' }));
    await flushFrame();
    expect(__currentQuery()).toBe('');
  });

  it('period patch with one null side keeps that side absent', async () => {
    const { result } = renderHook(() => useRecordsUrlState());
    act(() => result.current.update({ period: { from: '2026-02-01', to: null } }));
    await flushFrame();
    expect(__currentQuery()).toBe('?from=2026-02-01');
  });

  it('perPage patch writes per_page and resets page', async () => {
    __resetNavigation('?page=4', '/records');
    const { result } = renderHook(() => useRecordsUrlState());
    act(() => result.current.update({ perPage: 50 }));
    await flushFrame();
    expect(__currentQuery()).toBe('?per_page=50');
  });

  it("history:'replace' navigates via replace (service corrections)", async () => {
    const { result } = renderHook(() => useRecordsUrlState());
    act(() => result.current.update({ page: 2 }, { history: 'replace' }));
    await flushFrame();
    expect(__currentQuery()).toBe('?page=2');
    expect(__lastNavMethod()).toBe('replace');
  });
});


