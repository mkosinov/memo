import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PaginatedResponse, AuditLogResponse } from '@memo/api-client';

// Mock only the wire fetcher — the factory + AuditLogContext config stay
// REAL, so this pins the actual fetcher params (ClientsContext.factory
// precedent, GH #140 Task 4 config).
vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return { ...actual, getAuditLogs: vi.fn() };
});

import { getAuditLogs } from '@memo/api-client';
import { AuditLogProvider, useAuditLogTable, defaultAuditFilters } from '../contexts/AuditLogContext';
import type { AuditLogFilters } from '../contexts/AuditLogContext';

const mockGetAuditLogs = vi.mocked(getAuditLogs);

function envelope(): PaginatedResponse<AuditLogResponse> {
  return { items: [], total: 0, page: 1, per_page: 20 };
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AuditLogProvider>{children}</AuditLogProvider>
      </QueryClientProvider>
    );
  }
  return { Wrapper, queryClient };
}

/** The params object of the most recent getAuditLogs wire call. */
function lastWireParams(): Record<string, unknown> {
  const calls = mockGetAuditLogs.mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

describe('AuditLogContext factory config (GH #344)', () => {
  beforeEach(() => {
    mockGetAuditLogs.mockResolvedValue(envelope());
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('initial fetch sends defaults: page 1, per_page 20, NO sort params (server fixed created_at DESC)', async () => {
    const { Wrapper } = setup();
    const { result } = renderHook(() => useAuditLogTable(), { wrapper: Wrapper });

    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalledTimes(1));

    const params = lastWireParams();
    expect(params.page).toBe(1);
    expect(params.per_page).toBe(20);
    // Spec §7: sorting is SERVER-side fixed created_at DESC — the fetcher
    // never forwards sort params, whatever the factory holds.
    expect(params).not.toHaveProperty('sort_by');
    expect(params).not.toHaveProperty('sort_order');
    expect(result.current.perPage).toBe(20);
    // Default filters: every dropdown/dates empty.
    expect(result.current.filters).toEqual(defaultAuditFilters);
  });

  it('setFilters patch reaches the wire as flat query params and resets page', async () => {
    const { Wrapper } = setup();
    const { result } = renderHook(() => useAuditLogTable(), { wrapper: Wrapper });

    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalled());

    act(() => {
      result.current.setPage(3);
    });
    act(() => {
      result.current.setFilters({ user_id: 'u-1', action: 'update' });
    });

    await waitFor(() => {
      const params = lastWireParams();
      expect(params.page).toBe(1); // filter change restarts at page 1
      expect(params.user_id).toBe('u-1');
      expect(params.action).toBe('update');
      // unset filters stay off the wire entirely
      expect(params).not.toHaveProperty('entity');
      expect(params).not.toHaveProperty('date_from');
      expect(params).not.toHaveProperty('date_to');
    });
  });

  it('period filters date_from/date_to reach the wire', async () => {
    const { Wrapper } = setup();
    const { result } = renderHook(() => useAuditLogTable(), { wrapper: Wrapper });

    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalled());

    act(() => {
      result.current.setFilters({ date_from: '2026-09-01', date_to: '2026-09-20' });
    });

    await waitFor(() => {
      expect(lastWireParams().date_from).toBe('2026-09-01');
      expect(lastWireParams().date_to).toBe('2026-09-20');
    });
  });

  it('resetFilters returns to defaults', async () => {
    const { Wrapper } = setup();
    const { result } = renderHook(() => useAuditLogTable(), { wrapper: Wrapper });

    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalled());

    act(() => {
      result.current.setFilters({ entity: 'clients' });
    });
    await waitFor(() => expect(lastWireParams().entity).toBe('clients'));

    act(() => {
      result.current.resetFilters();
    });
    await waitFor(() => {
      expect(lastWireParams()).not.toHaveProperty('entity');
    });
    expect(result.current.filters).toEqual(defaultAuditFilters);
  });

  it('defaultAuditFilters has exactly the five filter slots', () => {
    expect(Object.keys(defaultAuditFilters).sort()).toEqual(
      ['action', 'date_from', 'date_to', 'entity', 'user_id'].sort(),
    );
  });
});
