import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScheduleView } from './useScheduleView';
import { getMonday, toISODate } from '@/lib/datetime';

// #138: URL as source of truth for the schedule page (?view=&date=&col=).
// The hook is the single writer: nav steps push, column switch replaces.

const mockPush = vi.fn();
const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

/** Render the hook against a given query string. */
function renderWithParams(query: string) {
  mockSearchParams = new URLSearchParams(query);
  return renderHook(() => useScheduleView());
}

/** Last pushed URL (relative query string) from the mock router. */
function lastWrite(mock: ReturnType<typeof vi.fn>): string {
  return mock.mock.calls.at(-1)?.[0] as string;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchParams = new URLSearchParams();
});

describe('useScheduleView — validation', () => {
  it('defaults to week/masters/today when params absent', () => {
    const { result } = renderWithParams('');
    expect(result.current.viewMode).toBe('week');
    expect(result.current.columnMode).toBe('masters');
    expect(toISODate(result.current.selectedDay)).toBe(toISODate(new Date()));
  });

  it('reads valid params (?view=day&date=2026-03-10&col=locations)', () => {
    const { result } = renderWithParams('?view=day&date=2026-03-10&col=locations');
    expect(result.current.viewMode).toBe('day');
    expect(toISODate(result.current.selectedDay)).toBe('2026-03-10');
    expect(result.current.columnMode).toBe('locations');
  });

  it.each([
    ['broken enum', '?view=month'],
    ['wrong case (enum match is exact)', '?view=Day'],
    ['empty value counts as absent', '?view='],
  ])('%s → view=week', (_name, query) => {
    const { result } = renderWithParams(query);
    expect(result.current.viewMode).toBe('week');
  });

  it.each([
    ['?col=rooms', 'masters'],
    ['?col=Masters', 'masters'],
    ['?col=', 'masters'],
  ])('%s → col=masters', (query, expected) => {
    const { result } = renderWithParams(query);
    expect(result.current.columnMode).toBe(expected);
  });

  it.each([
    ['partial date', '?date=2026-09'],
    ['non-padded date', '?date=2026-9-9'],
    ['impossible date', '?date=2026-02-31'],
    ['impossible month', '?date=2026-13-01'],
    ['timezone suffix', '?date=2026-09-19T00:00:00'],
    ['tz offset', '?date=2026-09-19+03:00'],
    ['literal today is not supported', '?date=today'],
    ['garbage', '?date=banana'],
  ])('%s → falls back to today', (_name, query) => {
    const { result } = renderWithParams(query);
    expect(toISODate(result.current.selectedDay)).toBe(toISODate(new Date()));
  });
});

describe('useScheduleView — currentWeek derivation', () => {
  it('currentWeek is the Monday of ?date', () => {
    // 2026-09-16 is a Wednesday → week Monday is 2026-09-14
    const { result } = renderWithParams('?date=2026-09-16');
    expect(result.current.currentWeek).toEqual(getMonday(new Date(2026, 8, 16)));
    expect(toISODate(result.current.currentWeek)).toBe('2026-09-14');
  });

  it('currentWeek falls back to current week when ?date invalid', () => {
    const { result } = renderWithParams('?date=2026-02-31');
    expect(toISODate(result.current.currentWeek)).toBe(toISODate(getMonday(new Date())));
  });
});

describe('useScheduleView — setters push vs replace', () => {
  it('setViewMode pushes (navigation step)', () => {
    // 2026-01-05 is a Monday outside the current week → plain switch,
    // date untouched (Monday of a past week is already the anchor)
    const { result } = renderWithParams('?view=week&date=2026-01-05');
    act(() => result.current.setViewMode('day'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(lastWrite(mockPush)).toBe('/schedule?view=day&date=2026-01-05');
  });

  it('setSelectedDay pushes and preserves the other params', () => {
    const { result } = renderWithParams('?view=day&date=2026-09-16&col=locations');
    act(() => result.current.setSelectedDay(new Date(2026, 8, 18)));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(lastWrite(mockPush)).toBe('/schedule?view=day&date=2026-09-18&col=locations');
  });

  it('setColumnMode replaces (display toggle, no history step)', () => {
    const { result } = renderWithParams('?view=day&date=2026-09-16&col=masters');
    act(() => result.current.setColumnMode('locations'));
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
    expect(lastWrite(mockReplace)).toBe('/schedule?view=day&date=2026-09-16&col=locations');
  });
});

describe('useScheduleView — period navigation', () => {
  it('prevPeriod in week view steps back 7 days from currentWeek (Monday)', () => {
    // 2026-09-16 is a Wednesday; its week Monday is 09-14 → prev week is 09-07
    const { result } = renderWithParams('?view=week&date=2026-09-16');
    act(() => result.current.prevPeriod());
    expect(lastWrite(mockPush)).toBe('/schedule?view=week&date=2026-09-07');
  });

  it('nextPeriod in week view steps forward 7 days from currentWeek (Monday)', () => {
    const { result } = renderWithParams('?view=week&date=2026-09-16');
    act(() => result.current.nextPeriod());
    expect(lastWrite(mockPush)).toBe('/schedule?view=week&date=2026-09-21');
  });

  it('prevPeriod in day view steps back 1 day', () => {
    const { result } = renderWithParams('?view=day&date=2026-09-16');
    act(() => result.current.prevPeriod());
    expect(lastWrite(mockPush)).toBe('/schedule?view=day&date=2026-09-15');
  });

  it('nextPeriod in day view steps forward 1 day', () => {
    const { result } = renderWithParams('?view=day&date=2026-09-16');
    act(() => result.current.nextPeriod());
    expect(lastWrite(mockPush)).toBe('/schedule?view=day&date=2026-09-17');
  });

  it('goToToday resets date to today, preserves view and col', () => {
    const { result } = renderWithParams('?view=day&date=2026-01-05&col=locations');
    act(() => result.current.goToToday());
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(lastWrite(mockPush)).toBe(
      `/schedule?view=day&date=${toISODate(new Date())}&col=locations`,
    );
  });
});

describe('useScheduleView — day-anchor on week→day switch', () => {
  it('viewed week is the current week → anchors today', () => {
    const todayMonday = toISODate(getMonday(new Date()));
    const { result } = renderWithParams(`?view=week&date=${todayMonday}`);
    act(() => result.current.setViewMode('day'));
    expect(lastWrite(mockPush)).toBe(`/schedule?view=day&date=${toISODate(new Date())}`);
  });

  it('viewed week ≠ current week → anchors Monday of the viewed week', () => {
    // 2026-01-05 is a Monday of a past week (relative to 2026 runtime date)
    const { result } = renderWithParams('?view=week&date=2026-01-05');
    act(() => result.current.setViewMode('day'));
    expect(lastWrite(mockPush)).toBe('/schedule?view=day&date=2026-01-05');
  });

  it('day→week keeps the date (view-only change)', () => {
    const { result } = renderWithParams('?view=day&date=2026-03-10');
    act(() => result.current.setViewMode('week'));
    expect(lastWrite(mockPush)).toBe('/schedule?view=week&date=2026-03-10');
  });
});
