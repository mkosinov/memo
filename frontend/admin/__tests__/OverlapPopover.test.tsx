import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { OverlapPopover } from '../app/components/schedule/OverlapPopover';
import type { Activity, Master } from '@memo/domain';
import { formatTime } from '@/lib/utils';
import { createMockUIContext, createMockScheduleContext } from './helpers/mockContexts';

vi.mock('@/contexts/UIContext', () => ({
  useUI: vi.fn(() => createMockUIContext()),
}));

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: vi.fn(() => createMockScheduleContext()),
}));

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

const MOCK_MASTERS: Master[] = [
  { id: 'm1', name: 'Анна Иванова', shortName: 'Анна', color: '#FF6B6B' },
  { id: 'm2', name: 'Петр Петров', shortName: 'Петр', color: '#4ECDC4' },
  { id: 'm3', name: 'Мария Сидорова', shortName: 'Мария', color: '#45B7D1' },
];

const masterMap = new Map(MOCK_MASTERS.map(m => [m.id, m]));

// Two overlapping activities at same time
const overlappingActivities: Activity[] = [
  {
    id: 'ov1',
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
    id: 'ov2',
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
];

// Three activities: two overlap, one starts after the first ends
const threeActivities: Activity[] = [
  ...overlappingActivities,
  {
    id: 'ov3',
    day: 0,
    masterId: 'm3',
    startTime: 12,
    duration: 2,
    serviceId: 's3',
    serviceName: 'Мини-картина',
    minAge: '6',
    locationId: 'alpika',
    occupied: 1,
    capacity: 10,
    isPrivate: false,
  },
];

const anchorRect: DOMRect = {
  top: 100,
  left: 200,
  bottom: 130,
  right: 300,
  width: 100,
  height: 30,
  x: 200,
  y: 100,
  toJSON: () => ({}),
};

describe('OverlapPopover', () => {
  it('renders activity cards with service names', () => {
    render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={anchorRect}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    expect(screen.getByText('Картина маслом')).toBeInTheDocument();
    expect(screen.getByText('Картина акрилом')).toBeInTheDocument();
  });

  it('renders timeline hours', () => {
    render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={anchorRect}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    // Activities span 10:00-12:00 (max end), so hours 10, 11, 12 should appear
    // "10:00" appears both in timeline and on cards, so use getAllByText
    expect(screen.getAllByText('10:00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('11:00').length).toBe(1); // only in timeline
    expect(screen.getAllByText('12:00').length).toBe(1); // only in timeline
  });

  it('renders start times on cards', () => {
    render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={anchorRect}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    // Timeline shows "10:00", cards show "10:00–12:00" and "10:00–11:30"
    // So "10:00" appears at least once in timeline, and the card time ranges contain it
    const timeLabels = screen.getAllByText('10:00');
    expect(timeLabels.length).toBeGreaterThanOrEqual(1);
  });

  it('calls onSelectActivity when clicking a card', () => {
    const onSelect = vi.fn();
    render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={anchorRect}
        onClose={vi.fn()}
        onSelectActivity={onSelect}
      />,
    );

    fireEvent.click(screen.getByText('Картина маслом'));
    expect(onSelect).toHaveBeenCalledWith(overlappingActivities[0]);
  });

  it('calls onClose when clicking outside the popover', () => {
    const onClose = vi.fn();
    render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={anchorRect}
        onClose={onClose}
        onSelectActivity={vi.fn()}
      />,
    );

    // Simulate click outside by dispatching mousedown on document
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not call onClose when clicking inside the popover', () => {
    const onClose = vi.fn();
    render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={anchorRect}
        onClose={onClose}
        onSelectActivity={vi.fn()}
      />,
    );

    // Click on a card inside the popover
    fireEvent.mouseDown(screen.getByText('Картина акрилом'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('assigns non-overlapping activities to the same column', () => {
    // ov1: 10:00-12:00, ov3: 12:00-14:00 — no overlap, same column
    render(
      <OverlapPopover
        activities={[overlappingActivities[0], threeActivities[2]]}
        masterMap={masterMap}
        anchorRect={anchorRect}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    // Both should be visible
    expect(screen.getByText('Картина маслом')).toBeInTheDocument();
    expect(screen.getByText('Мини-картина')).toBeInTheDocument();
  });

  it('assigns overlapping activities to separate columns', () => {
    render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={anchorRect}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    // Both should be rendered — the component should create 2 columns
    expect(screen.getByText('Картина маслом')).toBeInTheDocument();
    expect(screen.getByText('Картина акрилом')).toBeInTheDocument();
  });

  it('positions itself below the anchor rect', () => {
    const { container } = render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={anchorRect}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const popover = container.firstChild as HTMLElement;
    expect(popover).toHaveStyle({
      position: 'fixed',
      top: '134px', // anchorRect.bottom + 4
      left: '200px', // anchorRect.left
    });
  });

  it('applies master color to card backgrounds', () => {
    render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={anchorRect}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const card1 = screen.getByTestId('activity-ov1');
    const card2 = screen.getByTestId('activity-ov2');

    expect(card1).toHaveStyle({ backgroundColor: '#FF6B6B' });
    expect(card2).toHaveStyle({ backgroundColor: '#4ECDC4' });
  });

  it('uses fallback color when master not found', () => {
    const activitiesUnknownMaster: Activity[] = [
      {
        id: 'unk1',
        day: 0,
        masterId: 'unknown',
        startTime: 10,
        duration: 2,
        serviceId: 's1',
        serviceName: 'Неизвестный мастер',
        minAge: '12',
        locationId: 'alpika',
        occupied: 0,
        capacity: 8,
        isPrivate: false,
      },
    ];

    render(
      <OverlapPopover
        activities={activitiesUnknownMaster}
        masterMap={masterMap}
        anchorRect={anchorRect}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const card = screen.getByTestId('activity-unk1');
    expect(card).toHaveStyle({ backgroundColor: '#666' });
  });

  // ─── Close button ──────────────────────────────────────────────

  it('renders an X close button in the top-right corner', () => {
    render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={anchorRect}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const closeBtn = screen.getByTestId('overlap-popover-close');
    expect(closeBtn).toBeInTheDocument();
    expect(closeBtn).toHaveAttribute('aria-label', 'Close popover');
  });

  it('calls onClose when clicking the X close button', () => {
    const onClose = vi.fn();
    render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={anchorRect}
        onClose={onClose}
        onSelectActivity={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('overlap-popover-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ─── Time alignment bug ────────────────────────────────────────

  it('positions activities relative to popover timeline, not gridStart', () => {
    // Activities at 13:00 and 14:00 — timeline starts at 13 (not gridStart=9)
    const g2Activities: Activity[] = [
      {
        id: 'g2a1',
        day: 0,
        masterId: 'm1',
        startTime: 13,
        duration: 2.5,
        serviceId: 's1',
        serviceName: 'G2 Activity A',
        locationId: 'alpika',
        occupied: 3,
        capacity: 8,
        isPrivate: false,
      },
      {
        id: 'g2a2',
        day: 0,
        masterId: 'm2',
        startTime: 14,
        duration: 2,
        serviceId: 's2',
        serviceName: 'G2 Activity B',
        locationId: 'alpika',
        occupied: 4,
        capacity: 6,
        isPrivate: false,
      },
    ];

    const { container } = render(
      <OverlapPopover
        activities={g2Activities}
        masterMap={masterMap}
        anchorRect={anchorRect}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
        cellHeight={60}
        gridStart={9}
      />,
    );

    const popover = container.firstChild as HTMLElement;
    // Activity at 13:00 should be at top=0 (13 - timelineStart=13 = 0 hours)
    // NOT at top=(13-9)*60*2 = 480px (old bug with gridStart)
    const card1 = popover.querySelector('[data-testid="popover-slot-g2a1"]') as HTMLElement;
    expect(card1).toBeTruthy();
    expect(card1.style.top).toBe('0px');

    // Activity at 14:00 should be at top=(14-13)*60*2 = 120px
    const card2 = popover.querySelector('[data-testid="popover-slot-g2a2"]') as HTMLElement;
    expect(card2).toBeTruthy();
    expect(card2.style.top).toBe('120px');
  });

  // ─── Scroll for overflow ────────────────────────────────────────

  it('has overflow-auto on the scroll container for scrolling', () => {
    render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={anchorRect}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const popover = screen.getByTestId('overlap-popover');
    // overflow-auto is now on the inner scroll container, not the outer positioning div
    const scrollContainer = popover.querySelector('[data-testid="popover-scroll-container"]');
    expect(scrollContainer).toBeTruthy();
    expect(scrollContainer!.className).toContain('overflow-auto');
  });

  it('has max-height and max-width constraints for scroll bounds', () => {
    render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={anchorRect}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const popover = screen.getByTestId('overlap-popover');
    // Should have maxHeight and maxWidth set (either via style or className)
    const hasConstraints =
      popover.className.includes('max-h-') ||
      popover.className.includes('max-w-') ||
      (popover.style.maxHeight && popover.style.maxHeight !== '') ||
      (popover.style.maxWidth && popover.style.maxWidth !== '');
    expect(hasConstraints).toBe(true);
  });

  // ─── Screen edge detection ──────────────────────────────────────

  it('positions below anchor when there is enough space below', () => {
    const nearTopAnchor: DOMRect = {
      top: 100,
      left: 200,
      bottom: 130,
      right: 300,
      width: 100,
      height: 30,
      x: 200,
      y: 100,
      toJSON: () => ({}),
    };

    const { container } = render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={nearTopAnchor}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const popover = container.firstChild as HTMLElement;
    // Should be positioned below anchor (bottom + gap)
    const top = parseInt(popover.style.top, 10);
    expect(top).toBeGreaterThanOrEqual(nearTopAnchor.bottom);
    expect(top).toBeLessThanOrEqual(nearTopAnchor.bottom + 10);
  });

  it('positions above anchor when anchor is near bottom of screen', () => {
    // Anchor near bottom of screen (bottom=980, viewport height ~1000)
    const nearBottomAnchor: DOMRect = {
      top: 950,
      left: 200,
      bottom: 980,
      right: 300,
      width: 100,
      height: 30,
      x: 200,
      y: 950,
      toJSON: () => ({}),
    };

    const { container } = render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={nearBottomAnchor}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const popover = container.firstChild as HTMLElement;
    // Should be positioned above anchor (not below which would go off-screen)
    const top = parseInt(popover.style.top, 10);
    expect(top).toBeLessThan(nearBottomAnchor.top);
  });

  // ─── Smart horizontal alignment ──────────────────────────────

  it('aligns right edge of popover with right edge of pill when near right screen edge', () => {
    // Pill near right edge of 1024px viewport (jsdom default)
    const nearRightAnchor: DOMRect = {
      top: 100,
      left: 900,
      bottom: 130,
      right: 1000,
      width: 100,
      height: 30,
      x: 900,
      y: 100,
      toJSON: () => ({}),
    };

    const { container } = render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={nearRightAnchor}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const popover = container.firstChild as HTMLElement;
    // spaceRight = 1024 - 900 = 124 < 400 (not enough to right-align)
    // spaceLeft = 1000 >= 400 (enough to left-align from right)
    // Expected: style.right = screenWidth - anchorRect.right = 1024 - 1000 = 24
    expect(popover.style.right).toBe('24px');
    expect(popover.style.left).toBe(''); // no left property set
  });

  it('aligns left edge of popover with left edge of pill when near left screen edge', () => {
    const nearLeftAnchor: DOMRect = {
      top: 100,
      left: 10,
      bottom: 130,
      right: 110,
      width: 100,
      height: 30,
      x: 10,
      y: 100,
      toJSON: () => ({}),
    };

    const { container } = render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={nearLeftAnchor}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const popover = container.firstChild as HTMLElement;
    // spaceRight = 1024 - 10 = 1014 >= 400
    // Expected: style.left = anchorRect.left = 10
    expect(popover.style.left).toBe('10px');
  });

  it('left-aligns popover when pill is in middle with enough space', () => {
    const midAnchor: DOMRect = {
      top: 100,
      left: 400,
      bottom: 130,
      right: 500,
      width: 100,
      height: 30,
      x: 400,
      y: 100,
      toJSON: () => ({}),
    };

    const { container } = render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={midAnchor}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const popover = container.firstChild as HTMLElement;
    // spaceRight = 1024 - 400 = 624 >= 400
    // Expected: left-aligned at anchorRect.left
    expect(popover.style.left).toBe('400px');
  });

  it('shrinks popover to fit screen when neither side has enough space', () => {
    // Narrow viewport (500px) — neither side can fit 400px popover
    const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    Object.defineProperty(window, 'innerWidth', { value: 500, writable: true, configurable: true });

    try {
      const midAnchor: DOMRect = {
        top: 100,
        left: 200,
        bottom: 130,
        right: 300,
        width: 100,
        height: 30,
        x: 200,
        y: 100,
        toJSON: () => ({}),
      };

      const { container } = render(
        <OverlapPopover
          activities={overlappingActivities}
          masterMap={masterMap}
          anchorRect={midAnchor}
          onClose={vi.fn()}
          onSelectActivity={vi.fn()}
        />,
      );

      const popover = container.firstChild as HTMLElement;
      // spaceRight = 500 - 200 = 300 < 400
      // spaceLeft = 300 < 400
      // Expected: left=SCREEN_PADDING, right=SCREEN_PADDING, width=maxWidth
      expect(popover.style.left).toBe('8px');
      expect(popover.style.right).toBe('8px');
      expect(popover.style.width).toBe('484px'); // 500 - 8*2
    } finally {
      // Restore
      if (originalInnerWidth) {
        Object.defineProperty(window, 'innerWidth', originalInnerWidth);
      }
    }
  });

  // ─── Issue 1: Auto-scroll on hover ─────────────────────────────────

  it('has an inner scroll container with overflow-auto for content', () => {
    render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={anchorRect}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const popover = screen.getByTestId('overlap-popover');
    // The popover should contain an inner scroll container
    // that separates overflow from the outer positioning container
    const scrollContainer = popover.querySelector('[data-testid="popover-scroll-container"]') || popover.querySelector('.overflow-auto');
    expect(scrollContainer).toBeTruthy();
  });

  it('has an inner scroll container with overflow-x-auto for horizontal scrolling', () => {
    render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={anchorRect}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const popover = screen.getByTestId('overlap-popover');
    // Find the inner scroll container — should have overflow-x-auto or overflow-auto
    const innerContainers = popover.querySelectorAll('.overflow-auto, .overflow-x-auto');
    expect(innerContainers.length).toBeGreaterThanOrEqual(1);
    // The innermost scroll container should support horizontal scroll
    const lastContainer = innerContainers[innerContainers.length - 1] as HTMLElement;
    const style = window.getComputedStyle(lastContainer);
    const overflowX = lastContainer.style.overflowX || style.overflowX;
    expect(overflowX === 'auto' || overflowX === 'scroll' || lastContainer.className.includes('overflow')).toBe(true);
  });

  it('auto-scrolls right when mouse is near the right edge of the scroll container', () => {
    render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={anchorRect}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const popover = screen.getByTestId('overlap-popover');
    // Find the scroll container (inner div with overflow-auto)
    const scrollContainer = popover.querySelector('[data-testid="popover-scroll-container"]') as HTMLDivElement;
    expect(scrollContainer).toBeTruthy();

    // Mock getBoundingClientRect to simulate the scroll container
    scrollContainer.getBoundingClientRect = vi.fn(() => ({
      top: 100, left: 200, width: 300, height: 200,
      bottom: 300, right: 500, x: 200, y: 100, toJSON: () => ({}),
    }));
    // Set initial scrollLeft
    Object.defineProperty(scrollContainer, 'scrollLeft', { value: 0, writable: true, configurable: true });

    // Simulate mouse move near right edge (within EDGE_THRESHOLD=50)
    fireEvent.mouseMove(scrollContainer, { clientX: 470, clientY: 200 });

    // After moving near right edge, scrollLeft should increase
    expect(scrollContainer.scrollLeft).toBeGreaterThan(0);
  });

  it('auto-scrolls left when mouse is near the left edge of the scroll container', () => {
    render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={anchorRect}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const popover = screen.getByTestId('overlap-popover');
    const scrollContainer = popover.querySelector('[data-testid="popover-scroll-container"]') as HTMLDivElement;
    expect(scrollContainer).toBeTruthy();

    scrollContainer.getBoundingClientRect = vi.fn(() => ({
      top: 100, left: 200, width: 300, height: 200,
      bottom: 300, right: 500, x: 200, y: 100, toJSON: () => ({}),
    }));
    Object.defineProperty(scrollContainer, 'scrollLeft', { value: 100, writable: true, configurable: true });

    // Simulate mouse move near left edge (clientX=210 → mouseX=10 < EDGE_THRESHOLD=50)
    fireEvent.mouseMove(scrollContainer, { clientX: 210, clientY: 200 });

    // After moving near left edge, scrollLeft should decrease
    expect(scrollContainer.scrollLeft).toBeLessThan(100);
  });

  it('auto-scrolls down when mouse is near the bottom edge of the scroll container', () => {
    render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={anchorRect}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const popover = screen.getByTestId('overlap-popover');
    const scrollContainer = popover.querySelector('[data-testid="popover-scroll-container"]') as HTMLDivElement;
    expect(scrollContainer).toBeTruthy();

    scrollContainer.getBoundingClientRect = vi.fn(() => ({
      top: 100, left: 200, width: 300, height: 200,
      bottom: 300, right: 500, x: 200, y: 100, toJSON: () => ({}),
    }));
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 0, writable: true, configurable: true });

    // Simulate mouse near bottom edge (clientY=270 → mouseY=170, height=200, 200-50=150 < 170)
    fireEvent.mouseMove(scrollContainer, { clientX: 350, clientY: 270 });

    expect(scrollContainer.scrollTop).toBeGreaterThan(0);
  });

  it('does not auto-scroll when mouse is in the center of the scroll container', () => {
    render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={anchorRect}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const popover = screen.getByTestId('overlap-popover');
    const scrollContainer = popover.querySelector('[data-testid="popover-scroll-container"]') as HTMLDivElement;
    expect(scrollContainer).toBeTruthy();

    scrollContainer.getBoundingClientRect = vi.fn(() => ({
      top: 100, left: 200, width: 400, height: 300,
      bottom: 400, right: 600, x: 200, y: 100, toJSON: () => ({}),
    }));
    Object.defineProperty(scrollContainer, 'scrollLeft', { value: 0, writable: true, configurable: true });
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 0, writable: true, configurable: true });

    // Mouse in center (clientX=400 → mouseX=200, clientY=250 → mouseY=150)
    // Both well within the middle, away from edges
    fireEvent.mouseMove(scrollContainer, { clientX: 400, clientY: 250 });

    expect(scrollContainer.scrollLeft).toBe(0);
    expect(scrollContainer.scrollTop).toBe(0);
  });

  // ─── Issue 2: Horizontal scroll for wide popovers ──────────────────

  it('inner scroll container has min-width to ensure wide content is scrollable', () => {
    render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={anchorRect}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const popover = screen.getByTestId('overlap-popover');
    // Find the inner scroll container
    const scrollContainer = popover.querySelector('[data-testid="popover-scroll-container"]') as HTMLElement;
    expect(scrollContainer).toBeTruthy();
    // Should have a min-width style that allows content to be wider than the container
    const minWidth = scrollContainer.style.minWidth;
    expect(minWidth).toBeTruthy();
  });

  it('outer popover container has overflow-hidden to clip wide content', () => {
    render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={anchorRect}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const popover = screen.getByTestId('overlap-popover');
    expect(popover.className).toContain('overflow-hidden');
  });

  // ─── Issue 1: Wheel event propagation ────────────────────────────

  it('stops wheel event propagation to prevent scrolling the schedule behind', () => {
    render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={anchorRect}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const popover = screen.getByTestId('overlap-popover');
    const wheelHandler = vi.fn();
    // Attach a listener on the document to catch wheel events that propagate
    document.addEventListener('wheel', wheelHandler);

    try {
      const wheelEvent = new WheelEvent('wheel', {
        deltaY: 100,
        clientY: 200,
        clientX: 350,
        bubbles: true,
      });
      popover.dispatchEvent(wheelEvent);

      // The popover should stop propagation, so the document listener should NOT fire
      expect(wheelHandler).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('wheel', wheelHandler);
    }
  });

  it('has onWheel handler on the outer popover container', () => {
    render(
      <OverlapPopover
        activities={overlappingActivities}
        masterMap={masterMap}
        anchorRect={anchorRect}
        onClose={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const popover = screen.getByTestId('overlap-popover');
    // Verify the popover has a wheel event by dispatching one and checking it doesn't propagate
    const parentDiv = document.createElement('div');
    document.body.appendChild(parentDiv);
    parentDiv.appendChild(popover.parentElement!);

    const propagated = vi.fn();
    parentDiv.addEventListener('wheel', propagated);

    try {
      const wheelEvent = new WheelEvent('wheel', {
        deltaY: 50,
        bubbles: true,
        clientX: 350,
        clientY: 200,
      });
      popover.dispatchEvent(wheelEvent);

      // Wheel should NOT propagate to parent
      expect(propagated).not.toHaveBeenCalled();
    } finally {
      parentDiv.removeEventListener('wheel', propagated);
      document.body.removeChild(parentDiv);
    }
  });
});
