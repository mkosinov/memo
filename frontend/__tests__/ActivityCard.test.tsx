import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ActivityCard } from '../app/components/schedule/ActivityCard';
import { getFillOpacity } from '../lib/utils';
import type { Activity, Artist } from '../lib/types';

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

  it('renders with clipPath when isPrivate is true', () => {
    const privateActivity = { ...mockActivity, isPrivate: true };
    const { container } = render(
      <ActivityCard activity={privateActivity} artist={mockArtist} />
    );
    const card = container.querySelector('[data-testid]');
    expect(card).toHaveStyle({
      clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%)',
    });
  });

  it('does not have clipPath when isPrivate is false', () => {
    const { container } = render(
      <ActivityCard activity={mockActivity} artist={mockArtist} />
    );
    const card = container.querySelector('[data-testid]');
    expect(card).not.toHaveStyle({
      clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%)',
    });
  });

  it('shows extra info (minAge, shortName) when height >= 90px', () => {
    const tallActivity = { ...mockActivity, duration: 2 };
    render(<ActivityCard activity={tallActivity} artist={mockArtist} />);
    expect(screen.getByText('6+')).toBeInTheDocument();
    expect(screen.getByText('Ольга')).toBeInTheDocument();
  });

  it('hides extra info when height < 90px', () => {
    const mediumActivity = { ...mockActivity, duration: 0.5 };
    render(<ActivityCard activity={mediumActivity} artist={mockArtist} />);
    expect(screen.queryByText('6+')).not.toBeInTheDocument();
    expect(screen.queryByText('Ольга')).not.toBeInTheDocument();
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
});

describe('getFillOpacity', () => {
  it('returns valid opacity for normal values', () => {
    expect(getFillOpacity(3, 8)).toBeCloseTo(0.85 - (3 / 8) * 0.55, 5);
  });

  it('clamps to full occupancy when occupied exceeds capacity', () => {
    expect(getFillOpacity(10, 5)).toBeCloseTo(0.85 - 1 * 0.55, 5);
  });

  it('returns default opacity when capacity is 0', () => {
    const result = getFillOpacity(0, 0);
    expect(Number.isNaN(result)).toBe(false);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('returns default opacity when capacity is 0 and occupied > 0', () => {
    const result = getFillOpacity(5, 0);
    expect(Number.isNaN(result)).toBe(false);
    expect(Number.isFinite(result)).toBe(true);
  });
});
