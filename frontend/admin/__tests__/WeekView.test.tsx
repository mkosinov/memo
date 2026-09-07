import { render, screen } from '@testing-library/react';
import { DAYS } from '../lib/utils';
import {
  createMockScheduleData,
  createMockScheduleView,
  createMockGridSettings,
} from './helpers/mockContexts';
import { splitScheduleOverrides, type ScheduleOverrides } from './helpers/splitScheduleOverrides';

vi.mock('@/contexts/schedule/ScheduleDataContext', () => ({
  useScheduleData: vi.fn(),
}));

vi.mock('@/contexts/schedule/ScheduleViewContext', () => ({
  useScheduleView: vi.fn(),
}));

vi.mock('@/contexts/schedule/GridSettingsContext', () => ({
  useGridSettings: vi.fn(),
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

import { useScheduleData } from '@/contexts/schedule/ScheduleDataContext';
import { useScheduleView } from '@/contexts/schedule/ScheduleViewContext';
import { useGridSettings } from '@/contexts/schedule/GridSettingsContext';
import { WeekView } from '../app/components/schedule/WeekView';

// Use shared context factories for default context shapes

function renderWeekView(contextOverrides?: ScheduleOverrides) {
  const { data, view, settings } = splitScheduleOverrides(contextOverrides);
  vi.mocked(useScheduleData).mockReturnValue(createMockScheduleData(data));
  vi.mocked(useScheduleView).mockReturnValue(createMockScheduleView(view));
  vi.mocked(useGridSettings).mockReturnValue(createMockGridSettings(settings));
  return render(<WeekView />);
}

describe('WeekView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loading state', () => {
    it('shows loading skeleton when loading is true', () => {
      renderWeekView({ loading: true });
      expect(screen.getByText('Загрузка...')).toBeInTheDocument();
      expect(screen.queryByTestId(/day-column/)).not.toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows error message when error is present', () => {
      renderWeekView({ error: new Error('Network failure') });
      expect(screen.getByText(/Ошибка загрузки/)).toBeInTheDocument();
      expect(screen.getByText(/Network failure/)).toBeInTheDocument();
      expect(screen.queryByTestId(/day-column/)).not.toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('shows empty message when there are no activities', () => {
      renderWeekView({ activities: [], loading: false, error: null });
      expect(screen.getByText('Нет занятий на эту неделю')).toBeInTheDocument();
      expect(screen.queryByTestId(/day-column/)).not.toBeInTheDocument();
    });
  });

  describe('normal render', () => {
    const normalContext = {
      loading: false,
      error: null,
      activities: [{
        id: '1', day: 0, masterId: 'm1', startMinutes: 600, durationMinutes: 60,
        serviceId: 's1', minAge: '6', locationId: 'l1', occupied: 0,
        capacity: 10, isPrivate: false,
        masterName: 'Test Master', serviceTitle: 'Test', date: '2025-04-07',
        time: '10:00', locationName: 'Loc',
        priceMin: 0, priceMax: 0, masterColor: '#FF0000', maxAge: '99', comment: '',
      }],
    };

    it('renders 7 day columns', () => {
      renderWeekView(normalContext);
      for (let i = 0; i < 7; i++) {
        expect(screen.getByTestId(`day-column-${i}`)).toBeInTheDocument();
      }
    });

    it('renders time column', () => {
      renderWeekView(normalContext);
      expect(screen.getByTestId('time-column')).toBeInTheDocument();
    });

    it('shows correct day headers', () => {
      renderWeekView(normalContext);
      DAYS.forEach((day) => {
        expect(screen.getByText(day)).toBeInTheDocument();
      });
    });
  });

  describe('ActivityDetailsModal wiring', () => {
    const normalContext = {
      loading: false,
      error: null,
      activities: [{
        id: '1', day: 0, masterId: 'm1', startMinutes: 600, durationMinutes: 60,
        serviceId: 's1', minAge: '6', locationId: 'l1', occupied: 0,
        capacity: 10, isPrivate: false,
        masterName: 'Test Master', serviceTitle: 'Test', date: '2025-04-07',
        time: '10:00', locationName: 'Loc',
        priceMin: 0, priceMax: 0, masterColor: '#FF0000', maxAge: '99', comment: '',
      }],
    };

    it('does not render ActivityDetailsModal when closed', () => {
      renderWeekView(normalContext);
      expect(screen.queryByTestId('activity-details-modal')).not.toBeInTheDocument();
    });
  });
});
