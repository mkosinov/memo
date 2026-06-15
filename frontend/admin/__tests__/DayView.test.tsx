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

vi.mock('@/contexts/UserSettingsContext', () => ({
  useUserSettings: vi.fn(),
}));

vi.mock('@/hooks/useColumnReorder', () => ({
  useColumnReorder: ({ columns }: { columns: ReadonlyArray<{ id: string; name: string }> }) => ({
    columnOrder: columns.map((c) => c.id),
    orderedColumns: columns,
    onColumnDrop: vi.fn(),
  }),
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
import { useUserSettings } from '@/contexts/UserSettingsContext';
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
  const mockUseUserSettings = useUserSettings as ReturnType<typeof vi.fn>;
  const overrides = { ...contextOverrides };

  // Build scheduleIndex from activities if not provided
  if (overrides.activities && Array.isArray(overrides.activities) && !overrides.scheduleIndex) {
    const activities = overrides.activities as ScheduleAdminDTO[];
    overrides.scheduleIndex = buildSchedule(activities, { getDateKey: (a: ScheduleAdminDTO) => a.date });
  }

  mockUseSchedule.mockReturnValue(createMockScheduleContext(overrides as Record<string, unknown>));
  mockUseUserSettings.mockReturnValue({
    settings: { theme: 'light', language: 'ru', columnOrderMasters: overrides._columnOrderMasters ?? [], columnOrderLocations: overrides._columnOrderLocations ?? [] },
    updateSettings: vi.fn(),
    setColumnOrder: vi.fn(),
    getColumnOrder: vi.fn((mode: 'masters' | 'locations') => {
      return mode === 'masters' ? (overrides._columnOrderMasters as string[] ?? []) : (overrides._columnOrderLocations as string[] ?? []);
    }),
    ready: true,
  });
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
    it('shows empty message when filter returns no columns', () => {
      renderDayView({
        activities: [],
        filterMasterIds: ['nonexistent'],
        loading: false,
        error: null,
      });
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
      // When columnMode=masters with filterMasterIds=['m1'], only m1 should appear
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
      // Should show only the filtered master column
      expect(screen.getByText('Ольга Середа')).toBeInTheDocument();
      // m2 is not in filter, should not appear
      expect(screen.queryByText('Юлия Большакова')).not.toBeInTheDocument();
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

  describe('column re-appears after filter re-add (Bug 2)', () => {
    it('shows master column that was removed from filter and re-added', () => {
      // Setup: 4 masters, user had order [m1, m3, m4] (m2 was deselected and removed from order)
      // Now m2 is re-added to filter — it should appear
      const allMasters = [
        { id: 'm1', name: 'Ольга Середа', shortName: 'Ольга', color: '#5B8C7A' },
        { id: 'm2', name: 'Юлия Большакова', shortName: 'Юлия', color: '#6B7E9C' },
        { id: 'm3', name: 'Анна Иванова', shortName: 'Анна', color: '#8B6E4E' },
        { id: 'm4', name: 'Мария Петрова', shortName: 'Мария', color: '#4E8B6E' },
      ];
      const activities = [
        createMockActivity({ id: 'ev_1', masterId: 'm1', date: '2026-06-15' }),
        createMockActivity({ id: 'ev_2', masterId: 'm2', date: '2026-06-15' }),
        createMockActivity({ id: 'ev_3', masterId: 'm3', date: '2026-06-15' }),
        createMockActivity({ id: 'ev_4', masterId: 'm4', date: '2026-06-15' }),
      ];
      renderDayView({
        columnMode: 'masters',
        masters: allMasters,
        filterMasterIds: ['m1', 'm2', 'm3', 'm4'], // all selected (m2 re-added)
        _columnOrderMasters: ['m1', 'm3', 'm4'],    // m2 missing from saved order
        selectedDay: new Date(2026, 5, 15),
        activities,
        loading: false,
        error: null,
      });
      // All 4 masters should appear — m2 must NOT be missing
      expect(screen.getByText('Ольга Середа')).toBeInTheDocument();
      expect(screen.getByText('Юлия Большакова')).toBeInTheDocument();
      expect(screen.getByText('Анна Иванова')).toBeInTheDocument();
      expect(screen.getByText('Мария Петрова')).toBeInTheDocument();
    });

    it('shows location column that was removed from filter and re-added', () => {
      const allLocations = [
        { id: 'alpika', name: 'Альпика', color: '#5B8C7A' },
        { id: 'grand', name: 'Гранд Отель Поляна', color: '#6B7E9C' },
        { id: 'park', name: 'Парк Отдыха', color: '#8B6E4E' },
        { id: 'center', name: 'Центр', color: '#4E8B6E' },
      ];
      const activities = [
        createMockActivity({ id: 'ev_1', locationId: 'alpika', date: '2026-06-15' }),
        createMockActivity({ id: 'ev_2', locationId: 'grand', date: '2026-06-15' }),
        createMockActivity({ id: 'ev_3', locationId: 'park', date: '2026-06-15' }),
        createMockActivity({ id: 'ev_4', locationId: 'center', date: '2026-06-15' }),
      ];
      renderDayView({
        columnMode: 'locations',
        locations: allLocations,
        filterLocationIds: ['alpika', 'grand', 'park', 'center'], // all selected (grand re-added)
        _columnOrderLocations: ['alpika', 'park', 'center'],      // grand missing from saved order
        selectedDay: new Date(2026, 5, 15),
        activities,
        loading: false,
        error: null,
      });
      // All 4 locations should appear — grand must NOT be missing
      expect(screen.getByText('Альпика')).toBeInTheDocument();
      expect(screen.getByText('Гранд Отель Поляна')).toBeInTheDocument();
      expect(screen.getByText('Парк Отдыха')).toBeInTheDocument();
      expect(screen.getByText('Центр')).toBeInTheDocument();
    });
  });

  describe('column position after re-adding to filter (Bug 2)', () => {
    it('preserves user column order when master filter is active', () => {
      // User has a preferred order: m2 first, then m1
      // Filter shows only [m1, m2] — should respect user order, not filter insertion order
      const activities = [
        createMockActivity({ id: 'ev_1', masterId: 'm1', locationId: 'alpika', date: '2026-06-15' }),
        createMockActivity({ id: 'ev_2', masterId: 'm2', locationId: 'alpika', date: '2026-06-15' }),
      ];
      const { container } = renderDayView({
        columnMode: 'masters',
        filterMasterIds: ['m1', 'm2'],
        _columnOrderMasters: ['m2', 'm1'], // user prefers m2 first
        selectedDay: new Date(2026, 5, 15),
        activities,
        loading: false,
        error: null,
      });

      // Column headers appear in DOM order — Юлия (m2) should come BEFORE Ольга (m1)
      const headers = container.querySelectorAll('[data-testid^="column-header-"]');
      expect(headers.length).toBe(2);

      // Verify DOM order: m2 header before m1 header
      const m2Index = Array.from(headers).findIndex(h => h.getAttribute('data-testid') === 'column-header-m2');
      const m1Index = Array.from(headers).findIndex(h => h.getAttribute('data-testid') === 'column-header-m1');
      expect(m2Index).toBeLessThan(m1Index);
    });

    it('preserves user column order when location filter is active', () => {
      const activities = [
        createMockActivity({ id: 'ev_1', masterId: 'm1', locationId: 'alpika', date: '2026-06-15' }),
        createMockActivity({ id: 'ev_2', masterId: 'm2', locationId: 'grand', date: '2026-06-15' }),
      ];
      const { container } = renderDayView({
        columnMode: 'locations',
        filterLocationIds: ['alpika', 'grand'],
        _columnOrderLocations: ['grand', 'alpika'], // user prefers grand first
        selectedDay: new Date(2026, 5, 15),
        activities,
        loading: false,
        error: null,
      });

      const headers = container.querySelectorAll('[data-testid^="column-header-"]');
      expect(headers.length).toBe(2);

      const grandIndex = Array.from(headers).findIndex(h => h.getAttribute('data-testid') === 'column-header-grand');
      const alpikaIndex = Array.from(headers).findIndex(h => h.getAttribute('data-testid') === 'column-header-alpika');
      expect(grandIndex).toBeLessThan(alpikaIndex);
    });
  });
});
