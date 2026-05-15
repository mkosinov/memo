import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { DayColumn } from '../app/components/schedule/DayColumn';
import type { Activity, Artist } from '../lib/types';
import { ARTISTS } from '../lib/mock-data';

// Mock contexts used by ActivityCard (rendered inside DayColumn)
vi.mock('@/contexts/UIContext', () => ({
  useUI: vi.fn(() => ({
    deleteMode: false,
    toggleDeleteMode: vi.fn(),
    toasts: [],
    showToast: vi.fn(),
    hideToast: vi.fn(),
    sidebarCollapsed: false,
    toggleSidebar: vi.fn(),
    rightPanelCollapsed: false,
    toggleRightPanel: vi.fn(),
    theme: 'light' as const,
    toggleTheme: vi.fn(),
  })),
}));

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: vi.fn(() => ({
    activities: [],
    artists: [],
    services: [],
    studios: [],
    currentWeek: new Date(),
    stamp: { masterId: null, serviceId: null, locations: new Set(), ready: false },
    setCurrentWeek: vi.fn(),
    addActivity: vi.fn(),
    updateActivity: vi.fn(),
    deleteActivity: vi.fn(),
    setStamp: vi.fn(),
    copyLastWeek: vi.fn(),
  })),
}));

const mockActivities: Activity[] = [
  {
    id: 'a1',
    day: 0,
    masterId: 'm1',
    startTime: 10,
    duration: 2,
    serviceId: 's1',
    serviceName: 'Картина маслом',
    minAge: '12+',
    locationId: 'alpika',
    occupied: 3,
    capacity: 8,
    isPrivate: false,
  },
  {
    id: 'a2',
    day: 0,
    masterId: 'm2',
    startTime: 10,
    duration: 1.5,
    serviceId: 's2',
    serviceName: 'Картина акрилом',
    minAge: '6+',
    locationId: 'alpika',
    occupied: 4,
    capacity: 6,
    isPrivate: false,
  },
  {
    id: 'a3',
    day: 0,
    masterId: 'm3',
    startTime: 14,
    duration: 2,
    serviceId: 's3',
    serviceName: 'Мини-картина',
    minAge: '6+',
    locationId: 'grand',
    occupied: 5,
    capacity: 10,
    isPrivate: false,
  },
];

function getArtistById(masterId: string) {
  return ARTISTS.find(a => a.id === masterId) || ARTISTS[0];
}

describe('DayColumn', () => {
  it('renders slot dividers', () => {
    render(
      <DayColumn
        dayIndex={0}
        date={new Date()}
        activities={[]}
        artists={ARTISTS}
      />,
    );
    const column = screen.getByTestId('day-column-0');
    expect(column).toBeInTheDocument();
  });

  it('renders activity cards for each activity', () => {
    render(
      <DayColumn
        dayIndex={0}
        date={new Date()}
        activities={mockActivities}
        artists={ARTISTS}
      />,
    );
    expect(screen.getByTestId('activity-a1')).toBeInTheDocument();
    expect(screen.getByTestId('activity-a2')).toBeInTheDocument();
    expect(screen.getByTestId('activity-a3')).toBeInTheDocument();
  });

  it('applies stacked offset to overlapping activities', () => {
    render(
      <DayColumn
        dayIndex={0}
        date={new Date()}
        activities={mockActivities.slice(0, 2)} // a1 and a2 both start at 10
        artists={ARTISTS}
      />,
    );
    const card1 = screen.getByTestId('activity-a1');
    const card2 = screen.getByTestId('activity-a2');

    // First card: no offset
    expect(card1).toHaveStyle({ transform: 'translateX(0px)' });
    // Second card: offset by 6px
    expect(card2).toHaveStyle({ transform: 'translateX(6px)' });
  });

  it('non-overlapping activity has no offset', () => {
    render(
      <DayColumn
        dayIndex={0}
        date={new Date()}
        activities={[mockActivities[2]]} // a3 starts at 14, alone
        artists={ARTISTS}
      />,
    );
    const card = screen.getByTestId('activity-a3');
    expect(card).toHaveStyle({ transform: 'translateX(0px)' });
  });

  it('cycles visible card on mouse wheel over overlapping slot', () => {
    render(
      <DayColumn
        dayIndex={0}
        date={new Date()}
        activities={mockActivities.slice(0, 2)}
        artists={ARTISTS}
      />,
    );
    const card1 = screen.getByTestId('activity-a1');
    const card2 = screen.getByTestId('activity-a2');

    // Initially first card is visible
    expect(card1).not.toHaveStyle({ opacity: '0.3' });
    expect(card2).toHaveStyle({ opacity: '0.3' });

    // Scroll to cycle — clientY needs to land on the slot where activities overlap (startTime=10)
    // Slot 0 = 9:00, Slot 1 = 9:30, Slot 2 = 10:00 → y = 2 * 60 = 120
    const column = screen.getByTestId('day-column-0');
    fireEvent.wheel(column, { deltaY: 100, clientY: 120 });

    // Now second card should be visible
    expect(card1).toHaveStyle({ opacity: '0.3' });
    expect(card2).not.toHaveStyle({ opacity: '0.3' });
  });

  it('calls onCreateActivity when clicking an empty slot', () => {
    const onCreateActivity = vi.fn();
    render(
      <DayColumn
        dayIndex={2}
        date={new Date()}
        activities={[]}
        artists={ARTISTS}
        onCreateActivity={onCreateActivity}
      />,
    );

    // Click on the first slot (9:00 → slotIndex 0 → startTime 9)
    const column = screen.getByTestId('day-column-2');
    const slots = column.querySelectorAll('[data-slot-index]');
    fireEvent.click(slots[0]);

    expect(onCreateActivity).toHaveBeenCalledWith(2, 9);
  });

  it('does not call onCreateActivity when clicking on a card', () => {
    const onCreateActivity = vi.fn();
    render(
      <DayColumn
        dayIndex={0}
        date={new Date()}
        activities={mockActivities}
        artists={ARTISTS}
        onCreateActivity={onCreateActivity}
      />,
    );

    // Click on the activity card itself
    const card = screen.getByTestId('activity-a1');
    fireEvent.click(card);

    expect(onCreateActivity).not.toHaveBeenCalled();
  });

  it('does nothing on slot click when onCreateActivity is not provided', () => {
    const { container } = render(
      <DayColumn
        dayIndex={1}
        date={new Date()}
        activities={[]}
        artists={ARTISTS}
      />,
    );

    // Click on the column itself — should not throw
    const column = screen.getByTestId('day-column-1');
    expect(() => fireEvent.click(column)).not.toThrow();
  });
});
