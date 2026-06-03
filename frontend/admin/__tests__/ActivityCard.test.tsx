import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ActivityCard } from '../app/components/schedule/ActivityCard';
import type { Activity, Artist } from '@memo/domain';

const mockArtist: Artist = {
  id: 'art_1',
  name: 'Ольга Петрова',
  shortName: 'Ольга',
  color: '#5B8C7A',
};

const mockActivity: Activity = {
  id: 'ev_1',
  day: 0,
  masterId: 'art_1',
  startTime: 10,
  duration: 2,
  serviceId: 'svc_1',
  serviceName: 'Картина маслом',
  minAge: '6+',
  locationId: 'loc_1',
  occupied: 3,
  capacity: 8,
  isPrivate: false,
};

describe('ActivityCard', () => {
  it('renders service name', () => {
    render(<ActivityCard activity={mockActivity} artist={mockArtist} />);
    expect(screen.getByText('Картина маслом')).toBeInTheDocument();
  });

  it('shows time pill with time range', () => {
    render(<ActivityCard activity={mockActivity} artist={mockArtist} />);
    expect(screen.getByText(/10:00/)).toBeInTheDocument();
    expect(screen.getByText(/12:00/)).toBeInTheDocument();
  });

  it('shows occupancy ratio', () => {
    render(<ActivityCard activity={mockActivity} artist={mockArtist} />);
    expect(screen.getByText('3/8')).toBeInTheDocument();
  });

  it('hides content when card is very small (short duration)', () => {
    const shortActivity = { ...mockActivity, duration: 0.25 };
    render(<ActivityCard activity={shortActivity} artist={mockArtist} />);
    // Time pill should still show
    expect(screen.getByText(/10:00/)).toBeInTheDocument();
    // Service name should NOT be visible
    expect(screen.queryByText('Картина маслом')).not.toBeInTheDocument();
  });

  it('does not crash when capacity is 0', () => {
    const zeroCapActivity = { ...mockActivity, capacity: 0, occupied: 0 };
    expect(() => {
      render(<ActivityCard activity={zeroCapActivity} artist={mockArtist} />);
    }).not.toThrow();
  });

  it('shows "0/0" occupancy when capacity is 0', () => {
    const zeroCapActivity = { ...mockActivity, capacity: 0, occupied: 0 };
    render(<ActivityCard activity={zeroCapActivity} artist={mockArtist} />);
    expect(screen.getByText('0/0')).toBeInTheDocument();
  });

  it('clamps occupancy ratio when occupied exceeds capacity', () => {
    const overbooked = { ...mockActivity, occupied: 10, capacity: 5 };
    expect(() => {
      render(<ActivityCard activity={overbooked} artist={mockArtist} />);
    }).not.toThrow();
    expect(screen.getByText('10/5')).toBeInTheDocument();
  });

  it('renders diamond icon when isPrivate is true', () => {
    const privateActivity = { ...mockActivity, isPrivate: true };
    const { container } = render(<ActivityCard activity={privateActivity} artist={mockArtist} />);
    
    // Check that the gem paths exist in the card
    expect(container.querySelector('path[d="M12 2L2 9l10 13 10-13L12 2z"]')).toBeInTheDocument();
    expect(container.querySelector('path[d="M2 9h20"]')).toBeInTheDocument();
    expect(container.querySelector('path[d="M12 2v20"]')).toBeInTheDocument();
    expect(container.querySelector('path[d="M7 9l5 13 5-13"]')).toBeInTheDocument();
  });

  it('does not have diamond icon when isPrivate is false', () => {
    const { container } = render(
      <ActivityCard activity={mockActivity} artist={mockArtist} />
    );
    const paths = container.querySelectorAll('svg path[d="M12 2l10 10-10 10L2 12z"]');
    expect(paths.length).toBe(0);
  });

  it('shows age and location when height >= 90px', () => {
    const tallActivity = { ...mockActivity, duration: 2 };
    const mockStudios = [{ id: 'loc_1', name: 'Студия А' }];
    render(<ActivityCard activity={tallActivity} artist={mockArtist} studios={mockStudios} />);
    expect(screen.getByText('6+')).toBeInTheDocument();
    expect(screen.getByText('Студия А')).toBeInTheDocument();
  });

  it('hides age and location when height < 90px', () => {
    // duration=0.6 → height = 0.6*120-10 = 62px (56 <= h < 90, !showExtra)
    const mediumActivity = { ...mockActivity, duration: 0.6 };
    render(<ActivityCard activity={mediumActivity} artist={mockArtist} />);
    expect(screen.queryByText('6+')).not.toBeInTheDocument();
    // Service name IS still visible
    expect(screen.getByText('Картина маслом')).toBeInTheDocument();
    // Occupancy IS still visible
    expect(screen.getByText('3/8')).toBeInTheDocument();
  });

  it('has data-testid attribute', () => {
    const { container } = render(
      <ActivityCard activity={mockActivity} artist={mockArtist} />
    );
    const card = container.querySelector('[data-testid="activity-ev_1"]');
    expect(card).toBeInTheDocument();
  });

  it('enforces minimum height of 52px when duration is 0', () => {
    const zeroDuration = { ...mockActivity, duration: 0 };
    const { container } = render(
      <ActivityCard activity={zeroDuration} artist={mockArtist} />
    );
    const card = container.querySelector('[data-testid]');
    expect(card).toHaveStyle({ height: '52px' });
  });

  it('shows full occupancy display when occupied equals capacity', () => {
    const fullActivity = { ...mockActivity, occupied: 8, capacity: 8 };
    render(<ActivityCard activity={fullActivity} artist={mockArtist} />);
    expect(screen.getByText('8/8')).toBeInTheDocument();
  });

  it('renders progress bar with width proportional to occupancy', () => {
    const { container } = render(<ActivityCard activity={mockActivity} artist={mockArtist} />);
    const filledBar = container.querySelector('[data-testid="activity-ev_1"] [style*="width:"][class*="absolute"]');
    expect(filledBar).toBeInTheDocument();
    // mockActivity: occupied=3, capacity=8 → fillPct=0.375 → width=37.5%
    expect(filledBar).toHaveStyle({ width: '37.5%' });
  });

  it('renders full width progress bar when fully occupied', () => {
    const fullActivity = { ...mockActivity, occupied: 8, capacity: 8 };
    const { container } = render(<ActivityCard activity={fullActivity} artist={mockArtist} />);
    const filledBar = container.querySelector('[data-testid="activity-ev_1"] [style*="width:"][class*="absolute"]');
    expect(filledBar).toHaveStyle({ width: '100%' });
  });

  it('renders zero width progress bar when empty', () => {
    const emptyActivity = { ...mockActivity, occupied: 0, capacity: 8 };
    const { container } = render(<ActivityCard activity={emptyActivity} artist={mockArtist} />);
    const filledBar = container.querySelector('[data-testid="activity-ev_1"] [style*="width:"][class*="absolute"]');
    expect(filledBar).toHaveStyle({ width: '0%' });
  });
});

// ─── Delete Mode Tests ────────────────────────────────────────────────────

vi.mock('@/contexts/UIContext', () => ({
  useUI: vi.fn(),
}));

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: vi.fn(),
}));

import { useUI } from '@/contexts/UIContext';
import { useSchedule } from '@/contexts/ScheduleContext';

const mockUseUI = vi.mocked(useUI);
const mockUseSchedule = vi.mocked(useSchedule);

beforeEach(() => {
  vi.useFakeTimers();
  mockUseUI.mockReturnValue({
    deleteMode: false,
    toggleDeleteMode: vi.fn(),
    toasts: [],
    showToast: vi.fn(),
    hideToast: vi.fn(),
    sidebarCollapsed: false,
    toggleSidebar: vi.fn(),
    rightPanelCollapsed: false,
    toggleRightPanel: vi.fn(),
    theme: 'light',
    toggleTheme: vi.fn(),
  });
  mockUseSchedule.mockReturnValue({
    activities: [],
    scheduleIndex: { byId: new Map(), byDate: new Map(), byMasterId: new Map(), byLocation: { all: { byDate: new Map(), byServiceId: new Map() } } },
    artists: [],
    services: [],
    locations: [],
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
    filterMasterId: null,
    filterLocationId: null,
    setFilterMasterId: vi.fn(),
    setFilterLocationId: vi.fn(),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ActivityCard delete mode', () => {
  it('does not trigger delete when deleteMode is false', () => {
    const deleteActivity = vi.fn();
    mockUseSchedule.mockReturnValue({
      ...mockUseSchedule(),
      deleteActivity,
    } as ReturnType<typeof useSchedule>);

    render(<ActivityCard activity={mockActivity} artist={mockArtist} />);
    const card = screen.getByTestId('activity-ev_1');
    fireEvent.click(card);

    expect(deleteActivity).not.toHaveBeenCalled();
  });

  it('triggers delete with fade-out animation when deleteMode is true', () => {
    const deleteActivity = vi.fn();
    const showToast = vi.fn();
    mockUseUI.mockReturnValue({
      ...mockUseUI(),
      deleteMode: true,
      showToast,
    } as ReturnType<typeof useUI>);
    mockUseSchedule.mockReturnValue({
      ...mockUseSchedule(),
      deleteActivity,
    } as ReturnType<typeof useSchedule>);

    const { container } = render(<ActivityCard activity={mockActivity} artist={mockArtist} />);
    const card = screen.getByTestId('activity-ev_1');

    // Before click: card is visible
    expect(card).not.toHaveClass('opacity-0');

    // Click to delete
    fireEvent.click(card);

    // After click: card has fade-out classes
    expect(card).toHaveClass('opacity-0');
    expect(card).toHaveClass('scale-95');

    // deleteActivity not called yet (waiting for animation)
    expect(deleteActivity).not.toHaveBeenCalled();

    // Advance timer past animation duration (150ms)
    vi.advanceTimersByTime(160);

    // Now deleteActivity should be called
    expect(deleteActivity).toHaveBeenCalledWith('ev_1');

    // Toast shown with undo
    expect(showToast).toHaveBeenCalled();
    const toastCall = showToast.mock.calls[0];
    expect(toastCall[0]).toContain('удалено');
    expect(typeof toastCall[0]).toBe('string');
  });
});
