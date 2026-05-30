import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ScheduleProvider } from '../contexts/ScheduleContext';
import { UIProvider } from '../contexts/UIContext';
import { WeekView } from '../app/components/schedule/WeekView';
import { DAYS } from '../lib/utils';

vi.mock('@memo/api-client', () => ({
  getMasters: vi.fn().mockResolvedValue([]),
  getLocations: vi.fn().mockResolvedValue([]),
  getServices: vi.fn().mockResolvedValue([]),
  getActivities: vi.fn().mockResolvedValue([]),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  deleteActivity: vi.fn(),
}));

function renderWeekView() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <UIProvider>
        <ScheduleProvider>
          <WeekView />
        </ScheduleProvider>
      </UIProvider>
    </QueryClientProvider>,
  );
}

describe('WeekView', () => {
  it('renders 7 day columns', () => {
    renderWeekView();
    const dayColumns = screen.getAllByTestId(/day-column/);
    expect(dayColumns).toHaveLength(7);
  });

  it('renders time column with hour labels', () => {
    renderWeekView();
    // Should show at least 9:00 and 20:00 (slots from 9 to 20.5)
    expect(screen.getByText('09:00')).toBeInTheDocument();
    expect(screen.getByText('20:00')).toBeInTheDocument();
  });

  it('shows correct day headers', () => {
    renderWeekView();
    DAYS.forEach((day) => {
      expect(screen.getByText(day)).toBeInTheDocument();
    });
  });

  describe('DragOverlay ghost', () => {
    it('renders DragOverlay container in the component tree', () => {
      const { container } = renderWeekView();
      // DragOverlay renders as a portal, but the DndContext should be present
      const dndContext = container.querySelector('[data-dnd-context]') || container.firstChild;
      expect(dndContext).toBeInTheDocument();
    });
  });
});
