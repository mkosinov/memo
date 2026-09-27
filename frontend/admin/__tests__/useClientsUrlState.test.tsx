import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PaginatedResponse, ClientWithStats } from '@memo/api-client';

// Mock only the wire fetcher — the factory + context config stay REAL, so this
// pins the actual ClientsContext fetcher params (same approach as
// ClientsContext.factory.test.tsx).
vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return { ...actual, getClientsWithStats: vi.fn() };
});

// Real next/navigation shape via the shared stateful mock — the page-scoped
// hook reads AND writes through it, so pushed URLs must re-render the tree.
vi.mock('next/navigation', async () => await import('./helpers/nextNavigationMock'));
import { __resetNavigation, __lastPushedUrl, __currentQuery } from './helpers/nextNavigationMock';

import { getClientsWithStats } from '@memo/api-client';
import {
  useClientsUrlState,
  clientsUrlConfig,
  CLIENTS_SORT_FIELDS,
  CLIENTS_URL_DEFAULT_STATUS,
} from '../app/(main)/clients/useClientsUrlState';
import { ClientsProvider, useClientsTable } from '../contexts/ClientsContext';

const mockGetClientsWithStats = vi.mocked(getClientsWithStats);

function envelope(items: ClientWithStats[] = []): PaginatedResponse<ClientWithStats> {
  return { items, total: items.length, page: 1, per_page: 20 };
}

function lastWireParams(): Record<string, unknown> {
  const calls = mockGetClientsWithStats.mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

beforeEach(() => {
  mockGetClientsWithStats.mockResolvedValue(envelope());
  __resetNavigation('', '/clients');
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

describe('useClientsUrlState — config (#349 Task 4)', () => {
  it('exposes the canonical preset contract for the clients page', () => {
    expect(clientsUrlConfig.q).toEqual({ kind: 'string', maxLength: 200, defaultValue: '' });
    expect(clientsUrlConfig.status).toEqual({
      kind: 'enum',
      values: ['active', 'all', 'archived'],
      defaultValue: 'active',
    });
    // Sort default = no sort (spec §2: «дефолт каждой страницы — сортировки нет»)
    // sort_by is an ENUM over the whitelist: a dirty value silently falls back.
    expect(clientsUrlConfig.sort_by).toEqual({
      kind: 'enum',
      values: [...CLIENTS_SORT_FIELDS],
      defaultValue: '',
    });
    expect(clientsUrlConfig.sort_order).toEqual({
      kind: 'enum',
      values: ['asc', 'desc'],
      defaultValue: 'asc',
      requires: 'sort_by',
    });
    expect(clientsUrlConfig.page).toEqual({ kind: 'int', min: 1, max: 10000, defaultValue: 1 });
    expect(clientsUrlConfig.per_page).toEqual({
      kind: 'enum',
      values: [10, 20, 50, 100],
      defaultValue: 20,
    });
    expect(CLIENTS_URL_DEFAULT_STATUS).toBe('active');
  });

  it('dirty ?sort_by=bogus silently falls back to no-sort (whitelist enum)', () => {
    __resetNavigation('?sort_by=bogus&sort_order=desc', '/clients');
    const { result } = renderHook(() => useClientsUrlState());
    expect(result.current.state.sort_by).toBe('');
    // Orphan sort_order (requirement at its default after the fallback) is ignored.
    expect(result.current.state.sort_order).toBe('asc');
    expect(__lastPushedUrl()).toBeNull(); // dirty URL not rewritten
  });

  it('valid ?sort_by=name&sort_order=desc is honored', () => {
    __resetNavigation('?sort_by=name&sort_order=desc', '/clients');
    const { result } = renderHook(() => useClientsUrlState());
    expect(result.current.state.sort_by).toBe('name');
    expect(result.current.state.sort_order).toBe('desc');
  });

  it('reads ?q=ma — state.q mirrors the URL string', () => {
    __resetNavigation('?q=ма', '/clients');
    const { result } = renderHook(() => useClientsUrlState());
    expect(result.current.state.q).toBe('ма');
    expect(result.current.state.status).toBe('active');
    expect(result.current.state.page).toBe(1);
    expect(result.current.state.per_page).toBe(20);
    expect(result.current.state.sort_by).toBe('');
    expect(result.current.state.sort_order).toBe('asc');
  });

  it('invalid values silently fall back (status=xyz, page=0, sort_order=sideways)', () => {
    __resetNavigation('?status=xyz&page=0&sort_order=sideways&q=ма', '/clients');
    const { result } = renderHook(() => useClientsUrlState());
    expect(result.current.state.status).toBe('active');
    expect(result.current.state.page).toBe(1);
    // Orphan sort_order without sort_by is ignored (requires linkage)
    expect(result.current.state.sort_order).toBe('asc');
    expect(result.current.state.sort_by).toBe('');
    // The dirty URL is NOT rewritten
    expect(__lastPushedUrl()).toBeNull();
  });

  it('update({status: all}) writes status + implicit page reset in one push', async () => {
    __resetNavigation('?page=3', '/clients');
    const { result } = renderHook(() => useClientsUrlState());
    act(() => {
      result.current.update({ status: 'all' });
    });
    await settle();
    expect(__lastPushedUrl()).toBe('/clients?status=all');
  });
});

describe('ClientsProvider urlState wiring — fetcher params + effective status', () => {
  /** Renders hook + provider together, exactly like the page does. */
  function renderProvider() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const probe: { current: ReturnType<typeof useClientsTable> | null } = { current: null };
    function Probe() {
      probe.current = useClientsTable();
      return null;
    }
    function Page() {
      const urlState = useClientsUrlState();
      return (
        <QueryClientProvider client={queryClient}>
          <ClientsProvider urlState={urlState}>
            <Probe />
          </ClientsProvider>
        </QueryClientProvider>
      );
    }
    const utils = render(<Page />);
    return { ...utils, probe };
  }

  it('clean mount: one fetch, no sort params, status=active, page 1', async () => {
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1));
    expect(lastWireParams()).toMatchObject({
      page: 1,
      per_page: 20,
      status: 'active',
    });
    expect(lastWireParams().sort_by).toBeUndefined();
    expect(lastWireParams().q).toBeUndefined();
    expect(probe.current!.search).toBe('');
  });

  it('?q=анна&status=all&page=2&per_page=50 — one fetch with the exact params', async () => {
    __resetNavigation('?q=%D0%B0%D0%BD%D0%BD%D0%B0&status=all&page=2&per_page=50', '/clients');
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1));
    expect(lastWireParams()).toMatchObject({
      page: 2,
      per_page: 50,
      status: 'all',
      q: 'анна',
    });
    expect(probe.current!.page).toBe(2);
    expect(probe.current!.perPage).toBe(50);
    expect(probe.current!.status).toBe('all');
    expect(probe.current!.search).toBe('анна');
    // Still exactly ONE request after settling (no double-fetch regression).
    await settle(100);
    expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1);
  });

  it('?clientId=X without explicit status — effective status all, one fetch, no URL rewrite', async () => {
    __resetNavigation('?clientId=11111111-1111-4111-8111-111111111111', '/clients');
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1));
    expect(lastWireParams()).toMatchObject({
      status: 'all',
      page: 1,
      per_page: 20,
    });
    expect((lastWireParams().ids as string[])[0]).toBe('11111111-1111-4111-8111-111111111111');
    expect(probe.current!.filters.clientIds).toEqual(['11111111-1111-4111-8111-111111111111']);
    // The forced status=all is NOT written to the URL (no user-less write).
    expect(__lastPushedUrl()).toBeNull();
  });

  it('?clientId=X&status=archived — explicit URL status wins over the clientId default', async () => {
    __resetNavigation(
      '?clientId=11111111-1111-4111-8111-111111111111&status=archived',
      '/clients',
    );
    renderProvider();
    await waitFor(() => expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1));
    expect(lastWireParams().status).toBe('archived');
  });

  it('setStatus writes status to the URL (one push) — appears in the address', async () => {
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1));
    act(() => {
      probe.current!.setStatus('archived');
    });
    await settle(50);
    expect(__lastPushedUrl()).toBe('/clients?status=archived');
    // The status param lands in the (mock) address → re-render → wire fetch
    // carries it on the next request.
    await waitFor(() => {
      expect(mockGetClientsWithStats.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(lastWireParams().status).toBe('archived');
  });

  it('structured filters stay machine-side: setFilters({min_records}) fetches without URL writes', async () => {
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1));
    act(() => {
      probe.current!.setFilters({ min_records: 3 });
    });
    await waitFor(() => {
      expect(lastWireParams()).toMatchObject({ min_records: 3, page: 1 });
    });
    expect(__lastPushedUrl()).toBeNull();
  });
});

