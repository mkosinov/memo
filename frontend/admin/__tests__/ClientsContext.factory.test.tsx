import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PaginatedResponse, ClientWithStats } from '@memo/api-client';

// Mock only the wire fetcher — the factory + context config stay REAL, so this
// pins the actual ClientsContext fetcher params (GH #140 Task 4 config).
// #349 Task 4: q/status are canonical factory members (serverSearch +
// withStatus); the structured filters bag lost `search`/`status`.
vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return { ...actual, getClientsWithStats: vi.fn() };
});

import { getClientsWithStats } from '@memo/api-client';
import { ClientsProvider, useClientsTable, defaultFilters } from '../contexts/ClientsContext';

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

  it('initial fetch sends the configured defaults (page 1, per_page 20, no sort, status active)', async () => {
    const { Wrapper } = setup();
    const { result } = renderHook(() => useClientsTable(), { wrapper: Wrapper });

    await waitFor(() => expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1));

    const params = lastWireParams();
    expect(params.page).toBe(1);
    expect(params.per_page).toBe(20);
    // #349 spec §2: sort default = NO sort — sort params reach the server
    // only after a user pick (the pre-#349 name/asc seed is gone).
    expect(params.sort_by).toBeUndefined();
    expect(params.sort_order).toBeUndefined();
    // Canonical status member (withStatus: true) — 'active' by default.
    expect(params.status).toBe('active');
    expect(result.current.perPage).toBe(20);
  });

  it('sends q once search reaches ≥2 chars (serverSearch clamp), never the raw search', async () => {
    const { Wrapper } = setup();
    const { result } = renderHook(() => useClientsTable(), { wrapper: Wrapper });

    await waitFor(() => expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1));
    // Empty search → q undefined (≥2 clamp treats short values as unset).
    expect(lastWireParams().q).toBeUndefined();

    act(() => {
      result.current.setSearch('иван');
    });

    await waitFor(() => {
      expect(lastWireParams().q).toBe('иван');
    });
    // The structured filters bag has no `search` field at all (#349) — the
    // key is absent from the wire params entirely.
    expect(lastWireParams()).not.toHaveProperty('search');
    // setSearch resets to page 1 (serverSearch contract).
    expect(lastWireParams().page).toBe(1);
  });

  it('does NOT send q for a 1-char search (≥2 clamp) — and no idle refetch', async () => {
    const { Wrapper } = setup();
    const { result } = renderHook(() => useClientsTable(), { wrapper: Wrapper });

    await waitFor(() => expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.setSearch('и');
    });

    // #349: a sub-clamp value does not join the query key (q slot stays '')
    // → NO second wire call at all — the page keeps showing the full page.
    await act(async () => {});
    expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1);
    expect(result.current.search).toBe('и');
  });

  it('setStatus reaches the wire as the canonical status (page resets to 1)', async () => {
    const { Wrapper } = setup();
    const { result } = renderHook(() => useClientsTable(), { wrapper: Wrapper });

    await waitFor(() => expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.setStatus('archived');
    });

    await waitFor(() => {
      expect(lastWireParams().status).toBe('archived');
    });
    expect(lastWireParams().page).toBe(1);
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
          <ClientsProvider initialFilters={{ clientIds: ['id-a', 'id-b'] }}>
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
    // pattern as the old `search`).
    expect(lastWireParams().ids).toEqual(['id-a', 'id-b']);
    expect(lastWireParams()).toHaveProperty('clientIds', undefined);
    expect(result.current.filters.clientIds).toEqual(['id-a', 'id-b']);
    // #349: the deep-link status=all overlay lives in the PAGE adapter now
    // (effectiveStatus) — the bare factory stays at its own status default.
    expect(result.current.status).toBe('active');
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
          <ClientsProvider initialFilters={{ clientIds: ['id-a'] }}>
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
          <ClientsProvider initialFilters={{ clientIds: ['id-a'] }}>
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

// ─── #231 seed-era factory contract (structured fields, still supported) ───
// #349: the PAGE no longer uses initialFilters (managed mode owns the seed),
// but the factory prop remains for uncontrolled consumers until the wave.

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
          <ClientsProvider initialFilters={{ min_records: 3 }}>{children}</ClientsProvider>
        </QueryClientProvider>
      );
    }

    const { result } = renderHook(() => useClientsTable(), { wrapper: Wrapper });

    await waitFor(() => expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1));

    // Seed overrides the seeded field; the other fields keep config defaults
    expect(result.current.filters).toEqual({ ...defaultFilters, min_records: 3 });
    // The very first fetch is already narrowed (one request, not two)
    expect(lastWireParams().min_records).toBe(3);
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
    let filtersNow: ReturnType<typeof useClientsTable>['filters'] | undefined;
    function Probe() {
      filtersNow = useClientsTable().filters;
      return null;
    }
    const ui = (seed: Partial<ReturnType<typeof useClientsTable>['filters']> | undefined) => (
      <QueryClientProvider client={queryClient}>
        <ClientsProvider initialFilters={seed}>
          <Probe />
        </ClientsProvider>
      </QueryClientProvider>
    );

    const { rerender } = render(ui({ min_records: 1 }));

    await waitFor(() => expect(mockGetClientsWithStats).toHaveBeenCalledTimes(1));
    expect(filtersNow).toEqual({ ...defaultFilters, min_records: 1 });

    // Same tree position → Provider re-renders with the new prop, NOT remounts
    rerender(ui({ min_records: 2 }));

    await act(async () => {});
    expect(filtersNow).toEqual({ ...defaultFilters, min_records: 1 });
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
          <ClientsProvider initialFilters={{ min_records: 3 }}>{children}</ClientsProvider>
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
