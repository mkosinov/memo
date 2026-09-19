import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// NavigationProvider stays ONLY until Task 3 rewires Topbar (the last
// NavigationContext consumer in this tree).
import { NavigationProvider } from '../contexts/NavigationContext';
import { ScheduleProvider } from '../contexts/schedule/ScheduleProvider';
import { UIProvider } from '../contexts/UIContext';
import { PendingActionsProvider } from '../contexts/PendingActionsContext';
import { UserSettingsProvider } from '../contexts/UserSettingsContext';
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
  // GH #213 §6.6: schedule-page spies — the RecordsProvider removal means the
  // records-context queries must never fire on /schedule (api-client is NOT
  // mocked for RecordsContext, so a stray provider would hit the network).
  getRecordsView: vi.fn(),
  getPaymentTotals: vi.fn(),
  // GH #267: UserSettingsProvider (mounted above ScheduleProvider) reads these.
  getUserSettings: vi.fn().mockResolvedValue({
    user_id: 'u1', theme: 'light', language: 'ru',
    column_order_staff: [], column_order_locations: [],
    show_archived_masters: true, show_archived_locations: false,
  }),
  createUserSettings: vi.fn(),
  patchUserSettings: vi.fn().mockResolvedValue({}),
  });
});

// GH #267: UserSettingsProvider gates loading on useAuth().status — report
// `authenticated` so the settings provider settles.
vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'u1' }, permissions: [], master: null, status: 'authenticated',
    login: vi.fn(), logout: vi.fn(), can: vi.fn(() => false), refresh: vi.fn(),
  })),
}));

import { getRecordsView, getPaymentTotals } from '@memo/api-client';

// #138 Task 2: ScheduleViewProvider reads the URL via useScheduleView, so the
// page tree needs App Router APIs — reactive stand-in (push/replace update
// params and re-render subscribers). usePathname covers Sidebar too.
vi.mock('next/navigation', async () => await import('./helpers/nextNavigationMock'));
import { __resetNavigation } from './helpers/nextNavigationMock';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <UIProvider>
        <NavigationProvider>
          <UserSettingsProvider>
            <PendingActionsProvider>
              <SchedulePage />
            </PendingActionsProvider>
          </UserSettingsProvider>
        </NavigationProvider>
      </UIProvider>
    </QueryClientProvider>,
  );
}

describe('Schedule Page', () => {
  beforeEach(() => {
    __resetNavigation();
    vi.mocked(getRecordsView).mockClear();
    vi.mocked(getPaymentTotals).mockClear();
  });

  it('shows loading state initially, then grid with empty hint when no activities for the week', async () => {
    renderPage();
    // Initially loading, then transitions to grid + hint when query resolves
    expect(await screen.findByTestId('schedule-empty-hint')).toHaveTextContent('Нет занятий на эту неделю');
    expect(screen.getByTestId('day-column-0')).toBeInTheDocument();
  });

  it('does not mount RecordsProvider — zero records-context queries fire (GH #213 §6.6)', async () => {
    renderPage();
    expect(await screen.findByTestId('schedule-empty-hint')).toBeInTheDocument();
    expect(getRecordsView).not.toHaveBeenCalled();
    expect(getPaymentTotals).not.toHaveBeenCalled();
  });
});
