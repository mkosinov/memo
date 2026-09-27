import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PaginatedResponse, LocationResponse } from '@memo/api-client';

// Mock only the wire fetcher — the factory + LocationsContext stay REAL, so
// this pins the actual fetcher params (useClientsUrlState.test.tsx precedent).
vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return { ...actual, getLocations: vi.fn() };
});

// Real next/navigation shape via the shared stateful mock — the page-scoped
// hook reads AND writes through it, so pushed URLs must re-render the tree.
vi.mock('next/navigation', async () => await import('./helpers/nextNavigationMock'));
import { __resetNavigation, __lastPushedUrl } from './helpers/nextNavigationMock';

import { getLocations } from '@memo/api-client';
import {
  useLocationsUrlState,
  locationsUrlConfig,
  LOCATIONS_SORT_FIELDS,
  LOCATIONS_URL_DEFAULT_STATUS,
} from '../app/(main)/locations/useLocationsUrlState';
import { LocationsProvider, useLocationsTable } from '../contexts/LocationsContext';

const mockGetLocations = vi.mocked(getLocations);

function envelope(items: LocationResponse[] = []): PaginatedResponse<LocationResponse> {
  return { items, total: items.length, page: 1, per_page: 10 };
}

function lastWireParams(): Record<string, unknown> {
  const calls = mockGetLocations.mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

beforeEach(() => {
  mockGetLocations.mockResolvedValue(envelope());
  __resetNavigation('', '/locations');
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

describe('useLocationsUrlState — config (#349 Task 5)', () => {
  it('exposes the canonical preset contract for the locations page', () => {
    // Sort whitelist = the backend locations whitelist (domain-rules/
    // locations.md §List contract) = the table's sortable column keys.
    expect([...LOCATIONS_SORT_FIELDS]).toEqual([
      'title',
      'short_title',
      'capacity',
      'address',
      'location_hint',
      'description',
      'archived',
      'yandex_map_url',
      'created_at',
    ]);
    expect(locationsUrlConfig.q).toEqual({ kind: 'string', maxLength: 200, defaultValue: '' });
    expect(locationsUrlConfig.status).toEqual({
      kind: 'enum',
      values: ['active', 'all', 'archived'],
      defaultValue: 'active',
    });
    expect(locationsUrlConfig.sort_by).toEqual({
      kind: 'enum',
      values: [...LOCATIONS_SORT_FIELDS],
      defaultValue: '',
    });
    expect(locationsUrlConfig.sort_order).toEqual({
      kind: 'enum',
      values: ['asc', 'desc'],
      defaultValue: 'asc',
      requires: 'sort_by',
    });
    expect(locationsUrlConfig.page).toEqual({ kind: 'int', min: 1, max: 10000, defaultValue: 1 });
    expect(locationsUrlConfig.per_page).toEqual({
      kind: 'enum',
      values: [10, 20, 50, 100],
      defaultValue: 10,
    });
    expect(LOCATIONS_URL_DEFAULT_STATUS).toBe('active');
  });

  it('valid ?q=этаж&status=all&sort_by=capacity&sort_order=desc is honored', () => {
    __resetNavigation('?q=этаж&status=all&sort_by=capacity&sort_order=desc', '/locations');
    const { result } = renderHook(() => useLocationsUrlState());
    expect(result.current.state.q).toBe('этаж');
    expect(result.current.state.status).toBe('all');
    expect(result.current.state.sort_by).toBe('capacity');
    expect(result.current.state.sort_order).toBe('desc');
  });

  it('dirty values silently fall back (sort_by=bogus, status=xyz, page=0), URL untouched', () => {
    __resetNavigation('?sort_by=bogus&status=xyz&page=0&q=x', '/locations');
    const { result } = renderHook(() => useLocationsUrlState());
    expect(result.current.state.sort_by).toBe('');
    expect(result.current.state.status).toBe('active');
    expect(result.current.state.page).toBe(1);
    // q=1 char: the STRING state keeps the raw text (≥2 rule is wire-side).
    expect(result.current.state.q).toBe('x');
    expect(__lastPushedUrl()).toBeNull(); // dirty URL not rewritten
  });

  it('update({status}) writes status + implicit page reset in one push', async () => {
    __resetNavigation('?page=3', '/locations');
    const { result } = renderHook(() => useLocationsUrlState());
    act(() => {
      result.current.update({ status: 'all' });
    });
    await settle();
    expect(__lastPushedUrl()).toBe('/locations?status=all');
  });
});

describe('LocationsProvider urlState wiring — fetcher params', () => {
  /** Renders hook + provider together, exactly like the page does. */
  function renderProvider() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const probe: { current: ReturnType<typeof useLocationsTable> | null } = { current: null };
    function Probe() {
      probe.current = useLocationsTable();
      return null;
    }
    function Page() {
      const urlState = useLocationsUrlState();
      return (
        <QueryClientProvider client={queryClient}>
          <LocationsProvider urlState={urlState}>
            <Probe />
          </LocationsProvider>
        </QueryClientProvider>
      );
    }
    const utils = render(<Page />);
    return { ...utils, probe };
  }

  it('clean mount: one fetch, no sort/q keys, status=active, page 1 / per_page 10', async () => {
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetLocations).toHaveBeenCalledTimes(1));
    expect(lastWireParams()).toEqual({ page: 1, per_page: 10, status: 'active' });
    expect(probe.current!.sortBy).toBeNull();
    expect(probe.current!.search).toBe('');
    expect(probe.current!.status).toBe('active');
  });

  it('?q=этаж&status=all&sort_by=capacity&sort_order=desc&page=2&per_page=50 — one fetch, exact params', async () => {
    __resetNavigation(
      '?q=%D1%8D%D1%82%D0%B0%D0%B6&status=all&sort_by=capacity&sort_order=desc&page=2&per_page=50',
      '/locations',
    );
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetLocations).toHaveBeenCalledTimes(1));
    expect(lastWireParams()).toEqual({
      q: 'этаж',
      status: 'all',
      sort_by: 'capacity',
      sort_order: 'desc',
      page: 2,
      per_page: 50,
    });
    expect(probe.current!.search).toBe('этаж');
    expect(probe.current!.status).toBe('all');
    // Still exactly ONE request after settling (no double-fetch regression).
    await settle(100);
    expect(mockGetLocations).toHaveBeenCalledTimes(1);
  });

  it('1-char q stays in state but never reaches the wire (≥2 server clamp)', async () => {
    __resetNavigation('?q=x', '/locations');
    renderProvider();
    await waitFor(() => expect(mockGetLocations).toHaveBeenCalledTimes(1));
    expect(lastWireParams()).toEqual({ page: 1, per_page: 10, status: 'active' });
  });

  it('setStatus writes status to the URL (one push) — lands in the address', async () => {
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetLocations).toHaveBeenCalledTimes(1));
    act(() => {
      probe.current!.setStatus('archived');
    });
    await settle(50);
    expect(__lastPushedUrl()).toBe('/locations?status=archived');
  });
});
