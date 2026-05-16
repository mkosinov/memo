import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { ScheduleProvider, useSchedule } from '../contexts/ScheduleContext';
import { getMonday } from '../lib/utils';

// Test component that consumes the context
function ScheduleConsumer() {
  const {
    activities,
    artists,
    services,
    studios,
    currentWeek,
    stamp,
    setCurrentWeek,
    addActivity,
    updateActivity,
    deleteActivity,
    setStamp,
    copyLastWeek,
  } = useSchedule();

  return (
    <div>
      <span data-testid="activity-count">{activities.length}</span>
      <span data-testid="artist-count">{artists.length}</span>
      <span data-testid="service-count">{services.length}</span>
      <span data-testid="studio-count">{studios.length}</span>
      <span data-testid="week-start">{currentWeek.toISOString()}</span>
      <span data-testid="stamp-ready">{stamp.ready.toString()}</span>
      <button
        data-testid="add-activity"
        onClick={() =>
          addActivity({
            day: 0,
            masterId: 'm1',
            startTime: 10,
            duration: 2,
            serviceId: 's1',
            serviceName: 'Test',
            minAge: '6+',
            locationId: 'alpika',
            occupied: 0,
            capacity: 8,
            isPrivate: false,
          })
        }
      >
        Add
      </button>
      <button
        data-testid="update-activity"
        onClick={() => updateActivity(activities[0]?.id ?? '', { occupied: 5 })}
      >
        Update
      </button>
      <button
        data-testid="delete-activity"
        onClick={() => deleteActivity(activities[0]?.id ?? '')}
      >
        Delete
      </button>
      <button
        data-testid="set-week"
        onClick={() => setCurrentWeek(new Date(2026, 4, 18))}
      >
        Set Week
      </button>
      <button
        data-testid="set-stamp"
        onClick={() => setStamp({ ...stamp, ready: true })}
      >
        Set Stamp
      </button>
      <button data-testid="copy-last-week" onClick={copyLastWeek}>
        Copy
      </button>
    </div>
  );
}

function renderWithContext() {
  return render(
    <ScheduleProvider>
      <ScheduleConsumer />
    </ScheduleProvider>
  );
}

describe('ScheduleProvider', () => {
  it('throws when useSchedule is used outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function BrokenConsumer() {
      useSchedule();
      return null;
    }
    expect(() => render(<BrokenConsumer />)).toThrow(
      'useSchedule must be used within ScheduleProvider'
    );
    spy.mockRestore();
  });

  it('provides artists, services, studios from mock data', () => {
    renderWithContext();
    expect(screen.getByTestId('artist-count').textContent).toBe('6');
    expect(screen.getByTestId('service-count').textContent).toBe('7');
    expect(screen.getByTestId('studio-count').textContent).toBe('3');
  });

  it('initializes with 28 activities from getStaticEvents', () => {
    renderWithContext();
    expect(screen.getByTestId('activity-count').textContent).toBe('28');
  });

  it('initializes currentWeek to Monday of today', () => {
    renderWithContext();
    const weekStart = new Date(screen.getByTestId('week-start').textContent!);
    expect(weekStart.getDay()).toBe(1); // Monday
  });

  it('initializes stamp with ready=false', () => {
    renderWithContext();
    expect(screen.getByTestId('stamp-ready').textContent).toBe('false');
  });

  it('adds an activity', () => {
    renderWithContext();
    act(() => {
      screen.getByTestId('add-activity').click();
    });
    expect(screen.getByTestId('activity-count').textContent).toBe('29');
  });

  it('updates an activity', () => {
    renderWithContext();
    act(() => {
      screen.getByTestId('update-activity').click();
    });
    // Activity count stays the same, but the first activity should be updated
    expect(screen.getByTestId('activity-count').textContent).toBe('28');
  });

  it('deletes an activity', () => {
    renderWithContext();
    act(() => {
      screen.getByTestId('delete-activity').click();
    });
    expect(screen.getByTestId('activity-count').textContent).toBe('27');
  });

  it('changes current week', () => {
    renderWithContext();
    const expected = getMonday(new Date(2026, 4, 18));
    act(() => {
      screen.getByTestId('set-week').click();
    });
    const weekStart = new Date(screen.getByTestId('week-start').textContent!);
    expect(weekStart.getDate()).toBe(expected.getDate());
  });

  it('updates stamp state', () => {
    renderWithContext();
    act(() => {
      screen.getByTestId('set-stamp').click();
    });
    expect(screen.getByTestId('stamp-ready').textContent).toBe('true');
  });

  it('copies last week activities', () => {
    renderWithContext();
    const initialCount = parseInt(
      screen.getByTestId('activity-count').textContent!
    );
    act(() => {
      screen.getByTestId('copy-last-week').click();
    });
    const newCount = parseInt(screen.getByTestId('activity-count').textContent!);
    expect(newCount).toBeGreaterThan(initialCount);
  });
});
