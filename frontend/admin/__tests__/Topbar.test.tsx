import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider, useMutationState } from '@tanstack/react-query';
import { Topbar } from '../app/components/layout/Topbar';
import { NavigationProvider } from '../contexts/NavigationContext';
import { UIProvider } from '../contexts/UIContext';
import {
  createMockScheduleData,
  createMockScheduleView,
  createMockGridSettings,
} from './helpers/mockContexts';
import type { ScheduleDataContextType } from '@/contexts/schedule/ScheduleDataContext';
import type { ScheduleViewContextType } from '@/contexts/schedule/ScheduleViewContext';
import type { GridSettingsContextType } from '@/contexts/schedule/GridSettingsContext';

vi.mock('@memo/api-client', () => {
  const wrap = (items: any[]) => ({ items, total: items.length, page: 1, per_page: 100 });
  return ({
  getMasters: vi.fn().mockResolvedValue(wrap([])),
  getLocations: vi.fn().mockResolvedValue(wrap([])),
  getServices: vi.fn().mockResolvedValue(wrap([])),
  getActivities: vi.fn().mockResolvedValue(wrap([])),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  deleteActivity: vi.fn(),
  });
});

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

vi.mock('@/contexts/schedule/ScheduleViewContext', () => ({
  useScheduleView: vi.fn(() => createMockScheduleView()),
}));

vi.mock('@/contexts/schedule/GridSettingsContext', () => ({
  useGridSettings: vi.fn(() => createMockGridSettings()),
}));

import { useScheduleData, SCHEDULE_ACTIVITY_MUTATION_KEY } from '@/contexts/schedule/ScheduleDataContext';
import { useScheduleView } from '@/contexts/schedule/ScheduleViewContext';
import { useGridSettings } from '@/contexts/schedule/GridSettingsContext';

// ─── Render helper ────────────────────────────────────────────────────────

interface TopbarMockOverrides {
  data?: Partial<ScheduleDataContextType>;
  view?: Partial<ScheduleViewContextType>;
  grid?: Partial<GridSettingsContextType>;
}

// Module-scoped so `rerender(providersElement())` reuses the SAME client
// (needed by the saving-indicator tests that flip useMutationState between renders).
let queryClient: QueryClient;

function providersElement() {
  return (
    <QueryClientProvider client={queryClient}>
      <UIProvider>
        <NavigationProvider>
          <Topbar />
        </NavigationProvider>
      </UIProvider>
    </QueryClientProvider>
  );
}

function renderTopbar(overrides: TopbarMockOverrides = {}) {
  vi.mocked(useScheduleData).mockReturnValue(createMockScheduleData(overrides.data));
  vi.mocked(useScheduleView).mockReturnValue(createMockScheduleView(overrides.view));
  vi.mocked(useGridSettings).mockReturnValue(createMockGridSettings(overrides.grid));
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(providersElement());
}

describe('Topbar', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    vi.clearAllMocks();
    vi.mocked(useMutationState).mockReturnValue([]);
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

  it('renders combined Day button with column mode text', () => {
    renderTopbar();
    // Should show "День по мастерам" instead of just "День"
    expect(screen.getByText('День по мастерам')).toBeInTheDocument();
    expect(screen.getByText('Неделя')).toBeInTheDocument();
  });

  it('shows "День по локациям" when columnMode is locations', () => {
    renderTopbar({ view: { columnMode: 'locations' } });
    expect(screen.getByText('День по локациям')).toBeInTheDocument();
  });

  it('calls setViewMode("day") when Day button is clicked', () => {
    const setViewMode = vi.fn();
    renderTopbar({ view: { viewMode: 'week', setViewMode } });

    fireEvent.click(screen.getByText('День по мастерам'));
    expect(setViewMode).toHaveBeenCalledWith('day');
  });

  it('opens dropdown menu when day button is clicked', () => {
    renderTopbar();
    // Click the day button (which now contains the dropdown arrow)
    const dayButton = screen.getByTestId('day-button');
    fireEvent.click(dayButton);
    // After opening, both options should be visible
    expect(screen.getByRole('menuitem', { name: /по мастерам/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /по локациям/i })).toBeInTheDocument();
  });

  it('calls setColumnMode when dropdown option is selected', () => {
    const setColumnMode = vi.fn();
    renderTopbar({ view: { columnMode: 'masters', setColumnMode } });

    // Open dropdown
    fireEvent.click(screen.getByTestId('day-button'));
    // Click the locations option
    fireEvent.click(screen.getByRole('menuitem', { name: /по локациям/i }));
    expect(setColumnMode).toHaveBeenCalledWith('locations');
  });

  it('closes dropdown after selecting an option', () => {
    const setColumnMode = vi.fn();
    renderTopbar({ view: { columnMode: 'masters', setColumnMode } });

    // Open dropdown
    fireEvent.click(screen.getByTestId('day-button'));
    expect(screen.getByRole('menuitem', { name: /по локациям/i })).toBeInTheDocument();

    // Select an option
    fireEvent.click(screen.getByRole('menuitem', { name: /по локациям/i }));

    // Dropdown should close
    expect(screen.queryByRole('menuitem', { name: /по мастерам/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /по локациям/i })).not.toBeInTheDocument();
  });

  it('highlights active column mode in dropdown', () => {
    renderTopbar({ view: { columnMode: 'locations' } });

    fireEvent.click(screen.getByTestId('day-button'));
    const locationsItem = screen.getByRole('menuitem', { name: /по локациям/i });
    expect(locationsItem).toHaveAttribute('data-active', 'true');
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

  describe('saving indicator', () => {
    it('renders the "Сохраняем…" status chip while a schedule mutation is in flight', () => {
      vi.mocked(useMutationState).mockReturnValue([true]);
      renderTopbar();

      const chip = screen.getByRole('status');
      expect(chip).toBeInTheDocument();
      expect(chip).toHaveAttribute('aria-live', 'polite');
      expect(chip).toHaveTextContent('Сохраняем');
    });

    it('hides the status chip when no schedule mutation is pending', () => {
      vi.mocked(useMutationState).mockReturnValue([]);
      renderTopbar();

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('subscribes to the schedule-activity mutation key only', () => {
      vi.mocked(useMutationState).mockReturnValue([]);
      renderTopbar();

      const options = vi.mocked(useMutationState).mock.calls[0]?.[0] as {
        filters?: { mutationKey?: readonly string[] };
      };
      expect(options?.filters?.mutationKey).toEqual(SCHEDULE_ACTIVITY_MUTATION_KEY);
    });

    it('shows the chip when the save starts mid-flight (rerender)', () => {
      vi.mocked(useMutationState).mockReturnValue([]);
      const { rerender } = renderTopbar();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();

      vi.mocked(useMutationState).mockReturnValue([true]);
      rerender(providersElement());
      expect(screen.getByRole('status')).toHaveTextContent('Сохраняем');
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
