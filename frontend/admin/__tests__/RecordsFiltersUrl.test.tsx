/**
 * Tests for RecordsFilters — #138 Task 5: the date inputs are URL writers.
 *
 * The bar now talks to the URL-backed period hook (useRecordsPeriod, exposed
 * through RecordsContext as setPeriod) instead of NavigationContext:
 *  - editing one date input writes ?from=&to= via router.replace, preserving
 *    the OTHER param (aria-labels unchanged)
 *  - the reset button removes BOTH params AND calls onReset (the page clears
 *    the other filters — today's behavior kept)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', async () => await import('./helpers/nextNavigationMock'));
vi.mock('@memo/api-client', () => ({
  getAllLocations: vi.fn(),
  getAllServices: vi.fn(),
  getAllMasters: vi.fn(),
}));

import {
  __resetNavigation,
  __currentQuery,
} from './helpers/nextNavigationMock';
import { RecordsFilters } from '../app/(main)/records/components/RecordsFilters';

type RecordsFiltersProps = React.ComponentProps<typeof RecordsFilters>;

function defaultProps(overrides: Partial<RecordsFiltersProps> = {}): RecordsFiltersProps {
  return {
    locationId: '',
    serviceId: '',
    masterId: '',
    status: '',
    search: '',
    onLocationChange: vi.fn(),
    onServiceChange: vi.fn(),
    onMasterChange: vi.fn(),
    onStatusChange: vi.fn(),
    onSearchChange: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
}

function renderFilters(overrides: Partial<RecordsFiltersProps> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RecordsFilters {...defaultProps(overrides)} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  __resetNavigation('', '/records');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RecordsFilters — date inputs write the URL (?from=&to=, #138 Task 5)', () => {
  it('changing «Дата от» replaces the URL with ?from= (keeping to)', () => {
    __resetNavigation('?from=2026-02-01&to=2026-02-28', '/records');
    renderFilters();
    fireEvent.change(screen.getByLabelText('Фильтр по дате от'), {
      target: { value: '2026-02-10' },
    });
    expect(__currentQuery()).toBe('?from=2026-02-10&to=2026-02-28');
  });

  it('changing «Дата до» replaces the URL with ?to= (keeping from)', () => {
    __resetNavigation('?from=2026-02-01&to=2026-02-28', '/records');
    renderFilters();
    fireEvent.change(screen.getByLabelText('Фильтр по дате до'), {
      target: { value: '2026-02-20' },
    });
    expect(__currentQuery()).toBe('?from=2026-02-01&to=2026-02-20');
  });

  it('editing the first date with NO params seeds ?from= alone (to param absent)', () => {
    renderFilters();
    fireEvent.change(screen.getByLabelText('Фильтр по дате от'), {
      target: { value: '2026-02-10' },
    });
    expect(__currentQuery()).toBe('?from=2026-02-10');
  });

  it('reset removes BOTH params and calls onReset (other filters cleared by the page)', () => {
    __resetNavigation('?from=2026-02-01&to=2026-02-28', '/records');
    const onReset = vi.fn();
    renderFilters({ onReset });
    fireEvent.click(screen.getByText('Сбросить'));
    expect(__currentQuery()).toBe('');
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('reset with no params still calls onReset and writes no garbage URL', () => {
    const onReset = vi.fn();
    renderFilters({ onReset });
    fireEvent.click(screen.getByText('Сбросить'));
    expect(__currentQuery()).toBe('');
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
