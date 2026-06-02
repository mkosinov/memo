import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Topbar } from '../app/components/layout/Topbar';
import { ScheduleProvider } from '../contexts/ScheduleContext';
import { UIProvider } from '../contexts/UIContext';

vi.mock('@memo/api-client', () => ({
  getMasters: vi.fn().mockResolvedValue([]),
  getLocations: vi.fn().mockResolvedValue([]),
  getServices: vi.fn().mockResolvedValue([]),
  getActivities: vi.fn().mockResolvedValue([]),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  deleteActivity: vi.fn(),
}));

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <UIProvider>
        <ScheduleProvider>
          <Topbar />
        </ScheduleProvider>
      </UIProvider>
    </QueryClientProvider>
  );
}

describe('Topbar', () => {
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

  it('does not render copy last week button (moved to RightPanel)', () => {
    renderWithProviders();
    expect(screen.queryByRole('button', { name: /Копировать/i })).not.toBeInTheDocument();
  });

  it('does not render delete mode toggle (moved to StampPanel)', () => {
    renderWithProviders();
    expect(screen.queryByRole('button', { name: /Режим удаления/i })).not.toBeInTheDocument();
  });
});
