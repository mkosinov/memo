import { render, screen } from '@testing-library/react';
import type { ScheduleContextType } from '../contexts/ScheduleContext';
import { DAYS } from '../lib/utils';

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

vi.mock('@/app/components/modal/ActivityModal', () => ({
  ActivityModal: () => <div />,
}));

import { useSchedule } from '@/contexts/ScheduleContext';
import { WeekView } from '../app/components/schedule/WeekView';

function createDefaultContext(): ScheduleContextType {
  return {
    activities: [],
    scheduleIndex: { byId: new Map(), byDate: new Map(), byMasterId: new Map(), byLocation: { all: { byDate: new Map(), byServiceId: new Map() } } },
    artists: [],
    services: [],
    locations: [],
    currentWeek: new Date('2025-04-07'),
    stamp: { masterId: null, serviceId: null, locations: new Set(), ready: false },
    setCurrentWeek: vi.fn(),
    addActivity: vi.fn(),
    updateActivity: vi.fn(),
    deleteActivity: vi.fn(),
    setStamp: vi.fn(),
    copyLastWeek: vi.fn(),
    loading: false,
    error: null,
    filterMasterId: null,
    filterLocationId: null,
    setFilterMasterId: vi.fn(),
    setFilterLocationId: vi.fn(),
  };
}

function renderWeekView(contextOverrides?: Partial<ScheduleContextType>) {
  const mockUseSchedule = useSchedule as ReturnType<typeof vi.fn>;
  mockUseSchedule.mockReturnValue({ ...createDefaultContext(), ...contextOverrides });
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
        id: '1', day: 0, masterId: 'm1', artistId: 'm1', startTime: 10, duration: 1,
        serviceId: 's1', serviceName: 'Test', minAge: '6', locationId: 'l1', occupied: 0,
        capacity: 10, isPrivate: false,
        masterName: 'Test Master', serviceTitle: 'Test', date: '2025-04-07',
        time: '10:00', durationMinutes: 60, locationName: 'Loc',
        priceMin: 0, priceMax: 0, masterColor: '#FF0000', maxAge: '99+', comment: '',
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
});
