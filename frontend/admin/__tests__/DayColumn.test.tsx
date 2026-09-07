import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { DayColumn } from '../app/components/schedule/DayColumn';
import type { ScheduleAdminDTO, Master, Service } from '@memo/domain';
import { formatTime } from '@/lib/datetime';
import { createMockUIContext, createMockScheduleData, createMockGridSettings } from './helpers/mockContexts';
const MOCK_MASTERS: Master[] = [
  { id: 'm1', name: 'Анна Иванова', shortName: 'Анна', color: '#FF6B6B' },
  { id: 'm2', name: 'Петр Петров', shortName: 'Петр', color: '#4ECDC4' },
  { id: 'm3', name: 'Мария Сидорова', shortName: 'Мария', color: '#45B7D1' },
];

const MOCK_SERVICES: Service[] = [
  {
    id: 's1',
    name: 'Картина маслом',
    durationMinutes: 150,
    minAge: '12',
    maxAge: '99',
    defaultAdultPrice: 2500,
    description: 'Рисование масляными красками',
    tariffs: [],
  },
  {
    id: 's2',
    name: 'Картина акрилом',
    durationMinutes: 90,
    minAge: '6',
    maxAge: '99',
    defaultAdultPrice: 2000,
    description: 'Рисование акриловыми красками',
    tariffs: [],
  },
  {
    id: 's3',
    name: 'Мини-картина',
    durationMinutes: 120,
    minAge: '6',
    maxAge: '99',
    defaultAdultPrice: 1500,
    description: 'Маленький формат',
    tariffs: [],
  },
];

// ─── Activity fixtures (ScheduleAdminDTO, GH #142) ─────────────────────────
// `serviceName` is the view bridge field (views pass {...dto, serviceName: serviceTitle})
// kept until Task 8 migrates ActivityCard to read serviceTitle directly.
type BridgedActivity = ScheduleAdminDTO & { serviceName: string };

function makeAct(overrides: Partial<Omit<BridgedActivity, 'id' | 'startMinutes' | 'durationMinutes'>> & { id: string; startMinutes: number; durationMinutes: number }): BridgedActivity {
  const { id, startMinutes, durationMinutes } = overrides;
  return {
    day: 0,
    masterId: 'm1',
    serviceId: 's1',
    locationId: 'alpika',
    masterName: 'Анна Иванова',
    masterColor: '#FF6B6B',
    serviceTitle: overrides.serviceName ?? 'Test',
    date: '2026-06-15',
    time: formatTime(startMinutes),
    locationName: 'Альпика',
    minAge: '6',
    maxAge: '99',
    occupied: 0,
    capacity: 8,
    isPrivate: false,
    comment: '',
    priceMin: 0,
    priceMax: 0,
    serviceName: 'Test',
    ...overrides,
    id,
    startMinutes,
    durationMinutes,
  };
}

// Mock contexts used by ActivityCard (rendered inside DayColumn)
vi.mock('@/contexts/UIContext', () => ({
  useUI: vi.fn(() => createMockUIContext()),
}));

// GH #141 Task 10: DayColumn itself is props-driven (no schedule context). These
// registrations exist ONLY for the real ActivityCard child, which now reads the
// split contexts — data for the mutations, grid settings for cellHeight.
vi.mock('@/contexts/schedule/ScheduleDataContext', () => ({
  useScheduleData: vi.fn(() => createMockScheduleData()),
}));

vi.mock('@/contexts/schedule/GridSettingsContext', () => ({
  useGridSettings: vi.fn(() => createMockGridSettings()),
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

const mockActivities: BridgedActivity[] = [
  makeAct({
    id: 'a1',
    day: 0,
    masterId: 'm1',
    startMinutes: 600,
    durationMinutes: 120,
    serviceId: 's1',
    serviceName: 'Картина маслом',
    minAge: '12',
    locationId: 'alpika',
    occupied: 3,
    capacity: 8,
  }),
  makeAct({
    id: 'a2',
    day: 0,
    masterId: 'm2',
    startMinutes: 600,
    durationMinutes: 90,
    serviceId: 's2',
    serviceName: 'Картина акрилом',
    minAge: '6',
    locationId: 'alpika',
    occupied: 4,
    capacity: 6,
  }),
  makeAct({
    id: 'a3',
    day: 0,
    masterId: 'm3',
    startMinutes: 840,
    durationMinutes: 120,
    serviceId: 's3',
    serviceName: 'Мини-картина',
    minAge: '6',
    locationId: 'grand',
    occupied: 5,
    capacity: 10,
  }),
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

    // Click on the first slot (9:00 → slotIndex 0 → slotMinutes 540)
    const column = screen.getByTestId('day-column-2');
    const slots = column.querySelectorAll('[data-slot-index]');
    fireEvent.click(slots[0]);

    expect(onCreateActivity).toHaveBeenCalledWith(2, 540);
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
  const partialOverlapActivities: BridgedActivity[] = [
    makeAct({
      id: 'po_a1',
      masterId: 'm1',
      startMinutes: 600,
      durationMinutes: 180,
      serviceId: 's1',
      serviceName: 'Oil painting',
      occupied: 2,
    }),
    makeAct({
      id: 'po_a2',
      masterId: 'm2',
      startMinutes: 720,
      durationMinutes: 90,
      serviceId: 's2',
      serviceName: 'Acrylic',
      occupied: 3,
      capacity: 6,
    }),
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

      // Wheel event at y=360 → cursorMinutes = 540 + 360/(60/30) = 720 (12:00), where both po_a1 (600–780) and po_a2 (720–810) overlap
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

    it('shows badge on topmost card for multi-activity group', () => {
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={partialOverlapActivities}
          masters={MOCK_MASTERS}
        />,
      );

      // Badge shows "2 cards" on the topmost card (z=0) in the group
      const badge = screen.getByRole('button', { name: /2 cards/i });
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute('title', 'View all overlapping cards');
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

    it('groups activities in same time window into one carousel, regardless of pairwise overlap', () => {
      // With time-groups model: all 3 activities are in G1 (startMinutes 600, 630, 720 are all in [540, 780))
      // They form a single carousel group regardless of whether they pairwise overlap.
      const chainActivities: BridgedActivity[] = [
        makeAct({
          id: 'ch_a',
          masterId: 'm1',
          startMinutes: 600,
          durationMinutes: 60,
          serviceId: 's1',
          serviceName: 'Chain A',
          occupied: 1,
        }),
        makeAct({
          id: 'ch_b',
          masterId: 'm2',
          startMinutes: 630,
          durationMinutes: 120,
          serviceId: 's2',
          serviceName: 'Chain B',
          occupied: 2,
          capacity: 6,
        }),
        makeAct({
          id: 'ch_c',
          masterId: 'm3',
          startMinutes: 720,
          durationMinutes: 60,
          serviceId: 's3',
          serviceName: 'Chain C',
          locationId: 'grand',
          occupied: 3,
          capacity: 10,
        }),
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

      // All 3 in G1 group (size 3), sorted by startMinutes:
      // A (startMinutes=600): index 0 → z=0 → opacity 1
      expect(cardA).toHaveStyle({ opacity: '1' });
      // B (startMinutes=630): index 1 → z=1 → opacity 0.85
      expect(cardB).toHaveStyle({ opacity: '0.85' });
      // C (startMinutes=720): index 2 → z=2 → opacity 0.7
      expect(cardC).toHaveStyle({ opacity: '0.7' });

      // Badge shows "3 cards" on the topmost G1 card
      const badge = screen.getByRole('button', { name: /3 cards/i });
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
    it('opens OverlapPopover when clicking group badge', () => {
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

    it('toggles popover closed when clicking the same badge again', () => {
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={partialOverlapActivities}
          masters={MOCK_MASTERS}
        />,
      );

      const badge = screen.getByRole('button', { name: /2 cards/i });

      // First click — opens the popover
      fireEvent.click(badge);
      expect(screen.getByTestId('overlap-popover')).toBeInTheDocument();

      // Second click on same badge — should close the popover (toggle)
      fireEvent.click(badge);
      expect(screen.queryByTestId('overlap-popover')).not.toBeInTheDocument();
    });

    it('badge z-index is above popover z-index so toggle click is not swallowed', () => {
      // The OverlapPopover renders with position:fixed and z-index:100.
      // If the badge has z-index below 100, clicking the badge position hits the
      // popover (which is above), preventing the toggle-close from firing.
      // Badge must be above 100 to receive clicks when popover is open.
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={partialOverlapActivities}
          masters={MOCK_MASTERS}
        />,
      );

      const badge = screen.getByRole('button', { name: /2 cards/i });

      // Extract z-index from the Tailwind class (e.g., z-[110] → 110)
      const classMatch = badge.className.match(/z-\[(\d+)\]/);
      expect(classMatch).toBeTruthy();
      const badgeZIndex = parseInt(classMatch![1], 10);

      // Popover uses zIndex: 100 — badge must be above that
      expect(badgeZIndex).toBeGreaterThan(100);
    });

    it('badge mousedown prevents outside-click handler from interfering with toggle', () => {
      // Simulates the real-world scenario: mousedown fires on badge before click.
      // Without stopPropagation on mousedown, the outside-click handler would close
      // the popover first, then the click would re-open it.
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={partialOverlapActivities}
          masters={MOCK_MASTERS}
        />,
      );

      const badge = screen.getByRole('button', { name: /2 cards/i });

      // First click — opens the popover
      fireEvent.click(badge);
      expect(screen.getByTestId('overlap-popover')).toBeInTheDocument();

      // Simulate real click sequence: mousedown → mouseup → click
      // The badge's mousedown handler should stopPropagation to prevent
      // the document-level outside-click handler from firing.
      fireEvent.mouseDown(badge);
      fireEvent.mouseUp(badge);
      fireEvent.click(badge);

      // Popover should be closed (toggle off)
      expect(screen.queryByTestId('overlap-popover')).not.toBeInTheDocument();
    });

    it('popover toggle closes even when document mousedown races with badge click', () => {
      // Regression test: In a real browser, the native mousedown event on the badge
      // bubbles to document BEFORE React's synthetic event delegation processes it.
      // This causes OverlapPopover's document mousedown handler to fire onClose()
      // before the badge's onClick toggle runs, which reopens the popover.
      //
      // The fix: OverlapPopover's document handler must skip onClose() when the
      // mousedown target is a popover toggle trigger (badge with data-popover-toggle).
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={partialOverlapActivities}
          masters={MOCK_MASTERS}
        />,
      );

      const badge = screen.getByRole('button', { name: /2 cards/i });

      // Verify the badge has data-popover-toggle so the OverlapPopover document
      // handler can identify it and skip calling onClose
      expect(badge).toHaveAttribute('data-popover-toggle');

      // First click — opens the popover
      fireEvent.click(badge);
      expect(screen.getByTestId('overlap-popover')).toBeInTheDocument();

      // Second click on same badge — should close the popover (toggle)
      // Even if the document mousedown handler races with the badge click,
      // the data-popover-toggle guard prevents onClose from being called
      fireEvent.click(badge);
      expect(screen.queryByTestId('overlap-popover')).not.toBeInTheDocument();
    });

    it('does not emit console.log during initialization', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        render(
          <DayColumn
            dayIndex={0}
            date={new Date()}
            activities={partialOverlapActivities}
            masters={MOCK_MASTERS}
          />,
        );
        // Per-card z-index model should not produce debug logging
        expect(consoleSpy).not.toHaveBeenCalled();
      } finally {
        consoleSpy.mockRestore();
      }
    });

    it('same card retains same z-index across partial overlap range', () => {
      // Two activities: po_a1 (10:00-13:00) and po_a2 (12:00-13:30)
      // In the per-card model, po_a1 is always z=0 and po_a2 always z=1
      // regardless of which timeslot we inspect
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

      // po_a1 has earlier start → z=0 → front → full opacity
      expect(card1).toHaveStyle({ opacity: '1' });
      // po_a2 has later start → z=1 → behind → dimmed
      expect(card2).toHaveStyle({ opacity: '0.85' });

      // Both cards should have different transforms (z=0 vs z=1 offset)
      const style1 = card1.getAttribute('style') || '';
      const style2 = card2.getAttribute('style') || '';
      // z=0: translate(0px, 0px) scale(1), z=1: translate(11px, 11px) scale(0.96)
      expect(style1).toContain('translate(0px, 0px) scale(1)');
      expect(style2).toContain('translate(11px, 11px) scale(0.96)');
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

  // ─── Time-Groups Carousel Model Tests ──────────────────────────────────

  describe('time-groups carousel model', () => {
    // G1: 09:00–12:59 (540–779), G2: 13:00–15:59 (780–959), G3: 16:00–23:59 (960–1439)
    // Two activities in G1 (both start at 10:00), one in G2 (starts at 14:00)
    const timeGroupActivities: BridgedActivity[] = [
      makeAct({
        id: 'tg_a1',
        masterId: 'm1',
        startMinutes: 600,
        durationMinutes: 120,
        serviceId: 's1',
        serviceName: 'G1 Activity A',
        occupied: 3,
      }),
      makeAct({
        id: 'tg_a2',
        masterId: 'm2',
        startMinutes: 630,
        durationMinutes: 90,
        serviceId: 's2',
        serviceName: 'G1 Activity B',
        occupied: 4,
        capacity: 6,
      }),
      makeAct({
        id: 'tg_a3',
        masterId: 'm3',
        startMinutes: 840,
        durationMinutes: 120,
        serviceId: 's3',
        serviceName: 'G2 Activity C',
        locationId: 'grand',
        occupied: 5,
        capacity: 10,
      }),
    ];

    it('groups activities by start time into correct time groups', () => {
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={timeGroupActivities}
          masters={MOCK_MASTERS}
        />,
      );

      // All three cards should render
      expect(screen.getByTestId('activity-tg_a1')).toBeInTheDocument();
      expect(screen.getByTestId('activity-tg_a2')).toBeInTheDocument();
      expect(screen.getByTestId('activity-tg_a3')).toBeInTheDocument();
    });

    it('initializes z-indices within each group separately', () => {
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={timeGroupActivities}
          masters={MOCK_MASTERS}
        />,
      );

      // G1 has 2 activities: tg_a1 (start=10) and tg_a2 (start=10.5)
      // Sorted by startMinutes: tg_a1 (index 0), tg_a2 (index 1)
      // tg_a1: z=0 → full opacity
      // tg_a2: z=1 → partial opacity
      const card1 = screen.getByTestId('activity-tg_a1');
      const card2 = screen.getByTestId('activity-tg_a2');
      expect(card1).toHaveStyle({ opacity: '1' });
      expect(card2).toHaveStyle({ opacity: '0.85' });

      // G2 has 1 activity: tg_a3 → z=0 → full opacity
      const card3 = screen.getByTestId('activity-tg_a3');
      expect(card3).toHaveStyle({ opacity: '1' });
    });

    it('scrolling in G1 cycles only G1 activities, not G2', async () => {
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={timeGroupActivities}
          masters={MOCK_MASTERS}
        />,
      );

      const card1 = screen.getByTestId('activity-tg_a1');
      const card2 = screen.getByTestId('activity-tg_a2');
      const card3 = screen.getByTestId('activity-tg_a3');

      // Initially: G1 has z=0→tg_a1, z=1→tg_a2
      expect(card1).toHaveStyle({ opacity: '1' });
      expect(card2).toHaveStyle({ opacity: '0.85' });
      expect(card3).toHaveStyle({ opacity: '1' }); // G2, alone

      // Wheel event at y=120 (cursorMinutes≈600/10:00, in G1 range) should cycle G1 only
      await act(async () => {
        const column = screen.getByTestId('day-column-0');
        column.getBoundingClientRect = vi.fn(() => ({
          top: 0, left: 0, width: 200, height: 1440,
          bottom: 1440, right: 200, x: 0, y: 0, toJSON: () => {},
        }));
        const wheelEvent = new WheelEvent('wheel', {
          deltaY: 100,
          clientY: 120, // cursorMinutes ≈ 600 (10:00) → G1
          bubbles: true,
        });
        column.dispatchEvent(wheelEvent);
      });

      // After cycling G1: tg_a1 should be behind (z>0), tg_a2 should be front (z=0)
      expect(card1).toHaveStyle({ opacity: '0.85' });
      expect(card2).toHaveStyle({ opacity: '1' });
      // G2 activity at 14:00 (840) does NOT overlap with G1 minute range (540-780),
      // so it should NOT be rendered as background
      expect(card3).toHaveStyle({ opacity: '1' });
    });

    it('activity from different group is NOT background when it does not overlap with active group time range', async () => {
      // When G1 is active, G2 activities that don't overlap with G1's time range should NOT be background
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={timeGroupActivities}
          masters={MOCK_MASTERS}
        />,
      );

      const card1 = screen.getByTestId('activity-tg_a1');
      const card3 = screen.getByTestId('activity-tg_a3');

      // Before any cursor interaction — all groups render independently
      expect(card1).toHaveStyle({ opacity: '1' });
      expect(card3).toHaveStyle({ opacity: '1' });

      // Wheel at G1 area (y=120, cursorMinutes≈600/10:00 → G1 becomes active)
      await act(async () => {
        const column = screen.getByTestId('day-column-0');
        column.getBoundingClientRect = vi.fn(() => ({
          top: 0, left: 0, width: 200, height: 1440,
          bottom: 1440, right: 200, x: 0, y: 0, toJSON: () => {},
        }));
        const wheelEvent = new WheelEvent('wheel', {
          deltaY: 100,
          clientY: 120, // cursorMinutes ≈ 600 (10:00) → G1
          bubbles: true,
        });
        column.dispatchEvent(wheelEvent);
      });

      // card3 (G2 at 14:00/840) does NOT overlap with G1 minute range (540-780)
      // so it should NOT be background
      expect(card3).toHaveStyle({ opacity: '1' });
    });

    it('badge appears on topmost card in multi-activity group', () => {
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={timeGroupActivities}
          masters={MOCK_MASTERS}
        />,
      );

      // G1 has 2 activities → badge "2 cards" on the topmost card (tg_a1, z=0)
      const badge = screen.getByRole('button', { name: /2 cards/i });
      expect(badge).toBeInTheDocument();

      // G2 has 1 activity → no badge
      // There should only be one badge (for G1's multi-activity group)
      const allBadges = screen.getAllByRole('button', { name: /cards/i });
      expect(allBadges).toHaveLength(1);
    });

    it('badge popover shows only group activities', () => {
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={timeGroupActivities}
          masters={MOCK_MASTERS}
        />,
      );

      const badge = screen.getByRole('button', { name: /2 cards/i });
      fireEvent.click(badge);

      const popover = screen.getByTestId('overlap-popover');
      // Should contain G1 activities
      expect(popover.textContent).toContain('G1 Activity A');
      expect(popover.textContent).toContain('G1 Activity B');
      // Should NOT contain G2 activity
      expect(popover.textContent).not.toContain('G2 Activity C');
    });

    it('wheel on G2 area cycles only G2 activities', async () => {
      // One activity in G1, two in G2
      const g2Activities: BridgedActivity[] = [
        makeAct({
          id: 'g2_only',
          masterId: 'm1',
          startMinutes: 600,
          durationMinutes: 120,
          serviceId: 's1',
          serviceName: 'G1 Solo',
          occupied: 3,
        }),
        makeAct({
          id: 'g2_a',
          masterId: 'm2',
          startMinutes: 780,
          durationMinutes: 120,
          serviceId: 's2',
          serviceName: 'G2 Activity A',
          occupied: 4,
          capacity: 6,
        }),
        makeAct({
          id: 'g2_b',
          masterId: 'm3',
          startMinutes: 810,
          durationMinutes: 90,
          serviceId: 's3',
          serviceName: 'G2 Activity B',
          locationId: 'grand',
          occupied: 5,
          capacity: 10,
        }),
      ];

      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={g2Activities}
          masters={MOCK_MASTERS}
        />,
      );

      const g2CardA = screen.getByTestId('activity-g2_a');
      const g2CardB = screen.getByTestId('activity-g2_b');

      // Initially G2: g2_a is z=0, g2_b is z=1
      expect(g2CardA).toHaveStyle({ opacity: '1' });
      expect(g2CardB).toHaveStyle({ opacity: '0.85' });

      // Wheel at y=540 → cursorMinutes = 540 + 540/(60/30) = 810 (13:30) → G2
      await act(async () => {
        const column = screen.getByTestId('day-column-0');
        column.getBoundingClientRect = vi.fn(() => ({
          top: 0, left: 0, width: 200, height: 1440,
          bottom: 1440, right: 200, x: 0, y: 0, toJSON: () => {},
        }));
        const wheelEvent = new WheelEvent('wheel', {
          deltaY: 100,
          clientY: 540, // time ≈ 13.5 → G2
          bubbles: true,
        });
        column.dispatchEvent(wheelEvent);
      });

      // After cycling G2: g2_a should be behind, g2_b should be front
      expect(g2CardA).toHaveStyle({ opacity: '0.85' });
      expect(g2CardB).toHaveStyle({ opacity: '1' });
    });

    it('activities overlapping in time but in different groups cycle together at cursor position', async () => {
      // Activity A: starts at 750/12:30 (G1), duration 120min (ends 870/14:30) → visually at y=420..660
      // Activity B: starts at 780/13:00 (G2), duration 60min (ends 840/14:00) → visually at y=480..600
      // They visually overlap at y=480..600 — cursor-based cycling should find both
      const crossGroupActivities: BridgedActivity[] = [
        makeAct({
          id: 'cg_a',
          masterId: 'm1',
          startMinutes: 750,
          durationMinutes: 120,
          serviceId: 's1',
          serviceName: 'Cross G1',
          occupied: 2,
        }),
        makeAct({
          id: 'cg_b',
          masterId: 'm2',
          startMinutes: 780,
          durationMinutes: 60,
          serviceId: 's2',
          serviceName: 'Cross G2',
          occupied: 3,
          capacity: 6,
        }),
      ];

      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={crossGroupActivities}
          masters={MOCK_MASTERS}
        />,
      );

      const cardA = screen.getByTestId('activity-cg_a');
      const cardB = screen.getByTestId('activity-cg_b');

      // Initially: each in their own group (alone), so both z=0 → full opacity
      expect(cardA).toHaveStyle({ opacity: '1' });
      expect(cardB).toHaveStyle({ opacity: '1' });

      // Wheel at y=540 → time≈13.5, where BOTH cards visually overlap
      await act(async () => {
        const column = screen.getByTestId('day-column-0');
        column.getBoundingClientRect = vi.fn(() => ({
          top: 0, left: 0, width: 200, height: 1440,
          bottom: 1440, right: 200, x: 0, y: 0, toJSON: () => {},
        }));
        const wheelEvent = new WheelEvent('wheel', {
          deltaY: 100,
          clientY: 540, // time ≈ 13.5
          bubbles: true,
        });
        column.dispatchEvent(wheelEvent);
      });

      // After cycling: cardA sorted first by startMinutes (750 < 780) → z=1 (behind)
      // cardB sorted second → z=0 (front)
      expect(cardA).toHaveStyle({ opacity: '0.85' });
      expect(cardB).toHaveStyle({ opacity: '1' });
    });

    it('scrolling at cursor time 13:00 cycles G2 activities, not G1 spanning activity', async () => {
      // G1 activity spanning into G2 (12:30-14:30) + two G2 activities
      // At cursor time 13:00, only G2 should cycle (G1 spanning is not included)
      const g2CycleActivities: BridgedActivity[] = [
        makeAct({
          id: 'gc_g1span',
          masterId: 'm1',
          startMinutes: 750,
          durationMinutes: 120, // ends 14:30, spans into G2
          serviceId: 's1',
          serviceName: 'G1 Spanning',
          occupied: 2,
        }),
        makeAct({
          id: 'gc_g2a',
          masterId: 'm2',
          startMinutes: 780,
          durationMinutes: 60,
          serviceId: 's2',
          serviceName: 'G2 Activity A',
          occupied: 3,
          capacity: 6,
        }),
        makeAct({
          id: 'gc_g2b',
          masterId: 'm3',
          startMinutes: 810,
          durationMinutes: 90,
          serviceId: 's3',
          serviceName: 'G2 Activity B',
          locationId: 'grand',
          occupied: 4,
          capacity: 10,
        }),
      ];

      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={g2CycleActivities}
          masters={MOCK_MASTERS}
        />,
      );

      const g1Card = screen.getByTestId('activity-gc_g1span');
      const g2CardA = screen.getByTestId('activity-gc_g2a');
      const g2CardB = screen.getByTestId('activity-gc_g2b');

      // Initially: G1 has 1 activity (z=0), G2 has 2 (gc_g2a z=0, gc_g2b z=1)
      expect(g1Card).toHaveStyle({ opacity: '1' });
      expect(g2CardA).toHaveStyle({ opacity: '1' });
      expect(g2CardB).toHaveStyle({ opacity: '0.85' });

      // Scroll at y=480 → cursorMinutes = 540 + 480/(60/30) = 780 (13:00) → G2 boundary
      await act(async () => {
        const column = screen.getByTestId('day-column-0');
        column.getBoundingClientRect = vi.fn(() => ({
          top: 0, left: 0, width: 200, height: 1440,
          bottom: 1440, right: 200, x: 0, y: 0, toJSON: () => {},
        }));
        const wheelEvent = new WheelEvent('wheel', {
          deltaY: 100,
          clientY: 480, // time = 13.0 → G2 boundary
          bubbles: true,
        });
        column.dispatchEvent(wheelEvent);
      });

      // G2 activities should cycle: gc_g2a was z=0→z=1, gc_g2b was z=1→z=0
      expect(g2CardA).toHaveStyle({ opacity: '0.85' });
      expect(g2CardB).toHaveStyle({ opacity: '1' });

      // G1 spanning activity should NOT be cycled (stays at z=0) but IS background
      // because it overlaps with G2 minute range (750 < 960, 870 > 780)
      expect(g1Card).toHaveStyle({ opacity: '0.3' });
    });

    it('does not show badge for single-activity group', () => {
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={[timeGroupActivities[2]]} // Only G2 activity
          masters={MOCK_MASTERS}
        />,
      );

      // No badge should appear
      const badges = screen.queryAllByRole('button', { name: /cards/i });
      expect(badges).toHaveLength(0);
    });

    // ─── Issue 1: Reset activeGroupId ────────────────────────────────────

    it('resets activeGroupId after 1 second timeout', async () => {
      vi.useFakeTimers();
      try {
        render(
          <DayColumn
            dayIndex={0}
            date={new Date()}
            activities={timeGroupActivities}
            masters={MOCK_MASTERS}
          />,
        );

        const card3 = screen.getByTestId('activity-tg_a3');

        // Scroll in G1 → G1 active
        await act(async () => {
          const column = screen.getByTestId('day-column-0');
          column.getBoundingClientRect = vi.fn(() => ({
            top: 0, left: 0, width: 200, height: 1440,
            bottom: 1440, right: 200, x: 0, y: 0, toJSON: () => {},
          }));
          const wheelEvent = new WheelEvent('wheel', {
            deltaY: 100,
            clientY: 120,
            bubbles: true,
          });
          column.dispatchEvent(wheelEvent);
        });

        // After scroll: activeGroupId is set, but G2 activity at 14:00
        // doesn't overlap with G1 time range so it stays at opacity 1

        // Advance timers by 1 second — activeGroupId should reset
        act(() => {
          vi.advanceTimersByTime(1100);
        });

        // After timeout: activeGroupId is null, all groups render normally
        expect(card3).toHaveStyle({ opacity: '1' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('resets activeGroupId on mouseleave', async () => {
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={timeGroupActivities}
          masters={MOCK_MASTERS}
        />,
      );

      const card1 = screen.getByTestId('activity-tg_a1');
      const card2 = screen.getByTestId('activity-tg_a2');

      // Scroll in G1 → G1 active → cycle cards
      await act(async () => {
        const column = screen.getByTestId('day-column-0');
        column.getBoundingClientRect = vi.fn(() => ({
          top: 0, left: 0, width: 200, height: 1440,
          bottom: 1440, right: 200, x: 0, y: 0, toJSON: () => {},
        }));
        const wheelEvent = new WheelEvent('wheel', {
          deltaY: 100,
          clientY: 120,
          bubbles: true,
        });
        column.dispatchEvent(wheelEvent);
      });

      // After cycling: card1 is behind, card2 is front
      expect(card1).toHaveStyle({ opacity: '0.85' });
      expect(card2).toHaveStyle({ opacity: '1' });

      // Mouseleave on column — resets activeGroupId
      await act(async () => {
        const column = screen.getByTestId('day-column-0');
        fireEvent.mouseLeave(column);
      });

      // After mouseleave: activeGroupId is null, but z-indices persist.
      // card1 (z=1) still has carousel dimming, card2 (z=0) is front.
      // No "background" dimming on other groups since activeGroupId is null.
      expect(card1).toHaveStyle({ opacity: '0.85' });
      expect(card2).toHaveStyle({ opacity: '1' });
    });

    // ─── Issue 2: Background only shows overlapping activities ────────────

    it('non-overlapping activity from different group is NOT background', async () => {
      // G1: 2 activities at 10:00, G2: 1 activity at 14:00
      // When G1 is active, G2 activity at 14:00 (840) does NOT overlap with G1 minute range (540-780)
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={timeGroupActivities}
          masters={MOCK_MASTERS}
        />,
      );

      const card3 = screen.getByTestId('activity-tg_a3');

      // Scroll in G1
      await act(async () => {
        const column = screen.getByTestId('day-column-0');
        column.getBoundingClientRect = vi.fn(() => ({
          top: 0, left: 0, width: 200, height: 1440,
          bottom: 1440, right: 200, x: 0, y: 0, toJSON: () => {},
        }));
        const wheelEvent = new WheelEvent('wheel', {
          deltaY: 100,
          clientY: 120, // cursorMinutes ≈ 600 (10:00) → G1
          bubbles: true,
        });
        column.dispatchEvent(wheelEvent);
      });

      // G2 activity at 14:00 (actStart=14) does NOT overlap with G1 (end=13)
      // So it should NOT be background
      expect(card3).toHaveStyle({ opacity: '1' });
    });

    it('activity spanning group boundary IS background when overlapping group is active', async () => {
      // Activity at 750/12:30 (G1), duration 36min → ends 786/13:06, just past G1 boundary (780)
      // Second G1 activity at 10h for carousel cycling
      // G2 has 2 activities → scrolling in G2 activates it
      // G1 activity at 750 should be background because it overlaps with G2 minute range (780-960)
      const crossBoundaryActivities: BridgedActivity[] = [
        makeAct({
          id: 'cb_a1',
          masterId: 'm1',
          startMinutes: 600,
          durationMinutes: 60,
          serviceId: 's1',
          serviceName: 'G1 Early',
          occupied: 2,
        }),
        makeAct({
          id: 'cb_a2',
          masterId: 'm2',
          startMinutes: 750,
          durationMinutes: 36, // ends 13:06 — just past the G1 boundary
          serviceId: 's2',
          serviceName: 'Spanning G1',
          occupied: 3,
          capacity: 6,
        }),
        makeAct({
          id: 'cb_a3',
          masterId: 'm3',
          startMinutes: 780,
          durationMinutes: 120,
          serviceId: 's3',
          serviceName: 'G2 Activity A',
          locationId: 'grand',
          occupied: 4,
          capacity: 10,
        }),
        makeAct({
          id: 'cb_a4',
          masterId: 'm1',
          startMinutes: 810,
          durationMinutes: 90,
          serviceId: 's1',
          serviceName: 'G2 Activity B',
          occupied: 5,
        }),
      ];

      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={crossBoundaryActivities}
          masters={MOCK_MASTERS}
        />,
      );

      const spanningCard = screen.getByTestId('activity-cb_a2');

      // Before scroll: cb_a2 is z=1 in G1 carousel (cb_a1 is z=0), so carousel dimming applies
      expect(spanningCard).toHaveStyle({ opacity: '0.85' });

      // Scroll in G2 area (y=540 → time≈13.5, on cb_a4 which is in G2)
      // cb_a2 (G1, 750-786/12:30-13:06) does NOT cover y=540 (its range is [420, 492])
      // so the handler finds cb_a3 or cb_a4 (G2) first
      await act(async () => {
        const column = screen.getByTestId('day-column-0');
        column.getBoundingClientRect = vi.fn(() => ({
          top: 0, left: 0, width: 200, height: 1440,
          bottom: 1440, right: 200, x: 0, y: 0, toJSON: () => {},
        }));
        const wheelEvent = new WheelEvent('wheel', {
          deltaY: 100,
          clientY: 540, // time ≈ 13.5 → G2
          bubbles: true,
        });
        column.dispatchEvent(wheelEvent);
      });

      // cb_a2 (start=750, end=786) overlaps with G2 minute range (780-960)
      // actStart=750 < 960=true, actEnd=786 > 780=true → IS background
      expect(spanningCard).toHaveStyle({ opacity: '0.3' });
    });

    // ─── Issue 3: Badge at group level ───────────────────────────────────

    it('badge is positioned on the topmost card, not at group boundary', () => {
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={timeGroupActivities}
          masters={MOCK_MASTERS}
        />,
      );

      // Badge for G1 group (2 activities) appears on the topmost card (tg_a1)
      const badge = screen.getByRole('button', { name: /2 cards/i });
      expect(badge).toBeInTheDocument();
      // Badge should be positioned at the card's top, not at group boundary
      // tg_a1 starts at 600, gridStartMinutes=540, cellHeight=60: top = (600-540)*60/30+2 = 122px
      expect(badge.style.top).toBe('122px');
    });

    // ─── Issue 4: Separator lines at group boundaries ────────────────────

    it('renders separator lines at group boundaries', () => {
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={[]}
          masters={MOCK_MASTERS}
        />,
      );

      expect(screen.getByTestId('group-boundary-G1')).toBeInTheDocument();
      expect(screen.getByTestId('group-boundary-G2')).toBeInTheDocument();
      expect(screen.getByTestId('group-boundary-G3')).toBeInTheDocument();
    });

    it('separator lines have bolder styling than regular grid lines', () => {
      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={[]}
          masters={MOCK_MASTERS}
        />,
      );

      const boundary = screen.getByTestId('group-boundary-G1');
      // Should have a thicker border than regular lines
      expect(boundary.className).toContain('border-t-2');
    });

    // ─── Auto-promote group by cursor time ───────────────────────────

    it('cursor in G2 time range auto-promotes G2 to active', async () => {
      // G1 has 2 overlapping activities (multi), G2 has 1 solo activity
      // Without scrolling, G1 is frontmost and hides G2
      // When cursor moves to G2 time range (13:00+), G2 auto-promotes
      const autoPromoteActivities: BridgedActivity[] = [
        makeAct({
          id: 'ap_g1a',
          masterId: 'm1',
          startMinutes: 600,
          durationMinutes: 120,
          serviceId: 's1',
          serviceName: 'G1 Activity A',
          occupied: 3,
        }),
        makeAct({
          id: 'ap_g1b',
          masterId: 'm2',
          startMinutes: 630,
          durationMinutes: 90,
          serviceId: 's2',
          serviceName: 'G1 Activity B',
          occupied: 4,
          capacity: 6,
        }),
        makeAct({
          id: 'ap_g2',
          masterId: 'm3',
          startMinutes: 780,
          durationMinutes: 150,
          serviceId: 's3',
          serviceName: 'G2 Solo Activity',
          locationId: 'grand',
          occupied: 5,
          capacity: 10,
        }),
      ];

      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={autoPromoteActivities}
          masters={MOCK_MASTERS}
        />,
      );

      const g1CardA = screen.getByTestId('activity-ap_g1a');
      const g1CardB = screen.getByTestId('activity-ap_g1b');
      const g2Card = screen.getByTestId('activity-ap_g2');

      // Before cursor interaction: G1 has carousel (2 activities), G2 is solo
      expect(g1CardA).toHaveStyle({ opacity: '1' });
      expect(g1CardB).toHaveStyle({ opacity: '0.85' });
      expect(g2Card).toHaveStyle({ opacity: '1' });

      // Mouse move to G2 time range (y=480 → cursorMinutes = 540 + 480/(60/30) = 780 (13:00) → G2)
      await act(async () => {
        const column = screen.getByTestId('day-column-0');
        column.getBoundingClientRect = vi.fn(() => ({
          top: 0, left: 0, width: 200, height: 1440,
          bottom: 1440, right: 200, x: 0, y: 0, toJSON: () => {},
        }));
        const mouseEvent = new MouseEvent('mousemove', {
          clientY: 480, // time = 13.0 → G2
          bubbles: true,
        });
        column.dispatchEvent(mouseEvent);
      });

      // G2 should be auto-promoted (active), G1 should go to background
      // G1 activities overlap with G2 minute range (600-720 < 960, 630-750 vs 780 → depends)
      // ap_g1a: 600-720, ap_g1b: 630-720. Neither overlaps G2 (780-960) → NOT background
      // But G2 is now active → G1 activities that overlap G2 time range become background
      // Actually: ap_g1a ends at 12, G2 starts at 13 → no overlap → NOT background
      // The key thing: G2 is active and visible
      expect(g2Card).toHaveStyle({ opacity: '1' });
    });

    it('G1 goes to background when cursor in G2 and G1 overlaps G2 time range', async () => {
      // G1 activity spanning into G2 (12:30-14:30) + G2 solo (13:00-15:30)
      // When cursor moves to G2, G1 spanning becomes background
      const overlapActivities: BridgedActivity[] = [
        makeAct({
          id: 'ob_g1',
          masterId: 'm1',
          startMinutes: 750,
          durationMinutes: 120,
          serviceId: 's1',
          serviceName: 'G1 Spanning',
          occupied: 3,
        }),
        makeAct({
          id: 'ob_g2',
          masterId: 'm3',
          startMinutes: 780,
          durationMinutes: 150,
          serviceId: 's3',
          serviceName: 'G2 Solo',
          locationId: 'grand',
          occupied: 5,
          capacity: 10,
        }),
      ];

      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={overlapActivities}
          masters={MOCK_MASTERS}
        />,
      );

      const g1Card = screen.getByTestId('activity-ob_g1');
      const g2Card = screen.getByTestId('activity-ob_g2');

      // Before cursor: both solo (1 per group), full opacity
      expect(g1Card).toHaveStyle({ opacity: '1' });
      expect(g2Card).toHaveStyle({ opacity: '1' });

      // Mouse move to G2 time range — cursor at y=700 (time≈14.8) where ONLY G2 card overlaps.
      // ob_g1 (G1): top=420, height=240 → bottom=660. At y=700, ob_g1 does NOT overlap.
      // ob_g2 (G2): top=480, height=300 → bottom=780. At y=700, ob_g2 DOES overlap.
      // So mousemove handler picks ob_g2's group (G2) as activeGroupId.
      await act(async () => {
        const column = screen.getByTestId('day-column-0');
        column.getBoundingClientRect = vi.fn(() => ({
          top: 0, left: 0, width: 200, height: 1440,
          bottom: 1440, right: 200, x: 0, y: 0, toJSON: () => {},
        }));
        const mouseEvent = new MouseEvent('mousemove', {
          clientY: 700, // time ≈ 14.8 → G2 range, only G2 card visually overlaps
          bubbles: true,
        });
        column.dispatchEvent(mouseEvent);
      });

      // G2 is active, G1 spanning (750-870) overlaps G2 (780-960) → background
      expect(g1Card).toHaveStyle({ opacity: '0.3' });
      expect(g2Card).toHaveStyle({ opacity: '1' });
    });

    it('cursor in G1 time range keeps G1 active and G2 solo stays visible', async () => {
      const cursorG1Activities: BridgedActivity[] = [
        makeAct({
          id: 'cg_g1a',
          masterId: 'm1',
          startMinutes: 600,
          durationMinutes: 120,
          serviceId: 's1',
          serviceName: 'G1 Activity A',
          occupied: 3,
        }),
        makeAct({
          id: 'cg_g1b',
          masterId: 'm2',
          startMinutes: 630,
          durationMinutes: 90,
          serviceId: 's2',
          serviceName: 'G1 Activity B',
          occupied: 4,
          capacity: 6,
        }),
        makeAct({
          id: 'cg_g2',
          masterId: 'm3',
          startMinutes: 840,
          durationMinutes: 120,
          serviceId: 's3',
          serviceName: 'G2 Solo',
          locationId: 'grand',
          occupied: 5,
          capacity: 10,
        }),
      ];

      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={cursorG1Activities}
          masters={MOCK_MASTERS}
        />,
      );

      const g1CardA = screen.getByTestId('activity-cg_g1a');
      const g1CardB = screen.getByTestId('activity-cg_g1b');
      const g2Card = screen.getByTestId('activity-cg_g2');

      // Before: G1 has carousel (2 activities), G2 solo
      expect(g1CardA).toHaveStyle({ opacity: '1' });
      expect(g1CardB).toHaveStyle({ opacity: '0.85' });
      expect(g2Card).toHaveStyle({ opacity: '1' });

      // Mouse move to G1 minute range (y=120 → cursorMinutes≈600/10:00 → G1)
      await act(async () => {
        const column = screen.getByTestId('day-column-0');
        column.getBoundingClientRect = vi.fn(() => ({
          top: 0, left: 0, width: 200, height: 1440,
          bottom: 1440, right: 200, x: 0, y: 0, toJSON: () => {},
        }));
        const mouseEvent = new MouseEvent('mousemove', {
          clientY: 120, // cursorMinutes ≈ 600 (10:00) → G1
          bubbles: true,
        });
        column.dispatchEvent(mouseEvent);
      });

      // G1 is active, G2 solo at 14:00 (840) does NOT overlap G1 minute range (540-780)
      // so G2 should NOT be background
      expect(g2Card).toHaveStyle({ opacity: '1' });
      expect(g1CardA).toHaveStyle({ opacity: '1' });
    });

    it('mouseLeave resets activeGroupId after cursor auto-promotes', async () => {
      const resetActivities: BridgedActivity[] = [
        makeAct({
          id: 'r_g1a',
          masterId: 'm1',
          startMinutes: 600,
          durationMinutes: 120,
          serviceId: 's1',
          serviceName: 'G1 Activity A',
          occupied: 3,
        }),
        makeAct({
          id: 'r_g1b',
          masterId: 'm2',
          startMinutes: 630,
          durationMinutes: 90,
          serviceId: 's2',
          serviceName: 'G1 Activity B',
          occupied: 4,
          capacity: 6,
        }),
        makeAct({
          id: 'r_g2',
          masterId: 'm3',
          startMinutes: 780,
          durationMinutes: 120,
          serviceId: 's3',
          serviceName: 'G2 Solo',
          locationId: 'grand',
          occupied: 5,
          capacity: 10,
        }),
      ];

      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={resetActivities}
          masters={MOCK_MASTERS}
        />,
      );

      const g1CardA = screen.getByTestId('activity-r_g1a');
      const g2Card = screen.getByTestId('activity-r_g2');

      // Mouse to G2 area (y=480 → cursorMinutes=780/13:00 → G2)
      await act(async () => {
        const column = screen.getByTestId('day-column-0');
        column.getBoundingClientRect = vi.fn(() => ({
          top: 0, left: 0, width: 200, height: 1440,
          bottom: 1440, right: 200, x: 0, y: 0, toJSON: () => {},
        }));
        const mouseEvent = new MouseEvent('mousemove', {
          clientY: 480,
          bubbles: true,
        });
        column.dispatchEvent(mouseEvent);
      });

      // G2 active — check state
      expect(g2Card).toHaveStyle({ opacity: '1' });

      // Now mouseLeave → activeGroupId resets
      await act(async () => {
        const column = screen.getByTestId('day-column-0');
        fireEvent.mouseLeave(column);
      });

      // After mouseleave: no active group, both groups render normally
      // G1 a1 still z=0, a2 z=1 (carousel persists), G2 solo z=0
      expect(g1CardA).toHaveStyle({ opacity: '1' });
      expect(g2Card).toHaveStyle({ opacity: '1' });
    });

    // ─── Cursor-based cross-group cycling ──────────────────────────────

    it('G2 single (15:30-17:00) + G3 single (16:00-18:00) cycle together at 16:00', async () => {
      // G2: 13:00–15:59, G3: 16:00–23:59
      // Activity G2a: starts 930/15:30 (in G2), duration 90min → ends 1020/17:00 → visually at y=780..960
      // Activity G3a: starts 960/16:00 (in G3), duration 120min → ends 1080/18:00 → visually at y=840..1080
      // They visually overlap at y=840..960
      const crossGroupSingles: BridgedActivity[] = [
        makeAct({
          id: 'cs_g2',
          masterId: 'm1',
          startMinutes: 930, // 15:30 (in G2)
          durationMinutes: 90, // ends 17:00
          serviceId: 's1',
          serviceName: 'G2 Late Activity',
          occupied: 3,
        }),
        makeAct({
          id: 'cs_g3',
          masterId: 'm2',
          startMinutes: 960, // 16:00 (in G3)
          durationMinutes: 120, // ends 18:00
          serviceId: 's2',
          serviceName: 'G3 Early Activity',
          occupied: 4,
          capacity: 6,
        }),
      ];

      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={crossGroupSingles}
          masters={MOCK_MASTERS}
        />,
      );

      const cardG2 = screen.getByTestId('activity-cs_g2');
      const cardG3 = screen.getByTestId('activity-cs_g3');

      // Initially both in different groups (alone) → z=0 → full opacity
      expect(cardG2).toHaveStyle({ opacity: '1' });
      expect(cardG3).toHaveStyle({ opacity: '1' });

      // Wheel at y=900 → time≈16.5, where BOTH cards visually overlap
      await act(async () => {
        const column = screen.getByTestId('day-column-0');
        column.getBoundingClientRect = vi.fn(() => ({
          top: 0, left: 0, width: 200, height: 1440,
          bottom: 1440, right: 200, x: 0, y: 0, toJSON: () => {},
        }));
        const wheelEvent = new WheelEvent('wheel', {
          deltaY: 100,
          clientY: 900, // time ≈ 16.5 — in overlap zone
          bubbles: true,
        });
        column.dispatchEvent(wheelEvent);
      });

      // After cycling: sorted by startMinutes: cs_g2 (930) first → z=1, cs_g3 (960) second → z=0
      expect(cardG2).toHaveStyle({ opacity: '0.85' });
      expect(cardG3).toHaveStyle({ opacity: '1' });
    });

    it('sets primary group active when cycling cross-group overlapping activities', async () => {
      // G2 has 2 activities, G3 has 1 — G2 is primary (most cards)
      // When G2 is set as active, G1 activities that visually overlap G2 time range
      // should become background (opacity 0.3)
      const multiGroupActivities: BridgedActivity[] = [
        makeAct({
          id: 'mg_g1',
          masterId: 'm1',
          startMinutes: 750, // 12:30 — G1, spans into G2
          durationMinutes: 120,
          serviceId: 's1',
          serviceName: 'G1 Spanning',
          occupied: 3,
        }),
        makeAct({
          id: 'mg_g2a',
          masterId: 'm2',
          startMinutes: 840, // 14:00 — G2
          durationMinutes: 120,
          serviceId: 's2',
          serviceName: 'G2 Activity A',
          occupied: 4,
          capacity: 6,
        }),
        makeAct({
          id: 'mg_g2b',
          masterId: 'm3',
          startMinutes: 900, // 15:00 — G2
          durationMinutes: 90,
          serviceId: 's3',
          serviceName: 'G2 Activity B',
          locationId: 'grand',
          occupied: 5,
          capacity: 10,
        }),
      ];

      render(
        <DayColumn
          dayIndex={0}
          date={new Date()}
          activities={multiGroupActivities}
          masters={MOCK_MASTERS}
        />,
      );

      const g1Card = screen.getByTestId('activity-mg_g1');

      // Before scroll: G1 card is in its own group (alone) → full opacity
      expect(g1Card).toHaveStyle({ opacity: '1' });

      // Wheel at y=720 → time≈15, overlapping mg_g2a and mg_g2b (both G2)
      // Primary group = G2 (2 cards vs 0 in cursor overlap for others)
      await act(async () => {
        const column = screen.getByTestId('day-column-0');
        column.getBoundingClientRect = vi.fn(() => ({
          top: 0, left: 0, width: 200, height: 1440,
          bottom: 1440, right: 200, x: 0, y: 0, toJSON: () => {},
        }));
        const wheelEvent = new WheelEvent('wheel', {
          deltaY: 100,
          clientY: 720, // time ≈ 15
          bubbles: true,
        });
        column.dispatchEvent(wheelEvent);
      });

      // G1 card (750–870) overlaps with G2 minute range (780–960) → should be background
      expect(g1Card).toHaveStyle({ opacity: '0.3' });
    });
  });
});
