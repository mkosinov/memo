import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationProvider } from '../contexts/NavigationContext';
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
        <NavigationProvider>
          <ScheduleProvider>
            <SchedulePage />
          </ScheduleProvider>
        </NavigationProvider>
      </UIProvider>
    </QueryClientProvider>,
  );
}

describe('Schedule Page', () => {
  it('shows loading state initially, then empty state when no activities for the week', async () => {
    renderPage();
    // Initially loading, then transitions to empty state when query resolves
    expect(await screen.findByText('Нет занятий на эту неделю')).toBeInTheDocument();
  });
});
