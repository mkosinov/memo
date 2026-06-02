import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationProvider } from '../contexts/NavigationContext';
import BookingsPage from '../app/(main)/bookings/page';

// usePathname is used by some contexts
vi.mock('next/navigation', () => ({
  usePathname: () => '/bookings',
}));

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NavigationProvider>
        <BookingsPage />
      </NavigationProvider>
    </QueryClientProvider>,
  );
}

describe('BookingsPage', () => {
  it('renders the page title', () => {
    renderWithProviders();
    expect(screen.getByText('Управление записями')).toBeTruthy();
  });

  it('renders filter controls including date inputs', () => {
    renderWithProviders();
    // Date inputs provided by NavigationProvider
    expect(screen.getByLabelText('Фильтр по дате от')).toBeTruthy();
    expect(screen.getByLabelText('Фильтр по дате до')).toBeTruthy();
  });

  it('renders location filter', () => {
    renderWithProviders();
    expect(screen.getByLabelText('Фильтр по локации')).toBeTruthy();
  });

  it('renders service filter', () => {
    renderWithProviders();
    expect(screen.getByLabelText('Фильтр по услуге')).toBeTruthy();
  });

  it('renders master filter', () => {
    renderWithProviders();
    expect(screen.getByLabelText('Фильтр по мастеру')).toBeTruthy();
  });

  it('renders status filter', () => {
    renderWithProviders();
    expect(screen.getByLabelText('Фильтр по статусу')).toBeTruthy();
  });

  it('renders the booking table with records', () => {
    renderWithProviders();
    // Since activities don't have absolute dates, they pass date filtering
    // and records should be visible in the table
    const clientButtons = screen.getAllByText('Анна Смирнова');
    expect(clientButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders reset button', () => {
    renderWithProviders();
    expect(screen.getByText('Сбросить')).toBeTruthy();
  });
});
