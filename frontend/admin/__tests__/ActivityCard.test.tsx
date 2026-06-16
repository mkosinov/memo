import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ActivityCard } from '../app/components/schedule/ActivityCard';
import type { Activity, Master, Location } from '@memo/domain';
import { createMockUIContext, createMockScheduleContext } from './helpers/mockContexts';

const mockMaster: Master = {
  id: 'art_1',
  name: 'Ольга Петрова',
  shortName: 'Ольга',
  color: '#5B8C7A',
};

const mockLocation: Location = {
  id: 'loc_1',
  name: 'Гранд Отель Поляна',
  shortTitle: 'Гранд',
};

const mockActivity: Activity = {
  id: 'ev_1',
  day: 0,
  masterId: 'art_1',
  startTime: 10,
  duration: 2,
  serviceId: 'svc_1',
  serviceName: 'Картина маслом',
  minAge: '6',
  locationId: 'loc_1',
  occupied: 3,
  capacity: 8,
  isPrivate: false,
};

describe('ActivityCard', () => {
  it('renders service name', () => {
    render(<ActivityCard activity={mockActivity} master={mockMaster} />);
    expect(screen.getByText('Картина маслом')).toBeInTheDocument();
  });

  it('shows time pill with time range', () => {
    render(<ActivityCard activity={mockActivity} master={mockMaster} />);
    expect(screen.getByText(/10:00/)).toBeInTheDocument();
    expect(screen.getByText(/12:00/)).toBeInTheDocument();
  });

  it('shows occupancy ratio', () => {
    render(<ActivityCard activity={mockActivity} master={mockMaster} />);
    expect(screen.getByText('3/8')).toBeInTheDocument();
  });

  it('tiny mode (< 60 min) shows only header + title', () => {
    const shortActivity = { ...mockActivity, duration: 0.25 }; // 15 min
    render(
      <ActivityCard
        activity={shortActivity}
        master={mockMaster}
        locations={[mockLocation]}
      />
    );
    // Time pill should still show
    expect(screen.getByText(/10:00/)).toBeInTheDocument();
    // Title visible (truncate)
    expect(screen.getByText('Картина маслом')).toBeInTheDocument();
    // Master, location, footer hidden
    expect(screen.queryByText('Ольга Петрова')).not.toBeInTheDocument();
    expect(screen.queryByTestId('compact-capacity')).not.toBeInTheDocument();
    expect(screen.queryByTestId('btn-quick-add')).not.toBeInTheDocument();
  });

  it('does not crash when capacity is 0', () => {
    const zeroCapActivity = { ...mockActivity, capacity: 0, occupied: 0 };
    expect(() => {
      render(<ActivityCard activity={zeroCapActivity} master={mockMaster} />);
    }).not.toThrow();
  });

  it('shows "0/0" occupancy when capacity is 0', () => {
    const zeroCapActivity = { ...mockActivity, capacity: 0, occupied: 0 };
    render(<ActivityCard activity={zeroCapActivity} master={mockMaster} />);
    expect(screen.getByText('0/0')).toBeInTheDocument();
  });

  it('clamps occupancy ratio when occupied exceeds capacity', () => {
    const overbooked = { ...mockActivity, occupied: 10, capacity: 5 };
    expect(() => {
      render(<ActivityCard activity={overbooked} master={mockMaster} />);
    }).not.toThrow();
    expect(screen.getByText('10/5')).toBeInTheDocument();
  });

  it('renders diamond icon when isPrivate is true', () => {
    const privateActivity = { ...mockActivity, isPrivate: true };
    const { container } = render(<ActivityCard activity={privateActivity} master={mockMaster} />);
    
    // Check that the gem paths exist in the card
    expect(container.querySelector('path[d="M12 2L2 9l10 13 10-13L12 2z"]')).toBeInTheDocument();
    expect(container.querySelector('path[d="M2 9h20"]')).toBeInTheDocument();
    expect(container.querySelector('path[d="M12 2v20"]')).toBeInTheDocument();
    expect(container.querySelector('path[d="M7 9l5 13 5-13"]')).toBeInTheDocument();
  });

  it('does not have diamond icon when isPrivate is false', () => {
    const { container } = render(
      <ActivityCard activity={mockActivity} master={mockMaster} />
    );
    const paths = container.querySelectorAll('svg path[d="M12 2l10 10-10 10L2 12z"]');
    expect(paths.length).toBe(0);
  });

  it('shows location when height >= 90px (Standard mode)', () => {
    const tallActivity = { ...mockActivity, duration: 2 };
    render(<ActivityCard activity={tallActivity} master={mockMaster} locations={[mockLocation]} />);
    expect(screen.getByText('Гранд')).toBeInTheDocument();
  });

  it('hides master, location, footer when duration < 60 min (Tiny)', () => {
    // duration=0.7 → 42 min → Tiny mode
    const mediumActivity = { ...mockActivity, duration: 0.7 };
    render(<ActivityCard activity={mediumActivity} master={mockMaster} locations={[mockLocation]} />);
    // Title IS still visible
    expect(screen.getByText('Картина маслом')).toBeInTheDocument();
    // Master, location, footer hidden
    expect(screen.queryByText('Ольга Петрова')).not.toBeInTheDocument();
    expect(screen.queryByTestId('compact-capacity')).not.toBeInTheDocument();
    expect(screen.queryByTestId('btn-quick-add')).not.toBeInTheDocument();
  });

  it('has data-testid attribute', () => {
    const { container } = render(
      <ActivityCard activity={mockActivity} master={mockMaster} />
    );
    const card = container.querySelector('[data-testid="activity-ev_1"]');
    expect(card).toBeInTheDocument();
  });

  it('enforces minimum height of 60px when duration is 0', () => {
    const zeroDuration = { ...mockActivity, duration: 0 };
    const { container } = render(
      <ActivityCard activity={zeroDuration} master={mockMaster} />
    );
    const card = container.querySelector('[data-testid]');
    expect(card).toHaveStyle({ height: '60px' });
  });

  it('shows full occupancy display when occupied equals capacity', () => {
    const fullActivity = { ...mockActivity, occupied: 8, capacity: 8 };
    render(<ActivityCard activity={fullActivity} master={mockMaster} />);
    expect(screen.getByText('8/8')).toBeInTheDocument();
  });

  it('calls onQuickAdd when quick action button is clicked', () => {
    const onQuickAdd = vi.fn();
    render(<ActivityCard activity={mockActivity} master={mockMaster} onQuickAdd={onQuickAdd} />);
    // The "+" button has aria-label "Добавить гостя"
    const btn = screen.getByRole('button', { name: 'Добавить гостя' });
    fireEvent.click(btn);
    expect(onQuickAdd).toHaveBeenCalledTimes(1);
    expect(onQuickAdd).toHaveBeenCalledWith(mockActivity);
  });

  it('calls onQuickAdd for private activity with correct activity', () => {
    const onQuickAdd = vi.fn();
    const privateActivity = { ...mockActivity, isPrivate: true };
    render(<ActivityCard activity={privateActivity} master={mockMaster} onQuickAdd={onQuickAdd} />);
    const btn = screen.getByRole('button', { name: 'Редактировать' });
    fireEvent.click(btn);
    expect(onQuickAdd).toHaveBeenCalledTimes(1);
    expect(onQuickAdd).toHaveBeenCalledWith(privateActivity);
  });

  it('does not call onQuickAdd when not provided', () => {
    render(<ActivityCard activity={mockActivity} master={mockMaster} />);
    const btn = screen.getByRole('button', { name: 'Добавить гостя' });
    // Should not throw when clicked without onQuickAdd
    expect(() => fireEvent.click(btn)).not.toThrow();
  });

  it('renders progress bar with width proportional to occupancy', () => {
    const { container } = render(<ActivityCard activity={mockActivity} master={mockMaster} />);
    const filledBar = container.querySelector('[data-testid="activity-ev_1"] [style*="width:"][class*="absolute"]');
    expect(filledBar).toBeInTheDocument();
    // mockActivity: occupied=3, capacity=8 → fillPct=0.375 → width=37.5%
    expect(filledBar).toHaveStyle({ width: '37.5%' });
  });

  it('renders full width progress bar when fully occupied', () => {
    const fullActivity = { ...mockActivity, occupied: 8, capacity: 8 };
    const { container } = render(<ActivityCard activity={fullActivity} master={mockMaster} />);
    const filledBar = container.querySelector('[data-testid="activity-ev_1"] [style*="width:"][class*="absolute"]');
    expect(filledBar).toHaveStyle({ width: '100%' });
  });

  it('renders zero width progress bar when empty', () => {
    const emptyActivity = { ...mockActivity, occupied: 0, capacity: 8 };
    const { container } = render(<ActivityCard activity={emptyActivity} master={mockMaster} />);
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
  mockUseUI.mockReturnValue(createMockUIContext());
  mockUseSchedule.mockReturnValue(createMockScheduleContext());
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

    render(<ActivityCard activity={mockActivity} master={mockMaster} />);
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

    const { container } = render(<ActivityCard activity={mockActivity} master={mockMaster} />);
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
