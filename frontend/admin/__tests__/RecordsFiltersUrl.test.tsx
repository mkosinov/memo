/**
 * Tests for RecordsFilters — #349 Task 7: the date inputs write the period
 * through the page's SINGLE URL writer (RecordsContext → useRecordsUrlState).
 *
 * Gate B: a period change is a HISTORY STEP — the inputs' writes land via
 * router.push (the legacy useRecordsPeriod replaced).
 *  - editing one date input writes ?from=&to= preserving the OTHER explicit
 *    side (an absent side stays absent — the deliberate half-filter)
 *  - the reset button removes BOTH params AND calls onReset (the page clears
 *    the other filters — today's behavior kept)
 *
 * The bar is rendered in the page's wiring (adapter → provider → bar) so the
 * assertions exercise the real URL round-trip.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', async () => await import('./helpers/nextNavigationMock'));
vi.mock('@memo/api-client', () => ({
  getAllLocations: vi.fn(),
  getAllServices: vi.fn(),
  getAllMasters: vi.fn(),
  getRecordsView: vi.fn(),
}));

import {
  __resetNavigation,
  __currentQuery,
  __lastNavMethod,
} from './helpers/nextNavigationMock';
import { getRecordsView } from '@memo/api-client';
import { RecordsProvider } from '../contexts/RecordsContext';
import { useRecordsUrlState } from '../app/(main)/records/useRecordsUrlState';
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

/** The page's wiring: the adapter inside the tree, the provider consumes it. */
function renderFilters(overrides: Partial<RecordsFiltersProps> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Harness() {
    const urlState = useRecordsUrlState();
    return (
      <RecordsProvider urlState={urlState}>
        <RecordsFilters {...defaultProps(overrides)} />
      </RecordsProvider>
    );
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  __resetNavigation('', '/records');
  vi.mocked(getRecordsView).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 10 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RecordsFilters — date inputs write the URL (?from=&to=, #349 Task 7)', () => {
  it('changing «Дата от» PUSHES ?from= (keeping the explicit to) — Gate B', async () => {
    __resetNavigation('?from=2026-02-01&to=2026-02-28', '/records');
    renderFilters();
    fireEvent.change(screen.getByLabelText('Фильтр по дате от'), {
      target: { value: '2026-02-10' },
    });
    await waitFor(() => {
      expect(__currentQuery()).toBe('?from=2026-02-10&to=2026-02-28');
    });
    // Gate B: the period change is a history step, not a replace.
    expect(__lastNavMethod()).toBe('push');
  });

  it('changing «Дата до» pushes ?to= (keeping the explicit from)', async () => {
    __resetNavigation('?from=2026-02-01&to=2026-02-28', '/records');
    renderFilters();
    fireEvent.change(screen.getByLabelText('Фильтр по дате до'), {
      target: { value: '2026-02-20' },
    });
    await waitFor(() => {
      expect(__currentQuery()).toBe('?from=2026-02-01&to=2026-02-20');
    });
    expect(__lastNavMethod()).toBe('push');
  });

  it('editing the first date with NO params seeds ?from= alone (to param absent)', async () => {
    renderFilters();
    fireEvent.change(screen.getByLabelText('Фильтр по дате от'), {
      target: { value: '2026-02-10' },
    });
    await waitFor(() => {
      expect(__currentQuery()).toBe('?from=2026-02-10');
    });
  });

  it('the date inputs display the effective period (defaults for absent sides)', () => {
    __resetNavigation('?from=2026-02-01&to=2026-02-28', '/records');
    renderFilters();
    expect(screen.getByLabelText('Фильтр по дате от')).toHaveValue('2026-02-01');
    expect(screen.getByLabelText('Фильтр по дате до')).toHaveValue('2026-02-28');
  });

  it('reset removes BOTH params and calls onReset (other filters cleared by the page)', async () => {
    __resetNavigation('?from=2026-02-01&to=2026-02-28', '/records');
    const onReset = vi.fn();
    renderFilters({ onReset });
    fireEvent.click(screen.getByText('Сбросить'));
    await waitFor(() => {
      expect(__currentQuery()).toBe('');
    });
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('reset with no params still calls onReset and writes no garbage URL', async () => {
    const onReset = vi.fn();
    renderFilters({ onReset });
    fireEvent.click(screen.getByText('Сбросить'));
    await waitFor(() => {
      expect(onReset).toHaveBeenCalledTimes(1);
    });
    expect(__currentQuery()).toBe('');
  });
});
