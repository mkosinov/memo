import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React, { useCallback, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PaginatedResponse } from '@memo/api-client';
import { createPagedListContext } from '../contexts/createPagedListContext';
import type { PagedListFetcherParams } from '../contexts/createPagedListContext';

// #349 Task 2 — controlled mode: the Provider receives the return of
// useTableUrlState via the `urlState` prop and derives page/perPage/sort/
// status/search/filters from it (no own useState writes). The harness below
// emulates the hook contract, including the "non-page patch without explicit
// page resets page→1 in the same batch" rule the factory setters rely on.

interface TestItem {
  id: string;
  name: string;
}

interface UrlFilters {
  min_paid: number | null;
  city: string;
}

const urlFilterDefaults: UrlFilters = { min_paid: null, city: '' };

const BASE_STATE: Record<string, unknown> = {
  page: 1,
  per_page: 10,
  sort_by: '',
  sort_order: 'asc',
  q: '',
  status: 'active',
  min_paid: null,
  city: '',
};

interface UpdateCall {
  patch: Record<string, unknown>;
  options?: { history?: 'push' | 'replace' };
}

function envelope(
  page: number,
  perPage: number,
  total: number,
  items: TestItem[] = [],
): PaginatedResponse<TestItem> {
  return { items, total, page, per_page: perPage };
}

/** In-test stand-in for useTableUrlState: records every update() call. */
function UrlHarness({
  initial,
  log,
  children,
}: {
  initial: Record<string, unknown>;
  log: UpdateCall[];
  children: (urlState: {
    state: Record<string, unknown>;
    update: (patch: Record<string, unknown>, options?: { history?: 'push' | 'replace' }) => void;
  }) => React.ReactNode;
}) {
  const [state, setState] = useState(initial);
  const update = useCallback(
    (patch: Record<string, unknown>, options?: { history?: 'push' | 'replace' }) => {
      log.push({ patch: { ...patch }, options });
      setState((prev) => {
        const next = { ...prev, ...patch };
        // Hook contract: a filter change without an explicit page resets
        // page→1 in the same batch.
        if (Object.keys(patch).some((k) => k !== 'page') && !('page' in patch)) next.page = 1;
        return next;
      });
    },
    [log],
  );
  return <>{children({ state, update })}</>;
}

function setupControlled(
  config: {
    initial?: Record<string, unknown>;
    queryKeyPrefix?: string;
    fetcherImpl?: (params: PagedListFetcherParams & { filters: UrlFilters }) => PaginatedResponse<TestItem>;
  } = {},
) {
  const fetcher = vi.fn(async (params: PagedListFetcherParams & { filters: UrlFilters }) => {
    const impl = config.fetcherImpl;
    return impl
      ? Promise.resolve(impl(params))
      : envelope(params.page, params.per_page, 30, [{ id: 't-1', name: 'Анна' }]);
  });
  const { Provider, usePagedList } = createPagedListContext<TestItem, UrlFilters>({
    queryKeyPrefix: config.queryKeyPrefix ?? 'url-tests',
    fetcher,
    withStatus: true,
    serverSearch: true,
    filters: { defaults: urlFilterDefaults },
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const updates: UpdateCall[] = [];
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <UrlHarness initial={{ ...BASE_STATE, ...config.initial }} log={updates}>
          {(urlState) => <Provider urlState={urlState}>{children}</Provider>}
        </UrlHarness>
      </QueryClientProvider>
    );
  }
  return { fetcher, updates, usePagedList, Wrapper, queryClient };
}

describe('createPagedListContext — controlled urlState mode (#349)', () => {
  it('mount: fetches ONCE with URL-derived page/per_page/sort/q — no corrections', async () => {
    const { fetcher, updates, usePagedList, Wrapper } = setupControlled({
      initial: { page: 2, per_page: 20, sort_by: 'name', sort_order: 'desc', q: 'анна' },
    });

    const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith({
      page: 2,
      per_page: 20,
      sort_by: 'name',
      sort_order: 'desc',
      q: 'анна',
      status: 'active',
      filters: { min_paid: null, city: '' },
    });
    expect(result.current.page).toBe(2);
    expect(result.current.perPage).toBe(20);
    expect(result.current.sortBy).toBe('name');
    expect(result.current.sortOrder).toBe('desc');
    expect(result.current.search).toBe('анна');
    expect(updates).toEqual([]);
  });

  it('mount: empty sort_by maps to null sortBy — no sort params on the wire', async () => {
    const { fetcher, usePagedList, Wrapper } = setupControlled();

    const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).not.toHaveProperty('sort_by');
    expect(fetcher.mock.calls[0][0]).not.toHaveProperty('sort_order');
    expect(result.current.sortBy).toBeNull();
  });

  it('setPage: single update({page}) batch, refetch with new page', async () => {
    const { fetcher, updates, usePagedList, Wrapper } = setupControlled();

    const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.setPage(3);
    });

    expect(updates).toEqual([{ patch: { page: 3 }, options: undefined }]);
    await waitFor(() => {
      expect(fetcher).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 3, per_page: 10 }),
      );
    });
    expect(result.current.page).toBe(3);
  });

  it('setPerPage: one batch with explicit page:1 (page survives per_page change)', async () => {
    const { fetcher, updates, usePagedList, Wrapper } = setupControlled();

    const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    act(() => {
      result.current.setPage(4);
    });
    await waitFor(() => {
      expect(result.current.page).toBe(4);
    });

    act(() => {
      result.current.setPerPage(50);
    });

    expect(updates).toEqual([
      { patch: { page: 4 }, options: undefined },
      { patch: { per_page: 50, page: 1 }, options: undefined },
    ]);
    await waitFor(() => {
      expect(fetcher).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, per_page: 50 }),
      );
    });
    expect(result.current.page).toBe(1);
    expect(result.current.perPage).toBe(50);
  });

  it('setSort: sort_by+sort_order in ONE batch, page resets to 1 via hook rule', async () => {
    const { fetcher, updates, usePagedList, Wrapper } = setupControlled();

    const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    act(() => {
      result.current.setPage(3);
    });
    await waitFor(() => {
      expect(result.current.page).toBe(3);
    });

    act(() => {
      result.current.setSort('title', 'desc');
    });

    expect(updates).toEqual([
      { patch: { page: 3 }, options: undefined },
      { patch: { sort_by: 'title', sort_order: 'desc' }, options: undefined },
    ]);
    await waitFor(() => {
      expect(fetcher).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, sort_by: 'title', sort_order: 'desc' }),
      );
    });
    expect(result.current.page).toBe(1);
  });

  it('setStatus: one batch; filters/search keep working through urlState keys', async () => {
    const { fetcher, updates, usePagedList, Wrapper } = setupControlled();

    const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.setStatus('archived');
    });

    expect(updates).toEqual([{ patch: { status: 'archived' }, options: undefined }]);
    await waitFor(() => {
      expect(fetcher).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'archived' }));
    });
    expect(result.current.status).toBe('archived');
  });

  it('setSearch: q batch; filters derive from non-canonical state keys', async () => {
    const { fetcher, updates, usePagedList, Wrapper } = setupControlled({
      initial: { min_paid: 900 },
    });

    const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.filters).toEqual({ min_paid: 900, city: '' });

    act(() => {
      result.current.setSearch('анна');
    });
    act(() => {
      result.current.setFilters({ min_paid: 1500 });
    });

    expect(updates).toEqual([
      { patch: { q: 'анна' }, options: undefined },
      { patch: { min_paid: 1500 }, options: undefined },
    ]);
    await waitFor(() => {
      expect(fetcher).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: 'анна', filters: { min_paid: 1500, city: '' } }),
      );
    });
    expect(result.current.search).toBe('анна');
    expect(result.current.filters).toEqual({ min_paid: 1500, city: '' });
  });

  it('resetFilters: one batch resetting every non-canonical key', async () => {
    const { fetcher, updates, usePagedList, Wrapper } = setupControlled({
      initial: { min_paid: 900, city: 'Москва' },
    });

    const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.resetFilters();
    });

    expect(updates).toEqual([
      {
        patch: { min_paid: null, city: '' },
        options: undefined,
      },
    ]);
    // New URL → new key → refetch WITH the default filters (the real hook
    // strips default-valued params; the harness applies them to state).
    await waitFor(() => {
      expect(fetcher).toHaveBeenLastCalledWith(
        expect.objectContaining({ filters: { min_paid: null, city: '' } }),
      );
    });
    expect(result.current.filters).toEqual({ min_paid: null, city: '' });
  });

  it('page correction: empty settled page → ceil(total/per_page) via replace, not decrement', async () => {
    // total=25, per_page=10 → 3 pages; user sits on page 4 (empty)
    const { fetcher, updates, usePagedList, Wrapper } = setupControlled({
      initial: { page: 4 },
      fetcherImpl: (p) => envelope(p.page, p.per_page, 25, p.page <= 3 ? [{ id: 't-1', name: 'A' }] : []),
    });

    const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Settled empty page 4 → corrected to ceil(25/10)=3 with history:replace
    await waitFor(() => {
      expect(updates).toEqual([
        { patch: { page: 3 }, options: { history: 'replace' } },
      ]);
    });
    await waitFor(() => {
      expect(result.current.page).toBe(3);
      expect(fetcher).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }));
    });
  });

  it('page correction: total=0 empty non-first page → page 1 via replace', async () => {
    const { fetcher, updates, usePagedList, Wrapper } = setupControlled({
      initial: { page: 2 },
      fetcherImpl: (p) => envelope(p.page, p.per_page, 0),
    });

    const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await waitFor(() => {
      expect(updates).toEqual([{ patch: { page: 1 }, options: { history: 'replace' } }]);
    });
    await waitFor(() => {
      expect(result.current.page).toBe(1);
    });
  });

  it('no correction: non-empty page settles → zero update() calls', async () => {
    const { fetcher, updates, usePagedList, Wrapper } = setupControlled({
      initial: { page: 2 },
      fetcherImpl: (p) => envelope(p.page, p.per_page, 25, [{ id: 't-1', name: 'A' }]),
    });

    const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.items).toHaveLength(1);
    });
    expect(updates).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('no correction loop: corrected page 3 is non-empty → no further updates', async () => {
    const { fetcher, updates, usePagedList, Wrapper } = setupControlled({
      initial: { page: 4 },
      fetcherImpl: (p) => envelope(p.page, p.per_page, 25, p.page <= 3 ? [{ id: 't-1', name: 'A' }] : []),
    });

    const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.page).toBe(3);
    });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(updates).toEqual([{ patch: { page: 3 }, options: { history: 'replace' } }]);
    expect(result.current.page).toBe(3);
  });
});
