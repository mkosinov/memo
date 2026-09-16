import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toolbar } from '../app/components/layout/Toolbar';
import { ScheduleProvider } from '../contexts/schedule/ScheduleProvider';
import { NavigationProvider } from '../contexts/NavigationContext';
import { UIProvider, useUI } from '../contexts/UIContext';
import { UserSettingsProvider } from '../contexts/UserSettingsContext';

vi.mock('@memo/api-client', () => {
  const wrap = (items: any[]) => ({ items, total: items.length, page: 1, per_page: 100 });
  return ({
  getAllMasters: vi.fn().mockResolvedValue([]),
  getAllLocations: vi.fn().mockResolvedValue([]),
  getAllServices: vi.fn().mockResolvedValue([]),
  getActivities: vi.fn().mockResolvedValue(wrap([])),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  patchActivity: vi.fn(),
  deleteActivity: vi.fn(),
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

function createQueryWrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <NavigationProvider>
        <UIProvider>
          <UserSettingsProvider>
            <ScheduleProvider>
              {children}
            </ScheduleProvider>
          </UserSettingsProvider>
        </UIProvider>
      </NavigationProvider>
    </QueryClientProvider>
  );
}

/** Harness that expands the right panel before rendering children. */
function ToolbarExpanded() {
  const { rightPanelCollapsed, toggleRightPanel } = useUI();
  React.useEffect(() => {
    if (rightPanelCollapsed) toggleRightPanel();
  }, []);
  return <Toolbar />;
}

function renderWithProviders() {
  return render(createQueryWrapper({ children: <ToolbarExpanded /> }));
}

describe('Toolbar', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('renders "Штамп" section title', () => {
    renderWithProviders();
    expect(screen.getByText('Штамп')).toBeInTheDocument();
  });

  it('renders "Неделя" section title', () => {
    renderWithProviders();
    expect(screen.getByText('Неделя')).toBeInTheDocument();
  });

  it('sections are collapsible — clicking header toggles content visibility', () => {
    renderWithProviders();

    const stampHeader = screen.getByRole('button', { name: /Штамп/i });
    expect(stampHeader).toBeInTheDocument();

    const stampContent = screen.getByTestId('stamp-content');
    expect(stampContent).toHaveClass('max-h-96');

    fireEvent.click(stampHeader);
    expect(stampContent).toHaveClass('max-h-0');

    fireEvent.click(stampHeader);
    expect(stampContent).toHaveClass('max-h-96');
  });

  it('renders with default width', () => {
    const { container } = render(createQueryWrapper({ children: <ToolbarExpanded /> }));
    const panel = container.querySelector('[data-testid="right-panel"]');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveStyle({ width: 'var(--right-w)' });
  });

  it('panel is hidden when rightPanelCollapsed is true', () => {
    function TestHarness() {
      const { rightPanelCollapsed, toggleRightPanel } = useUI();
      // Start expanded, then collapse
      React.useEffect(() => {
        if (!rightPanelCollapsed) toggleRightPanel();
      }, []);
      return <Toolbar />;
    }

    const { container } = render(createQueryWrapper({ children: <TestHarness /> }));
    const panel = container.querySelector('[data-testid="right-panel"]');
    expect(panel).not.toBeInTheDocument();
  });

  it('renders toggle button in header', () => {
    renderWithProviders();
    const toggleBtn = screen.getByRole('button', { name: /Свернуть/i });
    expect(toggleBtn).toBeInTheDocument();
  });

  it('renders copy last week button in Неделя section', () => {
    renderWithProviders();
    const copyBtn = screen.getByRole('button', { name: /Копировать прошлую/i });
    expect(copyBtn).toBeInTheDocument();
  });
});
