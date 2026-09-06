import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { ScheduleViewProvider, useScheduleView } from '../../contexts/schedule/ScheduleViewContext';
import { NavigationProvider, useNavigation } from '../../contexts/NavigationContext';
import { getMonday, toISODate } from '@/lib/datetime';

// ─── Test component that consumes the view context ───────────────────────────
// Probe mirrors the view-related slice of the old ScheduleConsumer in
// __tests__/ScheduleContext.test.tsx (assertions preserved on move).

function ViewConsumer() {
  const {
    currentWeek,
    stamp,
    setCurrentWeek,
    setStamp,
    viewMode,
    setViewMode,
    selectedDay,
    setSelectedDay,
    columnMode,
    setColumnMode,
    filterMasterIds,
    filterLocationIds,
    setFilterMasterIds,
    setFilterLocationIds,
    prevPeriod,
    nextPeriod,
  } = useScheduleView();

  return (
    <div>
      <span data-testid="week-start">{currentWeek.toISOString()}</span>
      <span data-testid="stamp-ready">{stamp.ready.toString()}</span>
      <span data-testid="view-mode">{viewMode}</span>
      <span data-testid="selected-day">{selectedDay.toISOString()}</span>
      <span data-testid="column-mode">{columnMode}</span>
      <span data-testid="filter-masters">{filterMasterIds.join(',')}</span>
      <span data-testid="filter-locations">{filterLocationIds.join(',')}</span>

      <button
        data-testid="set-week"
        onClick={() => setCurrentWeek(new Date(2026, 4, 18))}
      >
        Set Week
      </button>
      <button
        data-testid="set-stamp"
        onClick={() => setStamp({ ...stamp, ready: true })}
      >
        Set Stamp
      </button>
      <button data-testid="set-view-day" onClick={() => setViewMode('day')}>
        Day
      </button>
      <button data-testid="set-view-week" onClick={() => setViewMode('week')}>
        Week
      </button>
      <button
        data-testid="set-selected-day"
        onClick={() => setSelectedDay(new Date(2026, 5, 15))}
      >
        Set Day
      </button>
      <button data-testid="set-column-locations" onClick={() => setColumnMode('locations')} />
      <button data-testid="set-filter-masters" onClick={() => setFilterMasterIds(['m1', 'm2'])} />
      <button data-testid="set-filter-locations" onClick={() => setFilterLocationIds(['alpika'])} />
      <button data-testid="prev-period" onClick={prevPeriod} />
      <button data-testid="next-period" onClick={nextPeriod} />
    </div>
  );
}

function renderWithViewContext() {
  return render(
    <NavigationProvider>
      <ScheduleViewProvider>
        <ViewConsumer />
      </ScheduleViewProvider>
    </NavigationProvider>,
  );
}

/** Read the current week start (local Date parsed from the probe's ISO string). */
function weekStart(): Date {
  return new Date(screen.getByTestId('week-start').textContent!);
}

function selectedDay(): Date {
  return new Date(screen.getByTestId('selected-day').textContent!);
}

/** toISODate of a local date shifted by N days. */
function shiftDays(date: Date, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ScheduleViewProvider', () => {
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

  // ─── currentWeek / setCurrentWeek ─────────────────────────────────────────

  it('initializes currentWeek to Monday of today', () => {
    renderWithViewContext();
    expect(weekStart().getDay()).toBe(1); // Monday
  });

  it('changes current week', () => {
    renderWithViewContext();
    const expected = getMonday(new Date(2026, 4, 18));
    act(() => {
      screen.getByTestId('set-week').click();
    });
    expect(weekStart().getDate()).toBe(expected.getDate());
  });

  it('synchronizes currentWeek with NavigationProvider dateFrom', () => {
    // ── Navigation consumer changes NavigationProvider's dateFrom ──
    function NavigationController() {
      const { selectDateRange } = useNavigation();
      return (
        <button
          data-testid="nav-set-week"
          onClick={() => selectDateRange('2026-05-11', '2026-05-17')}
        />
      );
    }

    render(
      <NavigationProvider>
        <ScheduleViewProvider>
          <ViewConsumer />
          <NavigationController />
        </ScheduleViewProvider>
      </NavigationProvider>,
    );

    // Click to set NavigationProvider's dateFrom to Monday 2026-05-11
    act(() => {
      screen.getByTestId('nav-set-week').click();
    });

    const start = weekStart();
    // 2026-05-11 is a Monday
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(4); // May
    expect(start.getDate()).toBe(11);
    expect(start.getDay()).toBe(1); // Monday
  });

  // ─── stamp ─────────────────────────────────────────────────────────────────

  it('initializes stamp with ready=false', () => {
    renderWithViewContext();
    expect(screen.getByTestId('stamp-ready').textContent).toBe('false');
  });

  it('updates stamp state', () => {
    renderWithViewContext();
    act(() => {
      screen.getByTestId('set-stamp').click();
    });
    expect(screen.getByTestId('stamp-ready').textContent).toBe('true');
  });

  // ─── viewMode ──────────────────────────────────────────────────────────────

  it('defaults viewMode to "week"', () => {
    renderWithViewContext();
    expect(screen.getByTestId('view-mode').textContent).toBe('week');
  });

  it('provides setViewMode to switch between week and day', () => {
    renderWithViewContext();
    act(() => {
      screen.getByTestId('set-view-day').click();
    });
    expect(screen.getByTestId('view-mode').textContent).toBe('day');

    act(() => {
      screen.getByTestId('set-view-week').click();
    });
    expect(screen.getByTestId('view-mode').textContent).toBe('week');
  });

  // ─── selectedDay ───────────────────────────────────────────────────────────

  it('defaults selectedDay to today', () => {
    renderWithViewContext();
    const today = new Date();
    expect(selectedDay().toDateString()).toBe(today.toDateString());
  });

  it('provides setSelectedDay to change the selected day', () => {
    renderWithViewContext();
    act(() => {
      screen.getByTestId('set-selected-day').click();
    });
    const day = selectedDay();
    expect(day.getFullYear()).toBe(2026);
    expect(day.getMonth()).toBe(5); // June
    expect(day.getDate()).toBe(15);
  });

  // ─── columnMode / filters (view state per the split contract) ─────────────

  it('defaults columnMode to "masters" and filters to empty', () => {
    renderWithViewContext();
    expect(screen.getByTestId('column-mode').textContent).toBe('masters');
    expect(screen.getByTestId('filter-masters').textContent).toBe('');
    expect(screen.getByTestId('filter-locations').textContent).toBe('');
  });

  it('updates columnMode and filters via setters', () => {
    renderWithViewContext();
    act(() => {
      screen.getByTestId('set-column-locations').click();
    });
    expect(screen.getByTestId('column-mode').textContent).toBe('locations');

    act(() => {
      screen.getByTestId('set-filter-masters').click();
    });
    expect(screen.getByTestId('filter-masters').textContent).toBe('m1,m2');

    act(() => {
      screen.getByTestId('set-filter-locations').click();
    });
    expect(screen.getByTestId('filter-locations').textContent).toBe('alpika');
  });

  // ─── period navigation ─────────────────────────────────────────────────────

  it('prevPeriod moves one week back in week mode', () => {
    renderWithViewContext();
    const before = weekStart();
    const expected = shiftDays(before, -7);

    act(() => {
      screen.getByTestId('prev-period').click();
    });

    expect(toISODate(weekStart())).toBe(expected);
  });

  it('nextPeriod moves one week forward in week mode', () => {
    renderWithViewContext();
    const before = weekStart();
    const expected = shiftDays(before, 7);

    act(() => {
      screen.getByTestId('next-period').click();
    });

    expect(toISODate(weekStart())).toBe(expected);
  });

  it('prevPeriod moves one day back in day mode and contains it in the week', () => {
    renderWithViewContext();
    act(() => {
      screen.getByTestId('set-view-day').click();
    });
    const before = selectedDay();
    const expected = shiftDays(before, -1);

    act(() => {
      screen.getByTestId('prev-period').click();
    });

    expect(toISODate(selectedDay())).toBe(expected);
    // Week range navigates to contain the new day
    const monday = getMonday(selectedDay());
    expect(toISODate(weekStart())).toBe(toISODate(monday));
  });

  it('nextPeriod moves one day forward in day mode and contains it in the week', () => {
    renderWithViewContext();
    act(() => {
      screen.getByTestId('set-view-day').click();
    });
    const before = selectedDay();
    const expected = shiftDays(before, 1);

    act(() => {
      screen.getByTestId('next-period').click();
    });

    expect(toISODate(selectedDay())).toBe(expected);
    const monday = getMonday(selectedDay());
    expect(toISODate(weekStart())).toBe(toISODate(monday));
  });

  // ─── __memo-go-to-today ────────────────────────────────────────────────────

  it('resets selectedDay to today when __memo-go-to-today event fires', () => {
    renderWithViewContext();
    // Move selectedDay away from today first
    act(() => {
      screen.getByTestId('set-selected-day').click(); // 2026-06-15
    });

    act(() => {
      document.dispatchEvent(new CustomEvent('__memo-go-to-today'));
    });

    const today = new Date();
    expect(selectedDay().toDateString()).toBe(today.toDateString());
  });

  // ─── __memo-select-day ─────────────────────────────────────────────────────

  it('sets selectedDay and navigates week range when __memo-select-day event fires', () => {
    renderWithViewContext();

    const targetDate = new Date(2026, 5, 15); // June 15, 2026

    act(() => {
      document.dispatchEvent(new CustomEvent('__memo-select-day', { detail: { date: targetDate } }));
    });

    expect(selectedDay().toDateString()).toBe(targetDate.toDateString());
    // Week range contains the day
    const monday = getMonday(targetDate);
    expect(toISODate(weekStart())).toBe(toISODate(monday));
  });

  // ─── __memo-switch-to-day-view ─────────────────────────────────────────────

  it('switches viewMode to "day" and sets selectedDay when __memo-switch-to-day-view event fires', () => {
    renderWithViewContext();
    // Verify initial state
    expect(screen.getByTestId('view-mode').textContent).toBe('week');

    const targetDate = new Date(2026, 5, 15); // June 15, 2026

    act(() => {
      document.dispatchEvent(new CustomEvent('__memo-switch-to-day-view', { detail: { date: targetDate } }));
    });

    expect(screen.getByTestId('view-mode').textContent).toBe('day');
    expect(selectedDay().toDateString()).toBe(targetDate.toDateString());
  });

  it('navigates week range when __memo-switch-to-day-view event fires', () => {
    renderWithViewContext();
    // Set initial week far from the target
    act(() => {
      screen.getByTestId('set-week').click(); // sets to 2026-05-18
    });

    const targetDate = new Date(2026, 6, 6); // July 6, 2026 (Monday)

    act(() => {
      document.dispatchEvent(new CustomEvent('__memo-switch-to-day-view', { detail: { date: targetDate } }));
    });

    // The week should now contain July 6
    expect(weekStart().toDateString()).toBe(targetDate.toDateString());
  });

  // ─── __memo-switch-to-week-view ────────────────────────────────────────────

  it('switches viewMode to "week" and navigates week range when __memo-switch-to-week-view event fires', () => {
    renderWithViewContext();
    // Start in day view
    act(() => {
      screen.getByTestId('set-view-day').click();
    });
    expect(screen.getByTestId('view-mode').textContent).toBe('day');

    const targetDate = new Date(2026, 6, 8); // July 8, 2026 (Wednesday)

    act(() => {
      document.dispatchEvent(new CustomEvent('__memo-switch-to-week-view', { detail: { date: targetDate } }));
    });

    expect(screen.getByTestId('view-mode').textContent).toBe('week');
    // Week start = Monday of the target week (July 6, 2026)
    const monday = getMonday(targetDate);
    expect(toISODate(weekStart())).toBe(toISODate(monday));
  });

  // ─── dispatch effects (sidebar Menubar tracking) ───────────────────────────

  it('dispatches __memo-view-mode-changed when viewMode changes', () => {
    renderWithViewContext();
    const handler = vi.fn();
    document.addEventListener('__memo-view-mode-changed', handler);

    act(() => {
      screen.getByTestId('set-view-day').click();
    });

    expect(handler).toHaveBeenCalled();
    const lastCall = handler.mock.calls[handler.mock.calls.length - 1][0] as CustomEvent;
    expect(lastCall.detail).toEqual({ viewMode: 'day' });

    document.removeEventListener('__memo-view-mode-changed', handler);
  });

  it('dispatches __memo-selected-day-changed when selectedDay changes', () => {
    renderWithViewContext();
    const handler = vi.fn();
    document.addEventListener('__memo-selected-day-changed', handler);

    const target = new Date(2026, 5, 15);
    act(() => {
      screen.getByTestId('set-selected-day').click();
    });

    expect(handler).toHaveBeenCalled();
    const lastCall = handler.mock.calls[handler.mock.calls.length - 1][0] as CustomEvent;
    expect((lastCall.detail.selectedDay as Date).toDateString()).toBe(target.toDateString());

    document.removeEventListener('__memo-selected-day-changed', handler);
  });
});
