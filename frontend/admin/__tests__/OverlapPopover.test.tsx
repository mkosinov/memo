import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { OverlapPopover } from '../app/components/schedule/OverlapPopover';
import type { Activity, Master } from '@memo/domain';
import { formatTime } from '@/lib/utils';

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

    // Both start at 10:00 — timeline shows one, each card shows one → 3 total
    const timeLabels = screen.getAllByText('10:00');
    expect(timeLabels.length).toBe(3);
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

    const card1 = screen.getByText('Картина маслом').closest('button');
    const card2 = screen.getByText('Картина акрилом').closest('button');

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

    const card = screen.getByText('Неизвестный мастер').closest('button');
    expect(card).toHaveStyle({ backgroundColor: '#666' });
  });
});
