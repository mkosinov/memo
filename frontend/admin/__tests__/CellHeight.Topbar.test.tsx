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
  cellHeight: 60,
  setCellHeight: vi.fn(),
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
    </QueryClientProvider>,
  );
}

async function renderWithMockContext(scheduleOverrides: Record<string, unknown>) {
  const { useSchedule: mockHook } = await import('@/contexts/ScheduleContext');
  vi.mocked(mockHook).mockReturnValue({
    ...defaultScheduleMock,
    ...scheduleOverrides,
  } as any);

  const { unmount } = renderWithProviders();
  return { unmount };
}

describe('Topbar — Cell Height Control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the cell height control with label "Высота"', () => {
    renderWithProviders();
    expect(screen.getByText('Высота')).toBeInTheDocument();
  });

  it('displays the current cell height value', () => {
    renderWithProviders();
    expect(screen.getByTestId('cell-height-value').textContent).toBe('60');
  });

  it('calls setCellHeight with 70 when + is clicked (step 10)', async () => {
    const setCellHeight = vi.fn();
    await renderWithMockContext({ cellHeight: 60, setCellHeight });

    fireEvent.click(screen.getByTestId('cell-height-increase'));
    expect(setCellHeight).toHaveBeenCalledWith(70);
  });

  it('calls setCellHeight with 50 when - is clicked (step 10)', async () => {
    const setCellHeight = vi.fn();
    await renderWithMockContext({ cellHeight: 60, setCellHeight });

    fireEvent.click(screen.getByTestId('cell-height-decrease'));
    expect(setCellHeight).toHaveBeenCalledWith(50);
  });

  it('disables - button when height is at minimum (40)', async () => {
    await renderWithMockContext({ cellHeight: 40 });
    expect(screen.getByTestId('cell-height-decrease')).toBeDisabled();
  });

  it('disables + button when height is at maximum (120)', async () => {
    await renderWithMockContext({ cellHeight: 120 });
    expect(screen.getByTestId('cell-height-increase')).toBeDisabled();
  });

  it('renders height control as the first element in Topbar', () => {
    renderWithProviders();
    const heightControl = screen.getByTestId('cell-height-control');
    expect(heightControl).toBeInTheDocument();

    // The height control should be in the leftmost position (before filters)
    const topbar = heightControl.parentElement;
    const firstChild = topbar?.firstElementChild;
    expect(firstChild).toBe(heightControl);
  });
});
