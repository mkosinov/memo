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
});
