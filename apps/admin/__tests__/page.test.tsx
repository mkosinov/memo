import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ScheduleProvider } from '../contexts/ScheduleContext';
import { UIProvider } from '../contexts/UIContext';
import SchedulePage from '../app/page';
import React from 'react';

vi.mock('@memo/api-client', () => ({
  getMasters: vi.fn().mockResolvedValue([]),
  getLocations: vi.fn().mockResolvedValue([]),
  getServices: vi.fn().mockResolvedValue([]),
  getActivities: vi.fn().mockResolvedValue([]),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  deleteActivity: vi.fn(),
}));

// usePathname is used by Sidebar (not by page itself, but shared context may trigger it)
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <UIProvider>
        <ScheduleProvider>
          <SchedulePage />
        </ScheduleProvider>
      </UIProvider>
    </QueryClientProvider>,
  );
}

describe('Schedule Page', () => {
  it('renders the WeekView with 7 day columns', () => {
    renderPage();
    const dayColumns = screen.getAllByTestId(/day-column/);
    expect(dayColumns).toHaveLength(7);
  });
});
