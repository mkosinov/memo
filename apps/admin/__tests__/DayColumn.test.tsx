import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { DayColumn } from '../app/components/schedule/DayColumn';
import type { Activity, Artist, Service } from '@memo/domain';
const MOCK_ARTISTS: Artist[] = [
  { id: 'm1', name: 'Анна Иванова', shortName: 'Анна', color: '#FF6B6B' },
  { id: 'm2', name: 'Петр Петров', shortName: 'Петр', color: '#4ECDC4' },
  { id: 'm3', name: 'Мария Сидорова', shortName: 'Мария', color: '#45B7D1' },
];

const MOCK_SERVICES: Service[] = [
  {
    id: 's1',
    name: 'Картина маслом',
    duration: 2.5,
    durationMinutes: 150,
    maxCapacity: 8,
    minAge: '12+',
    defaultAdultPrice: 2500,
    description: 'Рисование масляными красками',
  },
  {
    id: 's2',
    name: 'Картина акрилом',
    duration: 1.5,
    durationMinutes: 90,
    maxCapacity: 6,
    minAge: '6+',
    defaultAdultPrice: 2000,
    description: 'Рисование акриловыми красками',
  },
  {
    id: 's3',
    name: 'Мини-картина',
    duration: 2,
    durationMinutes: 120,
    maxCapacity: 10,
    minAge: '6+',
    defaultAdultPrice: 1500,
    description: 'Маленький формат',
  },
];

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
  })),
}));

// Mock useDroppable to control isOver state
const mockUseDroppable = vi.fn(() => ({
  isOver: false,
  setNodeRef: vi.fn(),
}));

vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual('@dnd-kit/core');
  return {
    ...actual,
    useDroppable: () => mockUseDroppable(),
  };
});

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
  return MOCK_ARTISTS.find(a => a.id === masterId) || MOCK_ARTISTS[0];
}

describe('DayColumn', () => {
  it('renders slot dividers', () => {
    render(
      <DayColumn
        dayIndex={0}
        date={new Date()}
        activities={[]}
        artists={MOCK_ARTISTS}
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
        artists={MOCK_ARTISTS}
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
        artists={MOCK_ARTISTS}
      />,
    );
    const card1 = screen.getByTestId('activity-a1');
    const card2 = screen.getByTestId('activity-a2');

    // First card: no offset (index 0 → translate(0, 0))
    expect(card1).toHaveStyle({ transform: 'translate(0px, 0px) scale(1)' });
    // Second card: offset by X and Y (index 1)
    expect(card2).toHaveStyle({ transform: 'translate(20px, 18px) scale(0.96)' });
  });

  it('non-overlapping activity has no offset', () => {
    render(
      <DayColumn
        dayIndex={0}
        date={new Date()}
        activities={[mockActivities[2]]} // a3 starts at 14, alone
        artists={MOCK_ARTISTS}
      />,
    );
    const card = screen.getByTestId('activity-a3');
    expect(card).toHaveStyle({ transform: 'translate(0px, 0px) scale(1)' });
  });

  it('cycles visible card on mouse wheel over overlapping slot', async () => {
    render(
      <DayColumn
        dayIndex={0}
        date={new Date()}
        activities={mockActivities.slice(0, 2)}
        artists={MOCK_ARTISTS}
      />,
    );
    const card1 = screen.getByTestId('activity-a1');
    const card2 = screen.getByTestId('activity-a2');

    // Initially first card is visible
    expect(card1).toHaveStyle({ opacity: '1' });
    expect(card2).toHaveStyle({ opacity: '0.85' });

    // Scroll to cycle — dispatch native WheelEvent (component uses addEventListener with passive:false)
    // Need to wait for useEffect to attach the listener
    await act(async () => {
      const column = screen.getByTestId('day-column-0');
      // Mock getBoundingClientRect so the wheel handler can calculate slot position
      column.getBoundingClientRect = vi.fn(() => ({ top: 0, left: 0, width: 200, height: 1440, bottom: 1440, right: 200, x: 0, y: 0, toJSON: () => {} }));
      const wheelEvent = new WheelEvent('wheel', { deltaY: 100, clientY: 120, bubbles: true });
      column.dispatchEvent(wheelEvent);
    });

    // Now second card should be visible
    expect(card1).toHaveStyle({ opacity: '0.85' });
    expect(card2).toHaveStyle({ opacity: '1' });
  });

  it('calls onCreateActivity when clicking an empty slot', () => {
    const onCreateActivity = vi.fn();
    render(
      <DayColumn
        dayIndex={2}
        date={new Date()}
        activities={[]}
        artists={MOCK_ARTISTS}
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
        artists={MOCK_ARTISTS}
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
        artists={MOCK_ARTISTS}
      />,
    );

    // Click on the column itself — should not throw
    const column = screen.getByTestId('day-column-1');
    expect(() => fireEvent.click(column)).not.toThrow();
  });

  describe('drop slot ghost preview', () => {
    beforeEach(() => {
      mockUseDroppable.mockReset();
      mockUseDroppable.mockReturnValue({
        isOver: true,
        setNodeRef: vi.fn(),
      });
    });

    afterEach(() => {
      mockUseDroppable.mockReset();
      mockUseDroppable.mockReturnValue({
        isOver: false,
        setNodeRef: vi.fn(),
      });
    });

    it('applies card-shaped ghost style with borderRadius when slot is hovered', () => {
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={[]}
          artists={MOCK_ARTISTS}
        />,
      );

      const column = screen.getByTestId('day-column-0');
      const slots = column.querySelectorAll('[data-slot-index]');
      expect(slots.length).toBeGreaterThan(0);

      // The first slot should have the ghost style applied
      const firstSlot = slots[0] as HTMLElement;
      expect(firstSlot).toHaveStyle({ borderRadius: '12px' });
    });

    it('applies margin to ghost slot to match ActivityCard horizontal padding', () => {
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={[]}
          artists={MOCK_ARTISTS}
        />,
      );

      const column = screen.getByTestId('day-column-0');
      const slots = column.querySelectorAll('[data-slot-index]');
      const firstSlot = slots[0] as HTMLElement;

      expect(firstSlot).toHaveStyle({ margin: '1px 6px' });
    });

    it('applies dashed border in brand color when not in copy mode', () => {
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={[]}
          artists={MOCK_ARTISTS}
          dragCopy={false}
        />,
      );

      const column = screen.getByTestId('day-column-0');
      const slots = column.querySelectorAll('[data-slot-index]');
      const firstSlot = slots[0] as HTMLElement;

      expect(firstSlot.style.border).toContain('dashed');
    });

    it('applies green dashed border when in copy mode', () => {
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={[]}
          artists={MOCK_ARTISTS}
          dragCopy={true}
        />,
      );

      const column = screen.getByTestId('day-column-0');
      const slots = column.querySelectorAll('[data-slot-index]');
      const firstSlot = slots[0] as HTMLElement;

      expect(firstSlot.style.border).toContain('dashed');
      // jsdom converts hex #22c55e to rgb(34, 197, 94)
      expect(firstSlot.style.border).toMatch(/#22c55e|rgb\(34,\s*197,\s*94\)/);
    });
  });

  describe('stamp ghost preview on hover', () => {
    const mockStamp = {
      masterId: 'm1',
      serviceId: 's1',
      locations: new Set(['alpika']),
      ready: true,
    };

    it('shows stamp ghost preview when stampReady and hovering an empty slot', () => {
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={[]}
          artists={MOCK_ARTISTS}
          services={MOCK_SERVICES}
          stampReady={true}
          stamp={mockStamp}
        />,
      );

      const column = screen.getByTestId('day-column-0');
      const slots = column.querySelectorAll('[data-slot-index]');
      const firstSlot = slots[0] as HTMLElement;

      // Hover over the slot
      fireEvent.mouseEnter(firstSlot);

      // Should render the stamp ghost preview
      const ghost = column.querySelector('[data-stamp-ghost]');
      expect(ghost).toBeInTheDocument();
      // Should show the service name
      expect(ghost?.textContent).toContain('Картина маслом');
      // Should show the time range (slot 0 = 9:00, service s1 = 2.5h → 9:00–11:30)
      expect(ghost?.textContent).toContain('09:00');
    });

    it('hides stamp ghost preview on mouseLeave', () => {
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={[]}
          artists={MOCK_ARTISTS}
          services={MOCK_SERVICES}
          stampReady={true}
          stamp={mockStamp}
        />,
      );

      const column = screen.getByTestId('day-column-0');
      const slots = column.querySelectorAll('[data-slot-index]');
      const firstSlot = slots[0] as HTMLElement;

      // Hover then leave
      fireEvent.mouseEnter(firstSlot);
      expect(column.querySelector('[data-stamp-ghost]')).toBeInTheDocument();

      fireEvent.mouseLeave(firstSlot);
      expect(column.querySelector('[data-stamp-ghost]')).not.toBeInTheDocument();
    });

    it('does not show stamp ghost when stamp is not ready', () => {
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={[]}
          artists={MOCK_ARTISTS}
          services={MOCK_SERVICES}
          stampReady={false}
          stamp={{ masterId: null, serviceId: null, locations: new Set(), ready: false }}
        />,
      );

      const column = screen.getByTestId('day-column-0');
      const slots = column.querySelectorAll('[data-slot-index]');
      const firstSlot = slots[0] as HTMLElement;

      fireEvent.mouseEnter(firstSlot);
      expect(column.querySelector('[data-stamp-ghost]')).not.toBeInTheDocument();
    });
  });
});
