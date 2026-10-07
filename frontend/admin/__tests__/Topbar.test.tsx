import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider, useMutationState } from '@tanstack/react-query';
import { Topbar } from '../app/components/layout/Topbar';
import { UIProvider } from '../contexts/UIContext';
import { UserSettingsProvider } from '../contexts/UserSettingsContext';
import { ScheduleViewProvider } from '../contexts/schedule/ScheduleViewContext';
import { getUserSettings, patchUserSettings } from '@memo/api-client';
import {
  createMockScheduleData,
  createMockUseScheduleView,
  createMockScheduleView,
  createMockGridSettings,
} from './helpers/mockContexts';
import type { ScheduleDataContextType } from '@/contexts/schedule/ScheduleDataContext';
import type { ScheduleView } from '@/hooks/useScheduleView';
import type { ScheduleViewContextType } from '@/contexts/schedule/ScheduleViewContext';
import type { GridSettingsContextType } from '@/contexts/schedule/GridSettingsContext';

// #138 Task 3: Topbar consumes the URL hook (view concerns) + the context
// (filters/stamp — non-view). NavigationContext is GONE from this tree; URL
// writes are observed through the reactive next/navigation mock.

vi.mock('next/navigation', async () => await import('./helpers/nextNavigationMock'));
import { __resetNavigation, __currentQuery } from './helpers/nextNavigationMock';

vi.mock('@memo/api-client', () => {
  const wrap = (items: any[]) => ({ items, total: items.length, page: 1, per_page: 100 });
  return ({
  getMasters: vi.fn().mockResolvedValue(wrap([])),
  getLocations: vi.fn().mockResolvedValue(wrap([])),
  getServices: vi.fn().mockResolvedValue(wrap([])),
  getActivities: vi.fn().mockResolvedValue(wrap([])),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  getUserSettings: vi.fn(),
  patchUserSettings: vi.fn(),
  });
});

// GH #267: UserSettingsProvider gates loading on useAuth().status — mock the
// auth hook to report `authenticated` so the settings provider settles.
vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ status: 'authenticated', user: { id: 'u1' }, permissions: [], master: null, login: vi.fn(), logout: vi.fn(), can: vi.fn(() => false), refresh: vi.fn() })),
}));

// Partial mock — real QueryClient/QueryClientProvider stay intact; only
// useMutationState (the saving-indicator source, spec §5) is faked.
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useMutationState: vi.fn(() => [] as boolean[]),
  };
});

// Partial mock — SCHEDULE_ACTIVITY_MUTATION_KEY stays the real export
// (Topbar imports it at module level).
vi.mock('@/contexts/schedule/ScheduleDataContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/schedule/ScheduleDataContext')>();
  return {
    ...actual,
    useScheduleData: vi.fn(() => createMockScheduleData()),
  };
});

// Setter-identity mode (default): the URL hook module is mocked with the
// shared factory; tests below assert Topbar delegates to the hook setters
// and does NOT duplicate day-anchor/date logic. URL-write tests flip
// `hookImpl` to the REAL implementation (importOriginal) so Topbar +
// ScheduleViewProvider run the actual URL hook against the router mock.
// The holder lives in vi.hoisted — the mock factory runs before module body.
const { hookRef } = vi.hoisted(() => ({
  hookRef: {
    impl: null as null | ((...args: unknown[]) => unknown),
    real: null as null | ((...args: unknown[]) => unknown),
  },
}));

vi.mock('@/hooks/useScheduleView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useScheduleView')>();
  hookRef.real = actual.useScheduleView as unknown as (...args: unknown[]) => unknown;
  return {
    ...actual,
    useScheduleView: vi.fn((...args: Parameters<typeof actual.useScheduleView>) =>
      (hookRef.impl ?? createMockUseScheduleView)(...(args as [])) as ReturnType<
        typeof actual.useScheduleView
      >,
    ),
  };
});

// Context is still consumed for NON-view concerns (filter lists). The context
// module re-exports the hook under the same name — keep the view fields from
// the same fixture so Topbar renders.
vi.mock('@/contexts/schedule/ScheduleViewContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/schedule/ScheduleViewContext')>();
  return {
    ...actual,
    useScheduleView: vi.fn(() => createMockScheduleView()),
  };
});

vi.mock('@/contexts/schedule/GridSettingsContext', () => ({
  useGridSettings: vi.fn(() => createMockGridSettings()),
}));

import { useScheduleData } from '@/contexts/schedule/ScheduleDataContext';
import { useScheduleView as useViewContext } from '@/contexts/schedule/ScheduleViewContext';
import { useGridSettings } from '@/contexts/schedule/GridSettingsContext';

// ─── Render helpers ───────────────────────────────────────────────────────

interface TopbarMockOverrides {
  data?: Partial<ScheduleDataContextType>;
  view?: Partial<ScheduleView>;
  context?: Partial<ScheduleViewContextType>;
  grid?: Partial<GridSettingsContextType>;
}

// Module-scoped so `rerender(providersElement())` reuses the SAME client
// (needed by the saving-indicator tests that flip useMutationState between renders).
let queryClient: QueryClient;

function providersElement() {
  return (
    <QueryClientProvider client={queryClient}>
      <UIProvider>
        <UserSettingsProvider>
          <Topbar />
        </UserSettingsProvider>
      </UIProvider>
    </QueryClientProvider>
  );
}

/** Default render: BOTH hook and context modules mocked (setter-identity tests). */
function renderTopbar(overrides: TopbarMockOverrides = {}) {
  // One fixture per render call — re-renders must keep the SAME vi.fn() setters.
  const fixture = createMockUseScheduleView(overrides.view);
  hookRef.impl = () => fixture;
  vi.mocked(useScheduleData).mockReturnValue(createMockScheduleData(overrides.data));
  vi.mocked(useViewContext).mockReturnValue(createMockScheduleView(overrides.context));
  vi.mocked(useGridSettings).mockReturnValue(createMockGridSettings(overrides.grid));
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(providersElement());
}

/** Open the «Вид» dropdown and click one of its options. */
function selectViewOption(testId: string) {
  fireEvent.click(screen.getByTestId('view-selector'));
  fireEvent.click(screen.getByTestId(testId));
}

/** Real-hook render: flips the hook mock to the REAL implementation so
 *  Topbar + ScheduleViewProvider run the actual URL hook + REAL context
 *  against the mocked router. Asserts URL outcomes via __currentQuery(). */
function renderTopbarReal() {
  hookRef.impl = hookRef.real;
  vi.mocked(useScheduleData).mockReturnValue(createMockScheduleData());
  vi.mocked(useGridSettings).mockReturnValue(createMockGridSettings());
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <UIProvider>
        <UserSettingsProvider>
          <ScheduleViewProvider>
            <Topbar />
          </ScheduleViewProvider>
        </UserSettingsProvider>
      </UIProvider>
    </QueryClientProvider>,
  );
}

describe('Topbar', () => {
  beforeEach(() => {
    __resetNavigation();
    document.documentElement.removeAttribute('data-theme');
    vi.clearAllMocks();
    vi.mocked(useMutationState).mockReturnValue([]);
    // Settings fixture: remote GET resolves the toggles; PUT/PATCH no-op.
    vi.mocked(getUserSettings).mockResolvedValue({
      user_id: 'u1',
      theme: 'light',
      language: 'ru',
      column_order_staff: [],
      column_order_locations: [],
      show_archived_masters: true,
      show_archived_locations: false,
    } as never);
    vi.mocked(patchUserSettings).mockResolvedValue({} as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not render week navigation buttons (moved to sidebar)', () => {
    renderTopbar();
    expect(screen.queryByRole('button', { name: /Предыдущая/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Следующая/i })).not.toBeInTheDocument();
  });

  it('does not render date range text (week nav removed)', () => {
    renderTopbar();
    expect(screen.queryByTestId('date-range')).not.toBeInTheDocument();
  });

  it('does not render "Сегодня" button (moved to sidebar)', () => {
    renderTopbar();
    expect(screen.queryByRole('button', { name: 'Сегодня' })).not.toBeInTheDocument();
  });

  it('does not render copy last week button (moved to RightPanel)', () => {
    renderTopbar();
    expect(screen.queryByRole('button', { name: /Копировать/i })).not.toBeInTheDocument();
  });

  it('does not render delete mode toggle (moved to StampPanel)', () => {
    renderTopbar();
    expect(screen.queryByRole('button', { name: /Режим удаления/i })).not.toBeInTheDocument();
  });

  it('renders separate Masters and Locations filter buttons', () => {
    renderTopbar();
    expect(screen.getByLabelText('Мастера')).toBeInTheDocument();
    expect(screen.getByLabelText('Локации')).toBeInTheDocument();
  });

  it('does NOT render the old combined filter button', () => {
    renderTopbar();
    expect(screen.queryByLabelText('Фильтры')).not.toBeInTheDocument();
  });

  it('renders the single view selector: trigger shows the active option (week)', () => {
    renderTopbar();
    expect(screen.getByTestId('view-selector')).toHaveTextContent('Неделя');
  });

  it('trigger label follows the day option (day by locations)', () => {
    renderTopbar({ view: { viewMode: 'day', columnMode: 'locations' } });
    expect(screen.getByTestId('view-selector')).toHaveTextContent('День локаций');
  });

  it('dropdown opens with three options, active marked per current view', () => {
    renderTopbar();
    fireEvent.click(screen.getByTestId('view-selector'));
    expect(screen.getByTestId('view-mode-menu')).toBeInTheDocument();
    expect(screen.getByTestId('view-masters')).toHaveTextContent('День мастеров');
    expect(screen.getByTestId('view-locations')).toHaveTextContent('День локаций');
    expect(screen.getByTestId('view-week')).toHaveTextContent('Неделя');
    expect(screen.getByTestId('view-week')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('view-masters')).toHaveAttribute('data-active', 'false');
  });

  it('dropdown closes after selecting an option', () => {
    renderTopbar();
    fireEvent.click(screen.getByTestId('view-selector'));
    fireEvent.click(screen.getByTestId('view-week'));
    expect(screen.queryByTestId('view-mode-menu')).not.toBeInTheDocument();
  });

  // ── View mode switch — DELEGATES to the hook, no duplicated logic ────

  it('calls hook setViewMode("day") when «День мастеров» is clicked from week', () => {
    const setViewMode = vi.fn();
    const setColumnMode = vi.fn();
    renderTopbar({ view: { viewMode: 'week', setViewMode, setColumnMode } });

    selectViewOption('view-masters');
    expect(setViewMode).toHaveBeenCalledWith('day');
    // columnMode is already masters (default) — no redundant col write
    expect(setColumnMode).not.toHaveBeenCalled();
  });

  it('does NOT call setSelectedDay on week→day switch (day-anchor lives in the hook)', () => {
    const setViewMode = vi.fn();
    const setSelectedDay = vi.fn();
    renderTopbar({
      view: { viewMode: 'week', currentWeek: new Date(2026, 5, 8), setViewMode, setSelectedDay },
    });

    selectViewOption('view-masters');
    expect(setViewMode).toHaveBeenCalledTimes(1);
    expect(setSelectedDay).not.toHaveBeenCalled();
  });

  it('same-option click in week view is a no-op (no setter calls)', () => {
    const setViewMode = vi.fn();
    const setSelectedDay = vi.fn();
    const setColumnMode = vi.fn();
    renderTopbar({
      view: { viewMode: 'week', setViewMode, setSelectedDay, setColumnMode },
    });

    selectViewOption('view-week');
    expect(setViewMode).not.toHaveBeenCalled();
    expect(setSelectedDay).not.toHaveBeenCalled();
    expect(setColumnMode).not.toHaveBeenCalled();
  });

  it('calls hook setViewMode("week") when Неделя button is clicked from day', () => {
    const setViewMode = vi.fn();
    renderTopbar({ view: { viewMode: 'day', setViewMode } });

    selectViewOption('view-week');
    expect(setViewMode).toHaveBeenCalledWith('week');
  });

  it('same-mode week click is a no-op (no setter calls)', () => {
    const setViewMode = vi.fn();
    renderTopbar({ view: { viewMode: 'week', setViewMode } });

    selectViewOption('view-week');
    expect(setViewMode).not.toHaveBeenCalled();
  });

  it('calls hook setColumnMode when a day option is clicked (already in day mode)', () => {
    const setColumnMode = vi.fn();
    const setViewMode = vi.fn();
    renderTopbar({
      view: { viewMode: 'day', setViewMode, setColumnMode },
    });

    selectViewOption('view-locations');
    expect(setColumnMode).toHaveBeenCalledWith('locations');
    // Already in day mode — no view switch
    expect(setViewMode).not.toHaveBeenCalled();
  });

  it('same-option day click is a no-op (no setter calls)', () => {
    const setColumnMode = vi.fn();
    const setViewMode = vi.fn();
    renderTopbar({
      view: { viewMode: 'day', columnMode: 'masters', setViewMode, setColumnMode },
    });

    selectViewOption('view-masters');
    expect(setColumnMode).not.toHaveBeenCalled();
    expect(setViewMode).not.toHaveBeenCalled();
  });

  it('day option from week mode writes column mode AND switches to day via the hook', () => {
    const setColumnMode = vi.fn();
    const setViewMode = vi.fn();
    renderTopbar({
      view: { viewMode: 'week', setViewMode, setColumnMode },
    });

    selectViewOption('view-locations');
    expect(setColumnMode).toHaveBeenCalledWith('locations');
    expect(setViewMode).toHaveBeenCalledWith('day');
  });

  // ── Tools panel toggle (stamp button in the topbar) ───────────────────

  it('renders the stamp toggle right of the zoom button (collapsed by default)', () => {
    renderTopbar();
    const stamp = screen.getByTestId('stamp-toggle');
    expect(stamp).toHaveAttribute('aria-label', 'Открыть панель инструментов');
    // Order check: the stamp toggle is the LAST control of the topbar
    const topbar = screen.getByTestId('topbar');
    const buttons = topbar.querySelectorAll('button');
    expect(buttons[buttons.length - 1]).toBe(stamp);
  });

  it('stamp toggle click opens and closes the tools panel (aria flips)', () => {
    renderTopbar();
    const stamp = screen.getByTestId('stamp-toggle');

    fireEvent.click(stamp);
    expect(stamp).toHaveAttribute('aria-label', 'Закрыть панель инструментов');

    fireEvent.click(stamp);
    expect(stamp).toHaveAttribute('aria-label', 'Открыть панель инструментов');
  });

  // ── Date Navigation ──────────────────────────────────────────────────

  it('renders date navigation in week mode with week range', () => {
    // June 8–14, 2026
    const monday = new Date(2026, 5, 8);
    renderTopbar({ view: { viewMode: 'week', currentWeek: monday } });

    expect(screen.getByTestId('date-nav')).toBeInTheDocument();
    expect(screen.getByText('8-14 июня')).toBeInTheDocument();
  });

  it('renders date navigation in day mode with single day', () => {
    // June 11, 2026
    const day = new Date(2026, 5, 11);
    renderTopbar({
      view: { viewMode: 'day', selectedDay: day, currentWeek: new Date(2026, 5, 8) },
    });

    expect(screen.getByText('11 июня')).toBeInTheDocument();
  });

  it('calls prevPeriod when left arrow is clicked', () => {
    const prevPeriod = vi.fn();
    renderTopbar({ view: { viewMode: 'week', currentWeek: new Date(2026, 5, 8), prevPeriod } });

    fireEvent.click(screen.getByTestId('date-nav-prev'));
    expect(prevPeriod).toHaveBeenCalledTimes(1);
  });

  it('calls nextPeriod when right arrow is clicked', () => {
    const nextPeriod = vi.fn();
    renderTopbar({ view: { viewMode: 'week', currentWeek: new Date(2026, 5, 8), nextPeriod } });

    fireEvent.click(screen.getByTestId('date-nav-next'));
    expect(nextPeriod).toHaveBeenCalledTimes(1);
  });

  // ── Calendar Popover ─────────────────────────────────────────────────

  it('opens calendar popover when date text is clicked', () => {
    renderTopbar({ view: { currentWeek: new Date(2026, 5, 8) } });
    // Date text shows "8-14 июня" in week mode
    const dateText = screen.getByTestId('date-nav-text');
    fireEvent.click(dateText);
    // Calendar popover should appear
    expect(screen.getByTestId('calendar-popover')).toBeInTheDocument();
  });

  it('calendar date select in DAY mode calls only setSelectedDay (no range writes)', () => {
    const setSelectedDay = vi.fn();
    const setViewMode = vi.fn();
    renderTopbar({
      view: { viewMode: 'day', selectedDay: new Date(2026, 5, 8), setSelectedDay, setViewMode },
    });

    fireEvent.click(screen.getByTestId('date-nav-text'));
    fireEvent.click(screen.getByText('15'));

    expect(setSelectedDay).toHaveBeenCalledTimes(1);
    expect(setSelectedDay.mock.calls[0][0]).toEqual(new Date(2026, 5, 15));
    expect(setViewMode).not.toHaveBeenCalled();
  });

  it('calendar date select in WEEK mode calls only setSelectedDay (hook derives the week)', () => {
    const setSelectedDay = vi.fn();
    const setViewMode = vi.fn();
    renderTopbar({
      view: { viewMode: 'week', currentWeek: new Date(2026, 5, 8), setSelectedDay, setViewMode },
    });

    fireEvent.click(screen.getByTestId('date-nav-text'));
    fireEvent.click(screen.getByText('15'));

    // June 15, 2026 — one write, ?date only; view untouched (DoD).
    expect(setSelectedDay).toHaveBeenCalledTimes(1);
    expect(setSelectedDay.mock.calls[0][0]).toEqual(new Date(2026, 5, 15));
    expect(setViewMode).not.toHaveBeenCalled();
  });

  it('closes calendar popover when a date is selected', () => {
    renderTopbar({ view: { currentWeek: new Date(2026, 5, 8) } });

    // Open the calendar
    fireEvent.click(screen.getByTestId('date-nav-text'));
    expect(screen.getByTestId('calendar-popover')).toBeInTheDocument();

    // Click on day 15 (June 15, 2026)
    fireEvent.click(screen.getByText('15'));

    // Calendar should close
    expect(screen.queryByTestId('calendar-popover')).not.toBeInTheDocument();
  });

  it('does not open calendar when prev/next arrows are clicked', () => {
    renderTopbar();
    fireEvent.click(screen.getByTestId('date-nav-prev'));
    expect(screen.queryByTestId('calendar-popover')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('date-nav-next'));
    expect(screen.queryByTestId('calendar-popover')).not.toBeInTheDocument();
  });

  // ── REAL-hook URL writes (DoD: nothing written except ?view/?date/… ) ──

  describe('URL writes (real hook + router mock)', () => {
    it('week→day switch writes ?view=day and day-anchors ?date (hook owns the anchor)', () => {
      __resetNavigation('?view=week&date=2026-06-10');
      renderTopbarReal();

      selectViewOption('view-masters');
      const q = new URLSearchParams(__currentQuery());
      expect(q.get('view')).toBe('day');
      // Viewed week is current-week-relative: 2026-06-10 belongs to a week
      // that is not the week of "today" in general — the anchor must be the
      // Monday of the VIEWED week (June 8, 2026) unless today falls inside it.
      const date = q.get('date')!;
      const viewedMonday = '2026-06-08';
      const today = new Date();
      const nowMonday = (() => {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const dow = (d.getDay() + 6) % 7; // Monday = 0
        d.setDate(d.getDate() - dow);
        return d.toISOString().slice(0, 10);
      })();
      expect([viewedMonday, nowMonday]).toContain(date);
      // masters is the default column mode — no redundant ?col write
      expect(q.get('col')).toBeNull();
    });

    it('day→week switch writes ONLY ?view=week (date untouched)', () => {
      __resetNavigation('?view=day&date=2026-06-10&col=locations');
      renderTopbarReal();

      selectViewOption('view-week');
      const q = new URLSearchParams(__currentQuery());
      expect(q.get('view')).toBe('week');
      expect(q.get('date')).toBe('2026-06-10');
      expect(q.get('col')).toBe('locations');
    });

    it('week-mode calendar select changes ONLY ?date (view untouched)', () => {
      __resetNavigation('?view=week&date=2026-06-10');
      renderTopbarReal();

      fireEvent.click(screen.getByTestId('date-nav-text'));
      fireEvent.click(screen.getByText('15')); // June 15, 2026

      const q = new URLSearchParams(__currentQuery());
      expect(q.get('date')).toBe('2026-06-15');
      expect(q.get('view')).toBe('week');
      expect(q.get('col')).toBeNull();
    });

    it('day-mode calendar select changes ONLY ?date (view untouched)', () => {
      __resetNavigation('?view=day&date=2026-06-10');
      renderTopbarReal();

      fireEvent.click(screen.getByTestId('date-nav-text'));
      fireEvent.click(screen.getByText('16')); // June 16, 2026

      const q = new URLSearchParams(__currentQuery());
      expect(q.get('date')).toBe('2026-06-16');
      expect(q.get('view')).toBe('day');
      expect(q.get('col')).toBeNull();
    });

    it('day-option click from week composes BOTH writes: view=day + date anchor + col', () => {
      __resetNavigation('?view=week&date=2026-06-10&col=masters');
      renderTopbarReal();

      selectViewOption('view-locations');

      const q = new URLSearchParams(__currentQuery());
      expect(q.get('view')).toBe('day');
      expect(q.get('col')).toBe('locations');
      // Anchor: Monday of viewed week (2026-06-08) or today if within it.
      expect(['2026-06-08']).toContain(q.get('date')!);
    });

    it('day-option click in day mode writes ONLY ?col (replace, no extra params)', () => {
      __resetNavigation('?view=day&date=2026-06-10&col=masters');
      renderTopbarReal();

      selectViewOption('view-locations');

      const q = new URLSearchParams(__currentQuery());
      expect(q.get('col')).toBe('locations');
      expect(q.get('date')).toBe('2026-06-10');
      expect(q.get('view')).toBe('day');
    });

    it('prev/next arrows write only ?date', () => {
      __resetNavigation('?view=week&date=2026-06-10');
      renderTopbarReal();

      fireEvent.click(screen.getByTestId('date-nav-next'));
      // Week view steps from the week Monday (2026-06-08) → 2026-06-15
      let q = new URLSearchParams(__currentQuery());
      expect(q.get('date')).toBe('2026-06-15');
      expect(q.get('view')).toBe('week');

      fireEvent.click(screen.getByTestId('date-nav-prev'));
      q = new URLSearchParams(__currentQuery());
      expect(q.get('date')).toBe('2026-06-08');
      expect(q.get('view')).toBe('week');
    });
  });

  // ── Working Hours in Zoom Popup ──────────────────────────────────────

  it('shows working hours inputs in zoom popup', () => {
    renderTopbar();
    // Open zoom popup
    fireEvent.click(screen.getByTestId('zoom-button'));
    // Working hours section should be visible
    expect(screen.getByLabelText('Рабочее время начало')).toBeInTheDocument();
    expect(screen.getByLabelText('Рабочее время окончание')).toBeInTheDocument();
  });

  it('shows default working hours values (9 and 21)', () => {
    renderTopbar();
    fireEvent.click(screen.getByTestId('zoom-button'));
    const startInput = screen.getByLabelText('Рабочее время начало') as HTMLInputElement;
    const endInput = screen.getByLabelText('Рабочее время окончание') as HTMLInputElement;
    expect(startInput.value).toBe('9');
    expect(endInput.value).toBe('21');
  });

  it('calls setWorkingHoursStart when start input changes', () => {
    const setWorkingHoursStart = vi.fn();
    renderTopbar({ grid: { workingHoursStart: 9, setWorkingHoursStart } });

    fireEvent.click(screen.getByTestId('zoom-button'));
    fireEvent.change(screen.getByLabelText('Рабочее время начало'), { target: { value: '7' } });
    expect(setWorkingHoursStart).toHaveBeenCalledWith(7);
  });

  it('calls setWorkingHoursEnd when end input changes', () => {
    const setWorkingHoursEnd = vi.fn();
    renderTopbar({ grid: { workingHoursEnd: 21, setWorkingHoursEnd } });

    fireEvent.click(screen.getByTestId('zoom-button'));
    fireEvent.change(screen.getByLabelText('Рабочее время окончание'), { target: { value: '23' } });
    expect(setWorkingHoursEnd).toHaveBeenCalledWith(23);
  });

  // ── Saving indicator + leave guard (GH #141 spec §5) ───────────────────
  // The visible chip moved into the toast stack (GH #261) — its asserts live
  // in __tests__/useSavingToast.test.tsx now. Only the guard stays here.

  // ── Archived-visibility toggles in filter dropdowns (GH #267) ────────

  describe('archived-visibility toggles', () => {
    it('renders «Показывать архивные» checkbox inside masters dropdown, checked per settings', async () => {
      renderTopbar();
      fireEvent.click(screen.getByLabelText('Мастера'));
      const toggle = await screen.findByTestId('show-archived-masters-toggle');
      expect(toggle).toBeInTheDocument();
      expect(toggle).toBeChecked();
    });

    it('renders «Показывать архивные» checkbox inside locations dropdown, unchecked per settings', async () => {
      renderTopbar();
      fireEvent.click(screen.getByLabelText('Локации'));
      const toggle = await screen.findByTestId('show-archived-locations-toggle');
      expect(toggle).toBeInTheDocument();
      expect(toggle).not.toBeChecked();
    });

    it('toggling masters checkbox calls updateSettings with showArchivedMasters=next (persisted via PATCH)', async () => {
      renderTopbar();
      fireEvent.click(screen.getByLabelText('Мастера'));
      const toggle = await screen.findByTestId('show-archived-masters-toggle');

      fireEvent.click(toggle);
      expect(toggle).not.toBeChecked(); // instant UI flip
      await waitFor(() =>
        expect(patchUserSettings).toHaveBeenCalledWith(
          expect.objectContaining({ show_archived_masters: false }),
        ),
      );
    });

    it('toggling locations checkbox calls updateSettings with showArchivedLocations=next (persisted via PATCH)', async () => {
      renderTopbar();
      fireEvent.click(screen.getByLabelText('Локации'));
      const toggle = await screen.findByTestId('show-archived-locations-toggle');

      fireEvent.click(toggle);
      expect(toggle).toBeChecked(); // instant UI flip
      await waitFor(() =>
        expect(patchUserSettings).toHaveBeenCalledWith(
          expect.objectContaining({ show_archived_locations: true }),
        ),
      );
    });

    it('persists the toggle to localStorage', async () => {
      renderTopbar();
      fireEvent.click(screen.getByLabelText('Локации'));
      const toggle = await screen.findByTestId('show-archived-locations-toggle');

      fireEvent.click(toggle);
      await waitFor(() => {
        const stored = JSON.parse(localStorage.getItem('memo-user-settings') || '{}');
        expect(stored.showArchivedLocations).toBe(true);
      });
    });
  });

  describe('unsaved-changes guard', () => {
    it('attaches a beforeunload listener while a save is in flight', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      const removeSpy = vi.spyOn(window, 'removeEventListener');

      vi.mocked(useMutationState).mockReturnValue([]);
      const { rerender } = renderTopbar();
      expect(addSpy).not.toHaveBeenCalledWith('beforeunload', expect.any(Function));

      vi.mocked(useMutationState).mockReturnValue([true]);
      rerender(providersElement());
      expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
      expect(removeSpy).not.toHaveBeenCalledWith('beforeunload', expect.any(Function));

      vi.mocked(useMutationState).mockReturnValue([]);
      rerender(providersElement());
      expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    });
  });
});
