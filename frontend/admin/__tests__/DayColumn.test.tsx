import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { DayColumn } from '../app/components/schedule/DayColumn';
import type { Activity, Master, Service } from '@memo/domain';
import { createMockUIContext, createMockScheduleContext } from './helpers/mockContexts';
const MOCK_MASTERS: Master[] = [
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
    minAge: '12',
    maxAge: '99',
    defaultAdultPrice: 2500,
    description: 'Рисование масляными красками',
  },
  {
    id: 's2',
    name: 'Картина акрилом',
    duration: 1.5,
    durationMinutes: 90,
    maxCapacity: 6,
    minAge: '6',
    maxAge: '99',
    defaultAdultPrice: 2000,
    description: 'Рисование акриловыми красками',
  },
  {
    id: 's3',
    name: 'Мини-картина',
    duration: 2,
    durationMinutes: 120,
    maxCapacity: 10,
    minAge: '6',
    maxAge: '99',
    defaultAdultPrice: 1500,
    description: 'Маленький формат',
  },
];

// Mock contexts used by ActivityCard (rendered inside DayColumn)
vi.mock('@/contexts/UIContext', () => ({
  useUI: vi.fn(() => createMockUIContext()),
}));

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: vi.fn(() => createMockScheduleContext()),
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
    minAge: '12',
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
    minAge: '6',
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
    minAge: '6',
    locationId: 'grand',
    occupied: 5,
    capacity: 10,
    isPrivate: false,
  },
];

function getMasterById(masterId: string) {
  return MOCK_MASTERS.find(a => a.id === masterId) || MOCK_MASTERS[0];
}

describe('DayColumn', () => {
  it('renders slot dividers', () => {
    render(
      <DayColumn
        dayIndex={0}
        date={new Date()}
        activities={[]}
        masters={MOCK_MASTERS}
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
        masters={MOCK_MASTERS}
      />,
    );
    expect(screen.getByTestId('activity-a1')).toBeInTheDocument();
    expect(screen.getByTestId('activity-a2')).toBeInTheDocument();
    expect(screen.getByTestId('activity-a3')).toBeInTheDocument();
  });

  it('applies formula-based offset to overlapping activities', () => {
    render(
      <DayColumn
        dayIndex={0}
        date={new Date()}
        activities={mockActivities.slice(0, 2)} // a1 and a2 both start at 10
        masters={MOCK_MASTERS}
      />,
    );
    const card1 = screen.getByTestId('activity-a1');
    const card2 = screen.getByTestId('activity-a2');

    // z=0 (front card): (12-0)*0 = 0, scale=1
    expect(card1).toHaveStyle({ transform: 'translate(0px, 0px) scale(1)' });
    // z=1: (12-1)*1 = 11, scale=max(0.8, 1-1*0.04)=0.96
    expect(card2).toHaveStyle({ transform: 'translate(11px, 11px) scale(0.96)' });
  });

  it('non-overlapping activity has no offset', () => {
    render(
      <DayColumn
        dayIndex={0}
        date={new Date()}
        activities={[mockActivities[2]]} // a3 starts at 14, alone
        masters={MOCK_MASTERS}
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
        masters={MOCK_MASTERS}
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
        masters={MOCK_MASTERS}
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
        masters={MOCK_MASTERS}
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
        masters={MOCK_MASTERS}
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
          masters={MOCK_MASTERS}
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
          masters={MOCK_MASTERS}
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
          masters={MOCK_MASTERS}
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
          masters={MOCK_MASTERS}
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

  // Activity A: 10:00-13:00, Activity B: 12:00-13:30 (overlap 12:00-13:00)
  const partialOverlapActivities: Activity[] = [
    {
      id: 'po_a1',
      day: 0,
      masterId: 'm1',
      startTime: 10,
      duration: 3,
      serviceId: 's1',
      serviceName: 'Oil painting',
      locationId: 'alpika',
      occupied: 2,
      capacity: 8,
      isPrivate: false,
    },
    {
      id: 'po_a2',
      day: 0,
      masterId: 'm2',
      startTime: 12,
      duration: 1.5,
      serviceId: 's2',
      serviceName: 'Acrylic',
      locationId: 'alpika',
      occupied: 3,
      capacity: 6,
      isPrivate: false,
    },
  ];

  describe('partial-overlap carousel', () => {
    it('groups partially overlapping activities into same carousel group', () => {
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={partialOverlapActivities}
          masters={MOCK_MASTERS}
        />,
      );

      // Both cards should be in a carousel group (size > 1), so they get carousel styling
      const card1 = screen.getByTestId('activity-po_a1');
      const card2 = screen.getByTestId('activity-po_a2');

      // First card should be visible (diff=0), second hidden (diff=1)
      expect(card1).toHaveStyle({ opacity: '1' });
      expect(card2).toHaveStyle({ opacity: '0.85' }); // 1 - 1*0.15 = 0.85
    });

    it('cycles partially overlapping cards on wheel event', async () => {
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={partialOverlapActivities}
          masters={MOCK_MASTERS}
        />,
      );

      const card1 = screen.getByTestId('activity-po_a1');
      const card2 = screen.getByTestId('activity-po_a2');

      // Initially card1 visible, card2 hidden
      expect(card1).toHaveStyle({ opacity: '1' });
      expect(card2).toHaveStyle({ opacity: '0.85' });

      // Wheel event at y=360 → time = 360/(60*2)+9 = 12, where both po_a1 (10-13) and po_a2 (12-13.5) overlap
      await act(async () => {
        const column = screen.getByTestId('day-column-0');
        column.getBoundingClientRect = vi.fn(() => ({
          top: 0, left: 0, width: 200, height: 1440,
          bottom: 1440, right: 200, x: 0, y: 0, toJSON: () => {},
        }));
        const wheelEvent = new WheelEvent('wheel', {
          deltaY: 100,
          clientY: 360, // time=12 where both activities are visible
          bubbles: true,
        });
        column.dispatchEvent(wheelEvent);
      });

      // Now card2 should be visible, card1 hidden
      expect(card1).toHaveStyle({ opacity: '0.85' });
      expect(card2).toHaveStyle({ opacity: '1' });
    });

    it('shows "N cards" badge for partially overlapping activities', () => {
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={partialOverlapActivities}
          masters={MOCK_MASTERS}
        />,
      );

      const badge = screen.getByRole('button', { name: /2 cards/i });
      expect(badge).toBeInTheDocument();
    });

    it('does NOT group non-overlapping activities', () => {
      // a1 at 10:00 (2h), a3 at 14:00 (2h) — no overlap
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={[mockActivities[0], mockActivities[2]]}
          masters={MOCK_MASTERS}
        />,
      );

      const card1 = screen.getByTestId('activity-a1');
      const card3 = screen.getByTestId('activity-a3');

      // Both should be fully visible (no carousel)
      expect(card1).toHaveStyle({ opacity: '1', transform: 'translate(0px, 0px) scale(1)' });
      expect(card3).toHaveStyle({ opacity: '1', transform: 'translate(0px, 0px) scale(1)' });
    });

    it('groups pairwise (not transitive): A overlaps B, B overlaps C, but A and C are separate groups', () => {
      // A: 10:00-11:00, B: 10:30-12:30, C: 12:00-13:00
      // A overlaps B (pair), B overlaps C (pair), but A does NOT overlap C
      // Each activity has its own pairwise group:
      //   A's group = [A, B] (size 2), A at index 0
      //   B's group = [A, B, C] (size 3), B at index 1
      //   C's group = [B, C] (size 2), C at index 1
      const chainActivities: Activity[] = [
        {
          id: 'ch_a',
          day: 0,
          masterId: 'm1',
          startTime: 10,
          duration: 1,
          serviceId: 's1',
          locationId: 'alpika',
          occupied: 1,
          capacity: 8,
          isPrivate: false,
        },
        {
          id: 'ch_b',
          day: 0,
          masterId: 'm2',
          startTime: 10.5,
          duration: 2,
          serviceId: 's2',
          locationId: 'alpika',
          occupied: 2,
          capacity: 6,
          isPrivate: false,
        },
        {
          id: 'ch_c',
          day: 0,
          masterId: 'm3',
          startTime: 12,
          duration: 1,
          serviceId: 's3',
          locationId: 'grand',
          occupied: 3,
          capacity: 10,
          isPrivate: false,
        },
      ];

      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={chainActivities}
          masters={MOCK_MASTERS}
        />,
      );

      const cardA = screen.getByTestId('activity-ch_a');
      const cardB = screen.getByTestId('activity-ch_b');
      const cardC = screen.getByTestId('activity-ch_c');

      // A: group [A,B] size 2, index 0 → diff 0 → visible
      expect(cardA).toHaveStyle({ opacity: '1' });
      // B: group [A,B,C] size 3, index 1 → diff 1 → hidden
      expect(cardB).toHaveStyle({ opacity: '0.85' });
      // C: group [B,C] size 2, index 1 → diff 1 → hidden
      expect(cardC).toHaveStyle({ opacity: '0.85' });

      // Only A's group has indexInGroup===0 with size>1 → "2 cards" badge
      const badge = screen.getByRole('button', { name: /2 cards/i });
      expect(badge).toBeInTheDocument();
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
          masters={MOCK_MASTERS}
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
          masters={MOCK_MASTERS}
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
          masters={MOCK_MASTERS}
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

  describe('OverlapPopover integration', () => {
    it('opens OverlapPopover when clicking "N cards" badge', () => {
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={partialOverlapActivities}
          masters={MOCK_MASTERS}
        />,
      );

      const badge = screen.getByRole('button', { name: /2 cards/i });
      fireEvent.click(badge);

      expect(screen.getByTestId('overlap-popover')).toBeInTheDocument();
    });

    it('popover shows both overlapping activities inside it', () => {
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={partialOverlapActivities}
          masters={MOCK_MASTERS}
        />,
      );

      const badge = screen.getByRole('button', { name: /2 cards/i });
      fireEvent.click(badge);

      const popover = screen.getByTestId('overlap-popover');
      // Service names should appear inside the popover
      expect(popover.textContent).toContain('Oil painting');
      expect(popover.textContent).toContain('Acrylic');
    });

    it('closes popover when clicking outside', () => {
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={partialOverlapActivities}
          masters={MOCK_MASTERS}
        />,
      );

      const badge = screen.getByRole('button', { name: /2 cards/i });
      fireEvent.click(badge);
      expect(screen.getByTestId('overlap-popover')).toBeInTheDocument();

      // Click outside
      fireEvent.mouseDown(document.body);
      expect(screen.queryByTestId('overlap-popover')).not.toBeInTheDocument();
    });

    it('calls onOpenEditModal and closes popover when clicking a card in popover', () => {
      const onOpenEditModal = vi.fn();
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={partialOverlapActivities}
          masters={MOCK_MASTERS}
          onOpenEditModal={onOpenEditModal}
        />,
      );

      const badge = screen.getByRole('button', { name: /2 cards/i });
      fireEvent.click(badge);

      const popover = screen.getByTestId('overlap-popover');
      // Click on the first activity card inside the popover (ActivityCard is a div with onClick)
      const firstCard = popover.querySelector('[data-testid^="activity-"]');
      expect(firstCard).toBeInTheDocument();
      fireEvent.click(firstCard!);
      expect(onOpenEditModal).toHaveBeenCalledWith(partialOverlapActivities[0]);
      expect(screen.queryByTestId('overlap-popover')).not.toBeInTheDocument();
    });
  });
});
