import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { Toolbar } from '../app/components/layout/Toolbar';
import { ScheduleProvider } from '../contexts/ScheduleContext';
import { UIProvider } from '../contexts/UIContext';

function renderWithProviders() {
  return render(
    <UIProvider>
      <ScheduleProvider>
        <Toolbar />
      </ScheduleProvider>
    </UIProvider>
  );
}

describe('Toolbar', () => {
  beforeEach(() => {
    // Reset any document state between tests
    document.documentElement.removeAttribute('data-theme');
  });

  it('renders week navigation buttons (← →)', () => {
    renderWithProviders();
    expect(screen.getByRole('button', { name: /Предыдущая/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Следующая/i })).toBeInTheDocument();
  });

  it('renders date range text', () => {
    renderWithProviders();
    // Date range should contain day numbers and a month name
    const dateRange = screen.getByTestId('date-range');
    expect(dateRange).toBeInTheDocument();
    // Should contain a dash or en-dash between dates
    expect(dateRange.textContent).toMatch(/\d+/);
  });

  it('renders "Сегодня" button', () => {
    renderWithProviders();
    expect(screen.getByRole('button', { name: 'Сегодня' })).toBeInTheDocument();
  });

  it('renders copy last week button', () => {
    renderWithProviders();
    expect(screen.getByRole('button', { name: /Копировать/i })).toBeInTheDocument();
  });

  it('renders delete mode toggle', () => {
    renderWithProviders();
    expect(screen.getByRole('button', { name: /Режим удаления/i })).toBeInTheDocument();
  });

  it('toggle delete mode changes button appearance to red when active', () => {
    renderWithProviders();
    const deleteBtn = screen.getByRole('button', { name: /Режим удаления/i });

    // Initially not active — should not have danger background
    expect(deleteBtn).not.toHaveStyle({ backgroundColor: 'var(--danger)' });

    // Click to activate
    fireEvent.click(deleteBtn);

    // Now active — should have danger background
    expect(deleteBtn).toHaveStyle({ backgroundColor: 'var(--danger)' });
  });
});
