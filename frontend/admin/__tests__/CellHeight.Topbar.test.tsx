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
  cellHeight: 50,
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

describe('Topbar — Cell Height Zoom Control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT render the old +/- height control', () => {
    renderWithProviders();
    expect(screen.queryByTestId('cell-height-control')).not.toBeInTheDocument();
    expect(screen.queryByText('Высота')).not.toBeInTheDocument();
  });

  it('renders the zoom icon button', () => {
    renderWithProviders();
    expect(screen.getByTestId('zoom-button')).toBeInTheDocument();
  });

  it('opens zoom popup when zoom button is clicked', () => {
    renderWithProviders();
    fireEvent.click(screen.getByTestId('zoom-button'));
    expect(screen.getByTestId('zoom-popup')).toBeInTheDocument();
  });

  it('renders 3 options in the popup', () => {
    renderWithProviders();
    fireEvent.click(screen.getByTestId('zoom-button'));
    expect(screen.getByTestId('zoom-option-40')).toBeInTheDocument();
    expect(screen.getByTestId('zoom-option-50')).toBeInTheDocument();
    expect(screen.getByTestId('zoom-option-60')).toBeInTheDocument();
  });

  it('highlights the currently active option', async () => {
    await renderWithMockContext({ cellHeight: 50 });
    fireEvent.click(screen.getByTestId('zoom-button'));
    const activeOption = screen.getByTestId('zoom-option-50');
    expect(activeOption).toHaveAttribute('data-active', 'true');
  });

  it('calls setCellHeight and closes popup when option is selected', async () => {
    const setCellHeight = vi.fn();
    await renderWithMockContext({ cellHeight: 50, setCellHeight });

    fireEvent.click(screen.getByTestId('zoom-button'));
    fireEvent.click(screen.getByTestId('zoom-option-60'));

    expect(setCellHeight).toHaveBeenCalledWith(60);
    expect(screen.queryByTestId('zoom-popup')).not.toBeInTheDocument();
  });

  it('closes popup on outside click', () => {
    renderWithProviders();
    fireEvent.click(screen.getByTestId('zoom-button'));
    expect(screen.getByTestId('zoom-popup')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('zoom-popup')).not.toBeInTheDocument();
  });

  it('displays option labels in Russian', () => {
    renderWithProviders();
    fireEvent.click(screen.getByTestId('zoom-button'));
    expect(screen.getByText('Мелкий')).toBeInTheDocument();
    expect(screen.getByText('Стандартный')).toBeInTheDocument();
    expect(screen.getByText('Крупный')).toBeInTheDocument();
  });
});
