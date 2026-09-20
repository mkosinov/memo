import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { ScheduleViewProvider, useScheduleView } from '../../contexts/schedule/ScheduleViewContext';
import { createMockUseScheduleView } from '../helpers/mockContexts';
import type { ScheduleView } from '../../hooks/useScheduleView';

// #138 Task 2 — CONTRACT tests: ScheduleViewContext no longer owns view state.
// view/date/col (+ currentWeek/prev/next/today) come from the URL hook
// hooks/useScheduleView; the provider proxies them and keeps ONLY stamp and
// the two filter lists as local state. NavigationContext is NOT involved.

// The hook module is mocked wholesale: these tests assert the proxy wiring,
// not URL parsing (that's hooks/useScheduleView.test.ts).
const hookResult = createMockUseScheduleView();

vi.mock('../../hooks/useScheduleView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useScheduleView')>();
  return {
    ...actual,
    useScheduleView: vi.fn(() => hookResult),
  };
});

// ─── Test component that consumes the view context ───────────────────────────

function ViewConsumer() {
  const {
    viewMode,
    setViewMode,
    selectedDay,
    setSelectedDay,
    columnMode,
    setColumnMode,
    currentWeek,
    goToToday,
    prevPeriod,
    nextPeriod,
    stamp,
    setStamp,
    filterMasterIds,
    filterLocationIds,
    setFilterMasterIds,
    setFilterLocationIds,
  } = useScheduleView();

  return (
    <div>
      <span data-testid="view-mode">{viewMode}</span>
      <span data-testid="selected-day">{selectedDay.toISOString()}</span>
      <span data-testid="column-mode">{columnMode}</span>
      <span data-testid="week-start">{currentWeek.toISOString()}</span>
      <span data-testid="stamp-ready">{stamp.ready.toString()}</span>
      <span data-testid="filter-masters">{filterMasterIds.join(',')}</span>
      <span data-testid="filter-locations">{filterLocationIds.join(',')}</span>

      <button data-testid="set-view-day" onClick={() => setViewMode('day')} />
      <button data-testid="set-selected-day" onClick={() => setSelectedDay(new Date(2026, 5, 15))} />
      <button data-testid="set-column-locations" onClick={() => setColumnMode('locations')} />
      <button data-testid="go-to-today" onClick={goToToday} />
      <button data-testid="prev-period" onClick={prevPeriod} />
      <button data-testid="next-period" onClick={nextPeriod} />
      <button data-testid="set-stamp" onClick={() => setStamp({ ...stamp, ready: true })} />
      <button data-testid="set-filter-masters" onClick={() => setFilterMasterIds(['m1', 'm2'])} />
      <button data-testid="set-filter-locations" onClick={() => setFilterLocationIds(['alpika'])} />
    </div>
  );
}

function renderWithViewContext(hook: ScheduleView = hookResult) {
  vi.mocked(hookModule.useScheduleView).mockReturnValue(hook);
  return render(
    <ScheduleViewProvider>
      <ViewConsumer />
    </ScheduleViewProvider>,
  );
}

// Imported AFTER the vi.mock registration (vitest hoists it), so this is the
// mocked module — same pattern as renderWithProviders.tsx.
import * as hookModule from '../../hooks/useScheduleView';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ScheduleViewProvider (proxy contract, #138)', () => {
  it('throws when useScheduleView is used outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function BrokenConsumer() {
      useScheduleView();
      return null;
    }
    expect(() => render(<BrokenConsumer />)).toThrow(
      'useScheduleView must be used within ScheduleViewProvider'
    );
    spy.mockRestore();
  });

  // ─── view fields are the hook's values, verbatim ──────────────────────────

  it('exposes viewMode / selectedDay / columnMode / currentWeek from the hook', () => {
    renderWithViewContext(
      createMockUseScheduleView({
        viewMode: 'day',
        selectedDay: new Date(2026, 8, 16),
        columnMode: 'locations',
        currentWeek: new Date(2026, 8, 14),
      }),
    );
    expect(screen.getByTestId('view-mode').textContent).toBe('day');
    expect(new Date(screen.getByTestId('selected-day').textContent!).toDateString()).toBe(
      new Date(2026, 8, 16).toDateString(),
    );
    expect(screen.getByTestId('column-mode').textContent).toBe('locations');
    expect(new Date(screen.getByTestId('week-start').textContent!).toDateString()).toBe(
      new Date(2026, 8, 14).toDateString(),
    );
  });

  it('exposes the hook\'s setters BY IDENTITY — the context adds no layer', () => {
    const hook = createMockUseScheduleView();
    renderWithViewContext(hook);

    act(() => screen.getByTestId('set-view-day').click());
    act(() => screen.getByTestId('set-selected-day').click());
    act(() => screen.getByTestId('set-column-locations').click());
    act(() => screen.getByTestId('go-to-today').click());
    act(() => screen.getByTestId('prev-period').click());
    act(() => screen.getByTestId('next-period').click());

    expect(hook.setViewMode).toHaveBeenCalledWith('day');
    expect(hook.setSelectedDay).toHaveBeenCalledWith(new Date(2026, 5, 15));
    expect(hook.setColumnMode).toHaveBeenCalledWith('locations');
    expect(hook.goToToday).toHaveBeenCalledTimes(1);
    expect(hook.prevPeriod).toHaveBeenCalledTimes(1);
    expect(hook.nextPeriod).toHaveBeenCalledTimes(1);
  });

  // ─── stamp stays LOCAL state (not part of the URL contract) ───────────────

  it('initializes stamp with ready=false', () => {
    renderWithViewContext();
    expect(screen.getByTestId('stamp-ready').textContent).toBe('false');
  });

  it('updates stamp state locally', () => {
    renderWithViewContext();
    act(() => screen.getByTestId('set-stamp').click());
    expect(screen.getByTestId('stamp-ready').textContent).toBe('true');
  });

  // ─── filters stay LOCAL state ─────────────────────────────────────────────

  it('defaults filters to empty', () => {
    renderWithViewContext();
    expect(screen.getByTestId('filter-masters').textContent).toBe('');
    expect(screen.getByTestId('filter-locations').textContent).toBe('');
  });

  it('updates filters locally', () => {
    renderWithViewContext();
    act(() => screen.getByTestId('set-filter-masters').click());
    act(() => screen.getByTestId('set-filter-locations').click());
    expect(screen.getByTestId('filter-masters').textContent).toBe('m1,m2');
    expect(screen.getByTestId('filter-locations').textContent).toBe('alpika');
  });

  // ─── the CustomEvent bus is GONE: dispatching legacy events is a no-op ────

  it.each([
    '__memo-go-to-today',
    '__memo-select-day',
    '__memo-switch-to-day-view',
    '__memo-switch-to-week-view',
  ])('ignores the legacy %s event (listener removed, writers moved to the URL)', (event) => {
    const hook = createMockUseScheduleView();
    renderWithViewContext(hook);

    act(() => {
      document.dispatchEvent(
        new CustomEvent(event, { detail: { date: new Date(2026, 5, 15) } }),
      );
    });

    // No hook setter fired, no local state moved.
    expect(hook.setViewMode).not.toHaveBeenCalled();
    expect(hook.setSelectedDay).not.toHaveBeenCalled();
    expect(hook.goToToday).not.toHaveBeenCalled();
    expect(screen.getByTestId('stamp-ready').textContent).toBe('false');
  });

  it('does NOT re-broadcast __memo-view-mode-changed / __memo-selected-day-changed', () => {
    renderWithViewContext();
    const viewHandler = vi.fn();
    const dayHandler = vi.fn();
    document.addEventListener('__memo-view-mode-changed', viewHandler);
    document.addEventListener('__memo-selected-day-changed', dayHandler);

    act(() => screen.getByTestId('set-stamp').click());

    expect(viewHandler).not.toHaveBeenCalled();
    expect(dayHandler).not.toHaveBeenCalled();

    document.removeEventListener('__memo-view-mode-changed', viewHandler);
    document.removeEventListener('__memo-selected-day-changed', dayHandler);
  });
});
