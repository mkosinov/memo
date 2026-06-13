import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    localStorage.clear();
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
    it('shows location columns when columnMode=locations is set', () => {
      const activities = [
        createMockActivity({ id: 'ev_1', masterId: 'm1', locationId: 'alpika', date: '2026-06-15' }),
        createMockActivity({ id: 'ev_2', masterId: 'm2', locationId: 'grand', date: '2026-06-15' }),
      ];
      renderDayView({
        columnMode: 'locations',
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
      // Should show column headers for masters (using displayName = "Фамилия Имя")
      expect(screen.getByText('Ольга Середа')).toBeInTheDocument();
      expect(screen.getByText('Юлия Большакова')).toBeInTheDocument();
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
      // With no filter, defaults to master columns; only active masters shown (m1 = Ольга Середа)
      expect(screen.getByText('Ольга Середа')).toBeInTheDocument();
    });
  });

  describe('explicit columnMode override', () => {
    it('shows master columns when columnMode=masters even with master filter active', () => {
      // Implicit logic would show locations when filterMasterIds has entries,
      // but explicit columnMode=masters should override that
      const activities = [
        createMockActivity({ id: 'ev_1', masterId: 'm1', locationId: 'alpika', date: '2026-06-15' }),
        createMockActivity({ id: 'ev_2', masterId: 'm2', locationId: 'grand', date: '2026-06-15' }),
      ];
      renderDayView({
        columnMode: 'masters',
        filterMasterIds: ['m1'],
        filterLocationIds: [],
        selectedDay: new Date(2026, 5, 15),
        activities,
        loading: false,
        error: null,
      });
      // Should show master columns, not location columns
      expect(screen.getByText('Ольга Середа')).toBeInTheDocument();
      expect(screen.getByText('Юлия Большакова')).toBeInTheDocument();
      // Location names should NOT appear as column headers
      expect(screen.queryByText('Альпика')).not.toBeInTheDocument();
    });

    it('shows location columns when columnMode=locations even with no master filter', () => {
      // Implicit logic would show masters when no filter is active,
      // but explicit columnMode=locations should override that
      const activities = [
        createMockActivity({ id: 'ev_1', masterId: 'm1', locationId: 'alpika', date: '2026-06-15' }),
        createMockActivity({ id: 'ev_2', masterId: 'm1', locationId: 'grand', date: '2026-06-15' }),
      ];
      renderDayView({
        columnMode: 'locations',
        filterMasterIds: [],
        filterLocationIds: [],
        selectedDay: new Date(2026, 5, 15),
        activities,
        loading: false,
        error: null,
      });
      // Should show location columns, not master columns
      expect(screen.getByText('Альпика')).toBeInTheDocument();
      expect(screen.getByText('Гранд Отель Поляна')).toBeInTheDocument();
      // Master names should NOT appear as column headers
      expect(screen.queryByText('Ольга Середа')).not.toBeInTheDocument();
    });
  });

  describe('column mode toggle (moved to Topbar)', () => {
    it('does NOT render the column mode toggle in DayView', () => {
      renderDayView({ selectedDay: new Date(2026, 5, 15), loading: false, error: null });
      expect(screen.queryByText('По мастерам')).not.toBeInTheDocument();
      expect(screen.queryByText('По локациям')).not.toBeInTheDocument();
    });
  });
});
