import { render, screen } from '@testing-library/react';
import { ScheduleProvider } from '../contexts/ScheduleContext';
import { UIProvider } from '../contexts/UIContext';
import Home from '../app/page';

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
});
