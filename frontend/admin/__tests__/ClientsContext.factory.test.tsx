import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
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
import { ClientsProvider, useClientsTable } from '../contexts/ClientsContext';

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
