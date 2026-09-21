import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, render, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PaginatedResponse, ClientWithStats } from '@memo/api-client';

// Mock only the wire fetcher — the factory + context config stay REAL, so this
// pins the actual ClientsContext fetcher params (GH #140 Task 4 config).
vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return { ...actual, getClientsWithStats: vi.fn() };
});

import { getClientsWithStats } from '@memo/api-client';
import { ClientsProvider, useClientsTable, defaultFilters } from '../contexts/ClientsContext';
import type { ClientFilters } from '../contexts/ClientsContext';

const mockGetClientsWithStats = vi.mocked(getClientsWithStats);

function envelope(): PaginatedResponse<ClientWithStats> {
  return { items: [], total: 0, page: 1, per_page: 20 };
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ClientsProvider>{children}</ClientsProvider>
      </QueryClientProvider>
    );
  }
  return { Wrapper, queryClient };
}

/** The params object of the most recent getClientsWithStats wire call. */
function lastWireParams(): Record<string, unknown> {
  const calls = mockGetClientsWithStats.mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

describe('ClientsContext factory config (GH #140)', () => {
  beforeEach(() => {
    mockGetClientsWithStats.mockResolvedValue(envelope());
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('initial fetch sends the configured defaults (page 1, per_page 20, sort name/asc, status active)', async () => {
    const { Wrapper } = setup();
    const { result } = renderHook(() => useClientsTable(), { wrapper: Wrapper });

    await waitFor(() => expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1));

    const params = lastWireParams();
    expect(params.page).toBe(1);
    expect(params.per_page).toBe(20);
    // defaultSort { sortBy: 'name', sortOrder: 'asc' } is sent on the FIRST fetch
    expect(params.sort_by).toBe('name');
    expect(params.sort_order).toBe('asc');
    // status lives inside the 12-field filters (withStatus: false → no separate slot)
    expect(params.status).toBe('active');
    expect(result.current.perPage).toBe(20);
  });

  it('suppresses the raw `search` field (renamed to q server-side, #212)', async () => {
    const { Wrapper } = setup();
    renderHook(() => useClientsTable(), { wrapper: Wrapper });

    await waitFor(() => expect(mockGetClientsWithStats).toHaveBeenCalled());

    // The fetcher always sets `search: undefined` AFTER spreading filters, so
    // the raw field never reaches the wire even when a search is active.
    expect(lastWireParams()).toHaveProperty('search', undefined);
  });

  it('sends q once filters.search reaches ≥2 chars, and never the raw search', async () => {
    const { Wrapper } = setup();
    const { result } = renderHook(() => useClientsTable(), { wrapper: Wrapper });

    await waitFor(() => expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1));
    // Empty search → q undefined (≥2 clamp treats short values as unset).
    expect(lastWireParams().q).toBeUndefined();

    act(() => {
      result.current.setFilters({ search: 'иван' });
    });

    await waitFor(() => {
      expect(lastWireParams().q).toBe('иван');
    });
    // Raw search stays suppressed even with an active q.
    expect(lastWireParams()).toHaveProperty('search', undefined);
    // setFilters resets to page 1 (merge-patch contract).
    expect(lastWireParams().page).toBe(1);
  });

  it('does NOT send q for a 1-char search (≥2 clamp)', async () => {
    const { Wrapper } = setup();
    const { result } = renderHook(() => useClientsTable(), { wrapper: Wrapper });

    await waitFor(() => expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.setFilters({ search: 'и' });
    });

    await waitFor(() => expect(mockGetClientsWithStats).toHaveBeenCalledTimes(2));
    expect(lastWireParams().q).toBeUndefined();
    expect(lastWireParams()).toHaveProperty('search', undefined);
  });
});

// ─── #232: clientIds machine field → repeated `id` query keys ─────────────

describe('ClientsContext clientIds machine field (#232)', () => {
  beforeEach(() => {
    mockGetClientsWithStats.mockResolvedValue(envelope());
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('sends ids when clientIds is set (seed or setFilters)', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          <ClientsProvider initialFilters={{ clientIds: ['id-a', 'id-b'], status: 'all' }}>
            {children}
          </ClientsProvider>
        </QueryClientProvider>
      );
    }

    const { result } = renderHook(() => useClientsTable(), { wrapper: Wrapper });

    await waitFor(() => expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1));

    // Machine field reaches the fetcher as `ids` (api-client serializes it as
    // repeated `id` query keys — explicit keys, no filters spread). The raw
    // machine field never reaches the wire (suppressed after the spread, same
    // pattern as `search`).
    expect(lastWireParams().ids).toEqual(['id-a', 'id-b']);
    expect(lastWireParams()).toHaveProperty('clientIds', undefined);
    expect(result.current.filters.clientIds).toEqual(['id-a', 'id-b']);
    // Deep-link status stays 'all' (archived reachable, #216 behavior).
    expect(result.current.filters.status).toBe('all');
  });

  it('ids absent when clientIds is null (default filters)', async () => {
    const { Wrapper } = setup();
    renderHook(() => useClientsTable(), { wrapper: Wrapper });

    await waitFor(() => expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1));

    expect(lastWireParams().ids).toBeUndefined();
  });

  it('setFilters({clientIds}) updates the wire ids live', async () => {
    const { Wrapper } = setup();
    const { result } = renderHook(() => useClientsTable(), { wrapper: Wrapper });

    await waitFor(() => expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.setFilters({ clientIds: ['id-a'] });
    });

    await waitFor(() => {
      expect(lastWireParams().ids).toEqual(['id-a']);
    });
    // setFilters resets page to 1 (merge-patch contract of the factory).
    expect(lastWireParams().page).toBe(1);
  });

  it('setFilters({clientIds: null}) drops ids from the wire', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          <ClientsProvider initialFilters={{ clientIds: ['id-a'], status: 'all' }}>
            {children}
          </ClientsProvider>
        </QueryClientProvider>
      );
    }

    const { result } = renderHook(() => useClientsTable(), { wrapper: Wrapper });

    await waitFor(() => expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1));
    expect(lastWireParams().ids).toEqual(['id-a']);

    act(() => {
      result.current.setFilters({ clientIds: null });
    });

    await waitFor(() => {
      expect(lastWireParams().ids).toBeUndefined();
    });
  });

  it('resetFilters clears clientIds (config defaults)', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          <ClientsProvider initialFilters={{ clientIds: ['id-a'], status: 'all' }}>
            {children}
          </ClientsProvider>
        </QueryClientProvider>
      );
    }

    const { result } = renderHook(() => useClientsTable(), { wrapper: Wrapper });

    await waitFor(() => expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.resetFilters();
    });

    await waitFor(() => {
      expect(result.current.filters).toEqual(defaultFilters);
    });
  });
});

// ─── #231 T1: initialFilters seed-at-mount (deep-link single request) ───

describe('ClientsContext factory initialFilters seed (#231)', () => {
  beforeEach(() => {
    mockGetClientsWithStats.mockResolvedValue(envelope());
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('seeds initialFilters merged over config defaults at mount', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          <ClientsProvider initialFilters={{ search: 'uuid-1', status: 'all' }}>
            {children}
          </ClientsProvider>
        </QueryClientProvider>
      );
    }

    const { result } = renderHook(() => useClientsTable(), { wrapper: Wrapper });

    await waitFor(() => expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1));

    // Seed overrides the two seeded fields; the other 10 keep config defaults
    expect(result.current.filters).toEqual({ ...defaultFilters, search: 'uuid-1', status: 'all' });
    // The very first fetch is already narrowed (one request, not two)
    expect(lastWireParams().q).toBe('uuid-1');
    expect(lastWireParams().status).toBe('all');
  });

  it('without initialFilters the state equals config defaults', async () => {
    const { Wrapper } = setup();

    const { result } = renderHook(() => useClientsTable(), { wrapper: Wrapper });

    await waitFor(() => expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1));

    expect(result.current.filters).toEqual(defaultFilters);
  });

  it('ignores initialFilters prop changes after mount (one-time seed)', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let filtersNow: ClientFilters | undefined;
    function Probe() {
      filtersNow = useClientsTable().filters;
      return null;
    }
    const ui = (seed: Partial<ClientFilters> | undefined) => (
      <QueryClientProvider client={queryClient}>
        <ClientsProvider initialFilters={seed}>
          <Probe />
        </ClientsProvider>
      </QueryClientProvider>
    );

    const { rerender } = render(ui({ search: 'uuid-1' }));

    await waitFor(() => expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1));
    expect(filtersNow).toEqual({ ...defaultFilters, search: 'uuid-1' });

    // Same tree position → Provider re-renders with the new prop, NOT remounts
    rerender(ui({ search: 'uuid-2' }));

    await act(async () => {});
    expect(filtersNow).toEqual({ ...defaultFilters, search: 'uuid-1' });
    // No extra fetch — the late prop value never reaches the query
    expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1);
  });

  it('resetFilters restores CONFIG defaults, not the seed', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          <ClientsProvider initialFilters={{ search: 'uuid-1', status: 'all' }}>
            {children}
          </ClientsProvider>
        </QueryClientProvider>
      );
    }

    const { result } = renderHook(() => useClientsTable(), { wrapper: Wrapper });

    await waitFor(() => expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.resetFilters();
    });

    await waitFor(() => {
      expect(result.current.filters).toEqual(defaultFilters);
    });
  });
});
