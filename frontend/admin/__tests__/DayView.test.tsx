import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import type { ScheduleAdminDTO } from '@memo/domain';
import { createMockScheduleContext } from './helpers/mockContexts';

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: vi.fn(),
}));

vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({ showToast: vi.fn() }),
}));

vi.mock('@/hooks/useDnD', () => ({
  useDnD: () => ({
    dragId: null,
    dragCopy: null,
    ghostPosition: null,
    activeDragActivity: null,
    onDragStart: vi.fn(),
    onDragOver: vi.fn(),
    onDragEnd: vi.fn(),
    handleDragCancel: vi.fn(),
  }),
}));

vi.mock('@/app/components/schedule/TimeColumn', () => ({
  TimeColumn: () => <div data-testid="time-column" />,
}));

vi.mock('@/app/components/schedule/DayColumn', () => ({
  DayColumn: (props: { dayIndex: number }) => <div data-testid={`day-column-${props.dayIndex}`} />,
}));

vi.mock('@/app/components/schedule/ActivityCard', () => ({
  ActivityCard: () => <div />,
}));

vi.mock('@/app/components/modal/ActivityDetailsModal/ActivityDetailsModal', () => ({
  ActivityDetailsModal: (props: { isOpen: boolean; mode?: string }) =>
    props.isOpen ? <div data-testid="activity-details-modal" data-mode={props.mode} /> : null,
}));

import { useSchedule } from '@/contexts/ScheduleContext';
import { DayView } from '../app/components/schedule/DayView';
import { buildSchedule } from '@memo/domain';

// Shared mock activity factory
function createMockActivity(overrides: Partial<ScheduleAdminDTO> = {}): ScheduleAdminDTO {
  return {
    id: 'ev_1',
    day: 0,
    masterId: 'm1',
    startTime: 10,
    durationMinutes: 150,
    serviceId: 's1',
    serviceTitle: 'Картина маслом',
    date: '2026-06-15',
    time: '10:00',
    occupied: 3,
    capacity: 8,
    locationId: 'alpika',
    locationName: 'Альпика',
    masterName: 'Ольга Середа',
    masterColor: '#5B8C7A',
    minAge: '12',
    maxAge: '99',
    isPrivate: false,
    comment: '',
    priceMin: 0,
    priceMax: 0,
    ...overrides,
  };
}

function renderDayView(contextOverrides?: Record<string, unknown>) {
  const mockUseSchedule = useSchedule as ReturnType<typeof vi.fn>;
  const overrides = { ...contextOverrides };

  // Build scheduleIndex from activities if not provided
  if (overrides.activities && Array.isArray(overrides.activities) && !overrides.scheduleIndex) {
    const activities = overrides.activities as ScheduleAdminDTO[];
    overrides.scheduleIndex = buildSchedule(activities, { getDateKey: (a: ScheduleAdminDTO) => a.date });
  }

  mockUseSchedule.mockReturnValue(createMockScheduleContext(overrides as Record<string, unknown>));
  return render(<DayView />);
}

describe('DayView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loading state', () => {
    it('shows loading skeleton when loading is true', () => {
      renderDayView({ loading: true });
      expect(screen.getByText('Загрузка...')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows error message when error is present', () => {
      renderDayView({ error: new Error('Network failure') });
      expect(screen.getByText(/Ошибка загрузки/)).toBeInTheDocument();
      expect(screen.getByText(/Network failure/)).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('shows empty message when there are no activities', () => {
      renderDayView({ activities: [], loading: false, error: null });
      expect(screen.getByText(/Нет занятий/)).toBeInTheDocument();
    });
  });

  describe('column logic based on filters', () => {
    it('shows location columns when master filter is active', () => {
      const activities = [
        createMockActivity({ id: 'ev_1', masterId: 'm1', locationId: 'alpika', date: '2026-06-15' }),
        createMockActivity({ id: 'ev_2', masterId: 'm1', locationId: 'grand', date: '2026-06-15' }),
      ];
      renderDayView({
        filterMasterIds: ['m1'],
        filterLocationIds: [],
        selectedDay: new Date(2026, 5, 15), // June 15, 2026
        activities,
        loading: false,
        error: null,
      });
      // Should show column headers for locations
      expect(screen.getByText('Альпика')).toBeInTheDocument();
      expect(screen.getByText('Гранд Отель Поляна')).toBeInTheDocument();
    });

    it('shows master columns when location filter is active', () => {
      const activities = [
        createMockActivity({ id: 'ev_1', masterId: 'm1', locationId: 'alpika', date: '2026-06-15' }),
        createMockActivity({ id: 'ev_2', masterId: 'm2', locationId: 'alpika', date: '2026-06-15' }),
      ];
      renderDayView({
        filterMasterIds: [],
        filterLocationIds: ['alpika'],
        selectedDay: new Date(2026, 5, 15), // June 15, 2026
        activities,
        loading: false,
        error: null,
      });
      // Should show column headers for masters (using shortName)
      expect(screen.getByText('Ольга')).toBeInTheDocument();
      expect(screen.getByText('Юлия')).toBeInTheDocument();
    });

    it('auto-selects masters as columns when no filter is active', () => {
      const activities = [
        createMockActivity({ id: 'ev_1', masterId: 'm1', locationId: 'alpika', date: '2026-06-15' }),
      ];
      renderDayView({
        filterMasterIds: [],
        filterLocationIds: [],
        selectedDay: new Date(2026, 5, 15), // June 15, 2026
        activities,
        loading: false,
        error: null,
      });
      // With no filter, defaults to master columns; only active masters shown (m1 = Ольга)
      expect(screen.getByText('Ольга')).toBeInTheDocument();
    });
  });
});
