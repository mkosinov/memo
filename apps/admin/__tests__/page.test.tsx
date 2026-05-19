import { render, screen } from '@testing-library/react';
import { ScheduleProvider } from '../contexts/ScheduleContext';
import { UIProvider } from '../contexts/UIContext';
import SchedulePage from '../app/(main)/page';
import React from 'react';

// usePathname is used by Sidebar (not by page itself, but shared context may trigger it)
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

function renderPage() {
  return render(
    <UIProvider>
      <ScheduleProvider>
        <SchedulePage />
      </ScheduleProvider>
    </UIProvider>,
  );
}

describe('Schedule Page', () => {
  it('renders the WeekView with 7 day columns', () => {
    renderPage();
    const dayColumns = screen.getAllByTestId(/day-column/);
    expect(dayColumns).toHaveLength(7);
  });
});
