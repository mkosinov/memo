import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toolbar } from '../app/components/layout/Toolbar';
import { ScheduleProvider } from '../contexts/ScheduleContext';
import { NavigationProvider } from '../contexts/NavigationContext';
import { UIProvider, useUI } from '../contexts/UIContext';

vi.mock('@memo/api-client', () => ({
  getMasters: vi.fn().mockResolvedValue([]),
  getLocations: vi.fn().mockResolvedValue([]),
  getServices: vi.fn().mockResolvedValue([]),
  getActivities: vi.fn().mockResolvedValue([]),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  deleteActivity: vi.fn(),
}));

function createQueryWrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <NavigationProvider>
        <UIProvider>
          <ScheduleProvider>
            {children}
          </ScheduleProvider>
        </UIProvider>
      </NavigationProvider>
    </QueryClientProvider>
  );
}

function renderWithProviders() {
  return render(createQueryWrapper({ children: <Toolbar /> }));
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

    // Find the Штамп section header button
    const stampHeader = screen.getByRole('button', { name: /Штамп/i });
    expect(stampHeader).toBeInTheDocument();

    // Content should be visible initially (has max-h-96)
    const stampContent = screen.getByTestId('stamp-content');
    expect(stampContent).toHaveClass('max-h-96');

    // Click to collapse
    fireEvent.click(stampHeader);
    expect(stampContent).toHaveClass('max-h-0');

    // Click to expand again
    fireEvent.click(stampHeader);
    expect(stampContent).toHaveClass('max-h-96');
  });

  it('renders with default width', () => {
    const { container } = render(createQueryWrapper({ children: <Toolbar /> }));

    const panel = container.querySelector('[data-testid="right-panel"]');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveStyle({ width: 'var(--right-w)' });
  });

  it('panel is hidden when rightPanelCollapsed is true', () => {
    function TestHarness() {
      const { toggleRightPanel } = useUI();
      React.useEffect(() => { toggleRightPanel(); }, []);
      return <Toolbar />;
    }

    const { container } = render(createQueryWrapper({ children: <TestHarness /> }));

    // When collapsed, the panel returns null
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
