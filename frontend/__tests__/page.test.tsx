import { render, screen } from '@testing-library/react';
import { ScheduleProvider } from '../contexts/ScheduleContext';
import { UIProvider, useUI } from '../contexts/UIContext';
import Home from '../app/page';
import React from 'react';

function renderHome() {
  return render(
    <UIProvider>
      <ScheduleProvider>
        <Home />
      </ScheduleProvider>
    </UIProvider>,
  );
}

describe('Home Page', () => {
  it('renders the Sidebar', () => {
    renderHome();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
  });

  it('renders the Toolbar', () => {
    renderHome();
    expect(screen.getByTestId('date-range')).toBeInTheDocument();
  });

  it('renders the WeekView with day columns', () => {
    renderHome();
    const dayColumns = screen.getAllByTestId(/day-column/);
    expect(dayColumns).toHaveLength(7);
  });

  it('center content has left margin matching sidebar width', () => {
    renderHome();
    const centerContent = screen.getByTestId('center-content');
    expect(centerContent).toHaveStyle({ marginLeft: 'var(--sidebar-w)' });
  });

  it('center content has right margin matching right panel width', () => {
    renderHome();
    const centerContent = screen.getByTestId('center-content');
    expect(centerContent).toHaveStyle({ marginRight: 'var(--right-w)' });
  });

  it('center content left margin adjusts when sidebar collapsed', () => {
    function TestHarness({ children }: { children: React.ReactNode }) {
      const { toggleSidebar } = useUI();
      React.useEffect(() => { toggleSidebar(); }, []);
      return <>{children}</>;
    }

    render(
      <UIProvider>
        <ScheduleProvider>
          <TestHarness><Home /></TestHarness>
        </ScheduleProvider>
      </UIProvider>,
    );

    const centerContent = screen.getByTestId('center-content');
    expect(centerContent).toHaveStyle({ marginLeft: 'var(--sidebar-collapsed-w)' });
  });

  it('center content right margin is 0 when right panel collapsed', () => {
    function TestHarness({ children }: { children: React.ReactNode }) {
      const { toggleRightPanel } = useUI();
      React.useEffect(() => { toggleRightPanel(); }, []);
      return <>{children}</>;
    }

    render(
      <UIProvider>
        <ScheduleProvider>
          <TestHarness><Home /></TestHarness>
        </ScheduleProvider>
      </UIProvider>,
    );

    const centerContent = screen.getByTestId('center-content');
    expect(centerContent).toHaveStyle({ marginRight: '0px' });
  });
});
