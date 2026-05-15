import { render, screen, fireEvent } from '@testing-library/react';
import { DayColumn } from '../app/components/schedule/DayColumn';
import type { Activity } from '../lib/types';
import { ARTISTS } from '../lib/mock-data';

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
});
