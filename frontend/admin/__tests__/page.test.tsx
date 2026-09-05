import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationProvider } from '../contexts/NavigationContext';
import { ScheduleProvider } from '../contexts/ScheduleContext';
import { UIProvider } from '../contexts/UIContext';
import SchedulePage from '../app/(main)/schedule/page';
import React from 'react';

vi.mock('@memo/api-client', () => {
  const wrap = (items: any[]) => ({ items, total: items.length, page: 1, per_page: 100 });
  return ({
  getAllMasters: vi.fn().mockResolvedValue([]),
  getAllLocations: vi.fn().mockResolvedValue([]),
  getAllServices: vi.fn().mockResolvedValue([]),
  getActivities: vi.fn().mockResolvedValue(wrap([])),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  deleteActivity: vi.fn(),
  // GH #213 §6.6: schedule-page spies — the RecordsProvider removal means the
  // records-context queries must never fire on /schedule (api-client is NOT
  // mocked for RecordsContext, so a stray provider would hit the network).
  getRecordsView: vi.fn(),
  getPaymentTotals: vi.fn(),
  });
});

import { getRecordsView, getPaymentTotals } from '@memo/api-client';

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
  beforeEach(() => {
    vi.mocked(getRecordsView).mockClear();
    vi.mocked(getPaymentTotals).mockClear();
  });

  it('shows loading state initially, then empty state when no activities for the week', async () => {
    renderPage();
    // Initially loading, then transitions to empty state when query resolves
    expect(await screen.findByText('Нет занятий на эту неделю')).toBeInTheDocument();
  });

  it('does not mount RecordsProvider — zero records-context queries fire (GH #213 §6.6)', async () => {
    renderPage();
    expect(await screen.findByText('Нет занятий на эту неделю')).toBeInTheDocument();
    expect(getRecordsView).not.toHaveBeenCalled();
    expect(getPaymentTotals).not.toHaveBeenCalled();
  });
});
