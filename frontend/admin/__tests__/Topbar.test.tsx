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
    filterMasterId: null,
    filterLocationId: null,
    setFilterMasterId: vi.fn(),
    setFilterLocationId: vi.fn(),
    viewMode: 'week',
    setViewMode: vi.fn(),
    selectedDay: new Date(),
    setSelectedDay: vi.fn(),
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

  it('renders week navigation buttons (← →)', () => {
    renderWithProviders();
    expect(screen.getByRole('button', { name: /Предыдущая/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Следующая/i })).toBeInTheDocument();
  });

  it('renders date range text', () => {
    renderWithProviders();
    const dateRange = screen.getByTestId('date-range');
    expect(dateRange).toBeInTheDocument();
    expect(dateRange.textContent).toMatch(/\d+/);
  });

  it('renders "Сегодня" button', () => {
    renderWithProviders();
    expect(screen.getByRole('button', { name: 'Сегодня' })).toBeInTheDocument();
  });

  it('does not render copy last week button (moved to RightPanel)', () => {
    renderWithProviders();
    expect(screen.queryByRole('button', { name: /Копировать/i })).not.toBeInTheDocument();
  });

  it('does not render delete mode toggle (moved to StampPanel)', () => {
    renderWithProviders();
    expect(screen.queryByRole('button', { name: /Режим удаления/i })).not.toBeInTheDocument();
  });

  it('renders filter selects', () => {
    renderWithProviders();
    expect(screen.getByLabelText('Фильтр по мастеру')).toBeInTheDocument();
    expect(screen.getByLabelText('Фильтр по локации')).toBeInTheDocument();
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
      filterMasterId: null,
      filterLocationId: null,
      setFilterMasterId: vi.fn(),
      setFilterLocationId: vi.fn(),
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
