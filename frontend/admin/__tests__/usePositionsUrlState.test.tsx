import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PaginatedResponse, PositionResponse } from '@memo/api-client';

// Mock only the wire fetcher — the factory + PositionsContext stay REAL, so
// this pins the actual fetcher params (useClientsUrlState.test.tsx precedent).
vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return { ...actual, getPositions: vi.fn() };
});

// Real next/navigation shape via the shared stateful mock — the page-scoped
// hook reads AND writes through it, so pushed URLs must re-render the tree.
vi.mock('next/navigation', async () => await import('./helpers/nextNavigationMock'));
import { __resetNavigation, __lastPushedUrl } from './helpers/nextNavigationMock';

import { getPositions } from '@memo/api-client';
import {
  usePositionsUrlState,
  positionsUrlConfig,
  POSITIONS_SORT_FIELDS,
} from '../app/(main)/positions/usePositionsUrlState';
import { PositionsProvider, usePositionsTable } from '../contexts/PositionsContext';

const mockGetPositions = vi.mocked(getPositions);

function envelope(items: PositionResponse[] = []): PaginatedResponse<PositionResponse> {
  return { items, total: items.length, page: 1, per_page: 10 };
}

function lastWireParams(): Record<string, unknown> {
  const calls = mockGetPositions.mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

beforeEach(() => {
  mockGetPositions.mockResolvedValue(envelope());
  __resetNavigation('', '/positions');
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

/** Real-time sleep past the ~16ms coalescing window, inside act. */
async function settle(ms = 30): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe('usePositionsUrlState — config (#349 Task 5)', () => {
  it('exposes the canonical preset contract for the positions page', () => {
    // The dictionary has NO sortable columns (D4: every column is
    // sortable:false, GET /positions accepts pagination only) → the sort_by
    // whitelist is empty: a dirty ?sort_by= silently falls back to no-sort.
    expect(POSITIONS_SORT_FIELDS).toEqual([]);
    expect(positionsUrlConfig.sort_by).toEqual({
      kind: 'enum',
      values: [],
      defaultValue: '',
    });
    expect(positionsUrlConfig.sort_order).toEqual({
      kind: 'enum',
      values: ['asc', 'desc'],
      defaultValue: 'asc',
      requires: 'sort_by',
    });
    expect(positionsUrlConfig.page).toEqual({ kind: 'int', min: 1, max: 10000, defaultValue: 1 });
    // Factory default per-page for the dict contexts is 10 (not clients' 20).
    expect(positionsUrlConfig.per_page).toEqual({
      kind: 'enum',
      values: [10, 20, 50, 100],
      defaultValue: 10,
    });
    // No q, no status: the page has neither search nor archive filter.
    expect('q' in positionsUrlConfig).toBe(false);
    expect('status' in positionsUrlConfig).toBe(false);
  });

  it('valid ?page=2&per_page=50 is honored; defaults otherwise', () => {
    __resetNavigation('?page=2&per_page=50', '/positions');
    const { result } = renderHook(() => usePositionsUrlState());
    expect(result.current.state.page).toBe(2);
    expect(result.current.state.per_page).toBe(50);
    expect(result.current.state.sort_by).toBe('');
    expect(result.current.state.sort_order).toBe('asc');
  });

  it('dirty values silently fall back (sort_by=title — empty whitelist, page=0, per_page=7), URL untouched', () => {
    __resetNavigation('?sort_by=title&sort_order=desc&page=0&per_page=7', '/positions');
    const { result } = renderHook(() => usePositionsUrlState());
    // No sortable columns on the page → ANY sort_by is dirty → no-sort default.
    expect(result.current.state.sort_by).toBe('');
    // Orphan sort_order (requirement at default) is ignored.
    expect(result.current.state.sort_order).toBe('asc');
    expect(result.current.state.page).toBe(1);
    expect(result.current.state.per_page).toBe(10);
    expect(__lastPushedUrl()).toBeNull(); // dirty URL not rewritten
  });
});

describe('PositionsProvider urlState wiring — fetcher params', () => {
  /** Renders hook + provider together, exactly like the page does. */
  function renderProvider() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const probe: { current: ReturnType<typeof usePositionsTable> | null } = { current: null };
    function Probe() {
      probe.current = usePositionsTable();
      return null;
    }
    function Page() {
      const urlState = usePositionsUrlState();
      return (
        <QueryClientProvider client={queryClient}>
          <PositionsProvider urlState={urlState}>
            <Probe />
          </PositionsProvider>
        </QueryClientProvider>
      );
    }
    const utils = render(<Page />);
    return { ...utils, probe };
  }

  it('clean mount: one fetch, page 1 / per_page 10, no sort/q/status keys', async () => {
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetPositions).toHaveBeenCalledTimes(1));
    // Deep equality — the fetcher sends pagination ONLY (D4).
    expect(lastWireParams()).toEqual({ page: 1, per_page: 10 });
    expect(probe.current!.page).toBe(1);
    expect(probe.current!.perPage).toBe(10);
    expect(probe.current!.sortBy).toBeNull();
  });

  it('?page=2&per_page=50 link — one fetch with the exact params', async () => {
    __resetNavigation('?page=2&per_page=50', '/positions');
    renderProvider();
    await waitFor(() => expect(mockGetPositions).toHaveBeenCalledTimes(1));
    expect(lastWireParams()).toEqual({ page: 2, per_page: 50 });
    // Still exactly ONE request after settling (no double-fetch regression).
    await settle(100);
    expect(mockGetPositions).toHaveBeenCalledTimes(1);
  });

  it('setPerPage writes per_page to the URL (one push, page reset)', async () => {
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetPositions).toHaveBeenCalledTimes(1));
    act(() => {
      probe.current!.setPerPage(50);
    });
    await settle(50);
    expect(__lastPushedUrl()).toBe('/positions?per_page=50');
  });
});
