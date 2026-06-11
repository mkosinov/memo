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

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: vi.fn(() => ({
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
  })),
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

  it('renders combined filter button', () => {
    renderWithProviders();
    expect(screen.getByLabelText('Фильтры')).toBeInTheDocument();
  });

  it('renders view toggle buttons (День and Неделя)', () => {
    renderWithProviders();
    expect(screen.getByText('День')).toBeInTheDocument();
    expect(screen.getByText('Неделя')).toBeInTheDocument();
  });

  it('calls setViewMode when day button is clicked', async () => {
    const setViewMode = vi.fn();
    const { useSchedule: mockHook } = await import('@/contexts/ScheduleContext');
    vi.mocked(mockHook).mockReturnValue({
      masters: [],
      locations: [],
      filterMasterIds: [],
      filterLocationIds: [],
      setFilterMasterIds: vi.fn(),
      setFilterLocationIds: vi.fn(),
      viewMode: 'week',
      setViewMode,
      selectedDay: new Date(),
      setSelectedDay: vi.fn(),
      showAllColumns: false,
      setShowAllColumns: vi.fn(),
      activities: [],
      scheduleIndex: { byId: new Map(), byDate: new Map(), byMasterId: new Map(), byLocation: { all: { byDate: new Map(), byServiceId: new Map() } } },
      services: [],
      currentWeek: new Date(),
      stamp: { masterId: null, serviceId: null, locations: new Set(), ready: false },
      setCurrentWeek: vi.fn(),
      addActivity: vi.fn(),
      updateActivity: vi.fn(),
      deleteActivity: vi.fn(),
      setStamp: vi.fn(),
      copyLastWeek: vi.fn(),
      loading: false,
      error: null,
    } as any);

    // Need to re-render with updated mock
    const { unmount } = renderWithProviders();
    unmount();

    // Re-import to pick up the mock
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

    fireEvent.click(screen.getByText('День'));
    expect(setViewMode).toHaveBeenCalledWith('day');
  });
});
