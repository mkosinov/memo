import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Topbar } from '../app/components/layout/Topbar';
import { NavigationProvider } from '../contexts/NavigationContext';
import { UIProvider } from '../contexts/UIContext';

vi.mock('@memo/api-client', () => ({
  getMasters: vi.fn().mockResolvedValue([]),
  getLocations: vi.fn().mockResolvedValue([]),
  getServices: vi.fn().mockResolvedValue([]),
  getActivities: vi.fn().mockResolvedValue([]),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  deleteActivity: vi.fn(),
}));

const defaultScheduleMock = {
  masters: [],
  locations: [],
  filterMasterIds: [],
  filterLocationIds: [],
  setFilterMasterIds: vi.fn(),
  setFilterLocationIds: vi.fn(),
  viewMode: 'week',
  setViewMode: vi.fn(),
  selectedDay: new Date(),
  setSelectedDay: vi.fn(),
  currentWeek: new Date(),
  columnMode: 'masters',
  setColumnMode: vi.fn(),
  prevPeriod: vi.fn(),
  nextPeriod: vi.fn(),
};

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: vi.fn(() => defaultScheduleMock),
}));

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <UIProvider>
        <NavigationProvider>
          <Topbar />
        </NavigationProvider>
      </UIProvider>
    </QueryClientProvider>
  );
}

describe('Topbar', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    vi.clearAllMocks();
  });

  it('does not render week navigation buttons (moved to sidebar)', () => {
    renderWithProviders();
    expect(screen.queryByRole('button', { name: /Предыдущая/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Следующая/i })).not.toBeInTheDocument();
  });

  it('does not render date range text (week nav removed)', () => {
    renderWithProviders();
    expect(screen.queryByTestId('date-range')).not.toBeInTheDocument();
  });

  it('does not render "Сегодня" button (moved to sidebar)', () => {
    renderWithProviders();
    expect(screen.queryByRole('button', { name: 'Сегодня' })).not.toBeInTheDocument();
  });

  it('does not render copy last week button (moved to RightPanel)', () => {
    renderWithProviders();
    expect(screen.queryByRole('button', { name: /Копировать/i })).not.toBeInTheDocument();
  });

  it('does not render delete mode toggle (moved to StampPanel)', () => {
    renderWithProviders();
    expect(screen.queryByRole('button', { name: /Режим удаления/i })).not.toBeInTheDocument();
  });

  it('renders separate Masters and Locations filter buttons', () => {
    renderWithProviders();
    expect(screen.getByLabelText('Мастера')).toBeInTheDocument();
    expect(screen.getByLabelText('Локации')).toBeInTheDocument();
  });

  it('does NOT render the old combined filter button', () => {
    renderWithProviders();
    expect(screen.queryByLabelText('Фильтры')).not.toBeInTheDocument();
  });

  it('renders combined Day button with column mode text', () => {
    renderWithProviders();
    // Should show "День по мастерам" instead of just "День"
    expect(screen.getByText('День по мастерам')).toBeInTheDocument();
    expect(screen.getByText('Неделя')).toBeInTheDocument();
  });

  it('shows "День по локациям" when columnMode is locations', async () => {
    const { useSchedule: mockHook } = await import('@/contexts/ScheduleContext');
    vi.mocked(mockHook).mockReturnValue({
      ...defaultScheduleMock,
      columnMode: 'locations',
    } as any);

    const { unmount } = renderWithProviders();
    unmount();

    const { Topbar: TopbarRe } = await import('../app/components/layout/Topbar');
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <UIProvider>
          <NavigationProvider>
            <TopbarRe />
          </NavigationProvider>
        </UIProvider>
      </QueryClientProvider>
    );

    expect(screen.getByText('День по локациям')).toBeInTheDocument();
  });

  it('calls setViewMode("day") when Day button is clicked', async () => {
    const setViewMode = vi.fn();
    const { useSchedule: mockHook } = await import('@/contexts/ScheduleContext');
    vi.mocked(mockHook).mockReturnValue({
      ...defaultScheduleMock,
      viewMode: 'week',
      setViewMode,
    } as any);

    const { unmount } = renderWithProviders();
    unmount();

    const { Topbar: TopbarRe } = await import('../app/components/layout/Topbar');
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <UIProvider>
          <NavigationProvider>
            <TopbarRe />
          </NavigationProvider>
        </UIProvider>
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByText('День по мастерам'));
    expect(setViewMode).toHaveBeenCalledWith('day');
  });

  it('opens dropdown menu when dropdown arrow is clicked', () => {
    renderWithProviders();
    // The dropdown arrow is a chevron SVG button — find it by role
    const dropdownButton = screen.getByRole('button', { name: /открыть меню/i });
    fireEvent.click(dropdownButton);
    // After opening, both options should be visible
    expect(screen.getByRole('menuitem', { name: /по мастерам/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /по локациям/i })).toBeInTheDocument();
  });

  it('calls setColumnMode when dropdown option is selected', async () => {
    const setColumnMode = vi.fn();
    const { useSchedule: mockHook } = await import('@/contexts/ScheduleContext');
    vi.mocked(mockHook).mockReturnValue({
      ...defaultScheduleMock,
      columnMode: 'masters',
      setColumnMode,
    } as any);

    const { unmount } = renderWithProviders();
    unmount();

    const { Topbar: TopbarRe } = await import('../app/components/layout/Topbar');
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <UIProvider>
          <NavigationProvider>
            <TopbarRe />
          </NavigationProvider>
        </UIProvider>
      </QueryClientProvider>
    );

    // Open dropdown
    fireEvent.click(screen.getByRole('button', { name: /открыть меню/i }));
    // Click the locations option
    fireEvent.click(screen.getByRole('menuitem', { name: /по локациям/i }));
    expect(setColumnMode).toHaveBeenCalledWith('locations');
  });

  it('closes dropdown after selecting an option', async () => {
    const setColumnMode = vi.fn();
    const { useSchedule: mockHook } = await import('@/contexts/ScheduleContext');
    vi.mocked(mockHook).mockReturnValue({
      ...defaultScheduleMock,
      columnMode: 'masters',
      setColumnMode,
    } as any);

    const { unmount } = renderWithProviders();
    unmount();

    const { Topbar: TopbarRe } = await import('../app/components/layout/Topbar');
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <UIProvider>
          <NavigationProvider>
            <TopbarRe />
          </NavigationProvider>
        </UIProvider>
      </QueryClientProvider>
    );

    // Open dropdown
    fireEvent.click(screen.getByRole('button', { name: /открыть меню/i }));
    expect(screen.getByRole('menuitem', { name: /по локациям/i })).toBeInTheDocument();

    // Select an option
    fireEvent.click(screen.getByRole('menuitem', { name: /по локациям/i }));

    // Dropdown should close
    expect(screen.queryByRole('menuitem', { name: /по мастерам/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /по локациям/i })).not.toBeInTheDocument();
  });

  it('highlights active column mode in dropdown', async () => {
    const { useSchedule: mockHook } = await import('@/contexts/ScheduleContext');
    vi.mocked(mockHook).mockReturnValue({
      ...defaultScheduleMock,
      columnMode: 'locations',
    } as any);

    const { unmount } = renderWithProviders();
    unmount();

    const { Topbar: TopbarRe } = await import('../app/components/layout/Topbar');
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <UIProvider>
          <NavigationProvider>
            <TopbarRe />
          </NavigationProvider>
        </UIProvider>
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /открыть меню/i }));
    const locationsItem = screen.getByRole('menuitem', { name: /по локациям/i });
    expect(locationsItem).toHaveAttribute('data-active', 'true');
  });

  // ── Date Navigation ──────────────────────────────────────────────────

  it('renders date navigation in week mode with week range', async () => {
    // June 8–14, 2026
    const monday = new Date(2026, 5, 8);
    const { useSchedule: mockHook } = await import('@/contexts/ScheduleContext');
    vi.mocked(mockHook).mockReturnValue({
      ...defaultScheduleMock,
      viewMode: 'week',
      currentWeek: monday,
    } as any);

    const { unmount } = renderWithProviders();
    unmount();

    const { Topbar: TopbarRe } = await import('../app/components/layout/Topbar');
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <UIProvider>
          <NavigationProvider>
            <TopbarRe />
          </NavigationProvider>
        </UIProvider>
      </QueryClientProvider>
    );

    expect(screen.getByTestId('date-nav')).toBeInTheDocument();
    expect(screen.getByText('8-14 июня')).toBeInTheDocument();
  });

  it('renders date navigation in day mode with single day', async () => {
    // June 11, 2026
    const day = new Date(2026, 5, 11);
    const { useSchedule: mockHook } = await import('@/contexts/ScheduleContext');
    vi.mocked(mockHook).mockReturnValue({
      ...defaultScheduleMock,
      viewMode: 'day',
      selectedDay: day,
      currentWeek: new Date(2026, 5, 8),
    } as any);

    const { unmount } = renderWithProviders();
    unmount();

    const { Topbar: TopbarRe } = await import('../app/components/layout/Topbar');
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <UIProvider>
          <NavigationProvider>
            <TopbarRe />
          </NavigationProvider>
        </UIProvider>
      </QueryClientProvider>
    );

    expect(screen.getByText('11 июня')).toBeInTheDocument();
  });

  it('calls prevPeriod when left arrow is clicked', async () => {
    const prevPeriod = vi.fn();
    const { useSchedule: mockHook } = await import('@/contexts/ScheduleContext');
    vi.mocked(mockHook).mockReturnValue({
      ...defaultScheduleMock,
      viewMode: 'week',
      currentWeek: new Date(2026, 5, 8),
      prevPeriod,
    } as any);

    const { unmount } = renderWithProviders();
    unmount();

    const { Topbar: TopbarRe } = await import('../app/components/layout/Topbar');
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <UIProvider>
          <NavigationProvider>
            <TopbarRe />
          </NavigationProvider>
        </UIProvider>
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByTestId('date-nav-prev'));
    expect(prevPeriod).toHaveBeenCalledTimes(1);
  });

  it('calls nextPeriod when right arrow is clicked', async () => {
    const nextPeriod = vi.fn();
    const { useSchedule: mockHook } = await import('@/contexts/ScheduleContext');
    vi.mocked(mockHook).mockReturnValue({
      ...defaultScheduleMock,
      viewMode: 'week',
      currentWeek: new Date(2026, 5, 8),
      nextPeriod,
    } as any);

    const { unmount } = renderWithProviders();
    unmount();

    const { Topbar: TopbarRe } = await import('../app/components/layout/Topbar');
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <UIProvider>
          <NavigationProvider>
            <TopbarRe />
          </NavigationProvider>
        </UIProvider>
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByTestId('date-nav-next'));
    expect(nextPeriod).toHaveBeenCalledTimes(1);
  });

  it('shows date navigation before cell height control', async () => {
    renderWithProviders();
    const dateNav = screen.getByTestId('date-nav');
    const cellHeightControl = screen.getByTestId('cell-height-control');
    // date-nav should come before cell-height-control in DOM order
    expect(dateNav.compareDocumentPosition(cellHeightControl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // ── Calendar Popover ─────────────────────────────────────────────────

  it('opens calendar popover when date text is clicked', async () => {
    renderWithProviders();
    // Date text shows "8-14 июня" in week mode
    const dateText = screen.getByTestId('date-nav-text');
    fireEvent.click(dateText);
    // Calendar popover should appear
    expect(screen.getByTestId('calendar-popover')).toBeInTheDocument();
  });

  it('closes calendar popover when a date is selected', async () => {
    renderWithProviders();

    // Open the calendar
    fireEvent.click(screen.getByTestId('date-nav-text'));
    expect(screen.getByTestId('calendar-popover')).toBeInTheDocument();

    // Click on day 15 (June 15, 2026)
    fireEvent.click(screen.getByText('15'));

    // Calendar should close
    expect(screen.queryByTestId('calendar-popover')).not.toBeInTheDocument();
  });

  it('does not open calendar when prev/next arrows are clicked', async () => {
    renderWithProviders();
    fireEvent.click(screen.getByTestId('date-nav-prev'));
    expect(screen.queryByTestId('calendar-popover')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('date-nav-next'));
    expect(screen.queryByTestId('calendar-popover')).not.toBeInTheDocument();
  });
});
