import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PaginatedResponse } from '@memo/api-client';
import { createPagedListContext } from '../contexts/createPagedListContext';
import type { PagedListFetcherParams } from '../contexts/createPagedListContext';

interface TestItem {
  id: string;
  name: string;
}

type Fetcher = (params: PagedListFetcherParams) => Promise<PaginatedResponse<TestItem>>;

function envelope(
  page: number,
  perPage: number,
  total: number,
  items: TestItem[] = [],
): PaginatedResponse<TestItem> {
  return { items, total, page, per_page: perPage };
}

/**
 * Mirrors the ClientsContext.test.tsx wrapper idiom: fresh QueryClient
 * (retry: false) + QueryClientProvider + the context Provider under test.
 */
function setup(
  config: {
    withStatus?: boolean;
    queryKeyPrefix?: string;
    searchPredicate?: (item: TestItem, q: string) => boolean;
  } = {},
) {
  const fetcher = vi.fn((params: PagedListFetcherParams) =>
    Promise.resolve(envelope(params.page, params.per_page, 0)),
  );
  const { Provider, usePagedList } = createPagedListContext<TestItem>({
    queryKeyPrefix: config.queryKeyPrefix ?? 'tests',
    fetcher: fetcher as Fetcher,
    withStatus: config.withStatus,
    searchPredicate: config.searchPredicate,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <Provider>{children}</Provider>
      </QueryClientProvider>
    );
  }
  return { fetcher, usePagedList, Wrapper, queryClient };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createPagedListContext', () => {
  it('initial fetch sends page/per_page/status only (no sort keys) and exposes envelope data', async () => {
    const { fetcher, usePagedList, Wrapper } = setup({ withStatus: true });
    fetcher.mockResolvedValueOnce(envelope(1, 10, 42, [{ id: 't-1', name: 'Анна' }]));

    const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith({ page: 1, per_page: 10, status: 'active' });
    // sortBy starts null → initial fetch OMITS sort params entirely (server §4.4 default order)
    expect(fetcher.mock.calls[0][0]).not.toHaveProperty('sort_by');
    expect(fetcher.mock.calls[0][0]).not.toHaveProperty('sort_order');
    expect(result.current.items).toEqual([{ id: 't-1', name: 'Анна' }]);
    expect(result.current.total).toBe(42);
    expect(result.current.page).toBe(1);
    expect(result.current.perPage).toBe(10);
    expect(result.current.sortBy).toBeNull();
    expect(result.current.sortOrder).toBe('asc');
    expect(result.current.status).toBe('active');
    // Additive defaults (#139 T1): isPending pass-through, search state, no derived view
    expect(result.current.isPending).toBe(false);
    expect(result.current.search).toBe('');
    expect(result.current.visibleItems).toBeUndefined();
  });

  it('setPage(3) refetches with page: 3', async () => {
    const { fetcher, usePagedList, Wrapper } = setup({ withStatus: true });

    const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.setPage(3);
    });

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith({ page: 3, per_page: 10, status: 'active' });
    });
    expect(result.current.page).toBe(3);
  });

  it('setPerPage(50) refetches with per_page: 50 and resets page to 1', async () => {
    const { fetcher, usePagedList, Wrapper } = setup({ withStatus: true });

    const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.setPage(3);
    });
    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith({ page: 3, per_page: 10, status: 'active' });
    });

    act(() => {
      result.current.setPerPage(50);
    });

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith({ page: 1, per_page: 50, status: 'active' });
    });
    expect(result.current.perPage).toBe(50);
    expect(result.current.page).toBe(1);
  });

  it('setSort refetches with sort_by/sort_order and resets page to 1', async () => {
    const { fetcher, usePagedList, Wrapper } = setup({ withStatus: true });

    const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.setPage(3);
    });
    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith({ page: 3, per_page: 10, status: 'active' });
    });

    act(() => {
      result.current.setSort('title', 'desc');
    });

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith({
        page: 1,
        per_page: 10,
        status: 'active',
        sort_by: 'title',
        sort_order: 'desc',
      });
    });
    expect(result.current.sortBy).toBe('title');
    expect(result.current.sortOrder).toBe('desc');
    expect(result.current.page).toBe(1);
  });

  it('setStatus refetches with the new status and resets page to 1', async () => {
    const { fetcher, usePagedList, Wrapper } = setup({ withStatus: true });

    const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.setPage(3);
    });
    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith({ page: 3, per_page: 10, status: 'active' });
    });

    act(() => {
      result.current.setStatus('archived');
    });

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith({ page: 1, per_page: 10, status: 'archived' });
    });
    expect(result.current.status).toBe('archived');
    expect(result.current.page).toBe(1);
  });

  it('withStatus: false omits status from fetcher params and from queryKey', async () => {
    const { fetcher, usePagedList, Wrapper, queryClient } = setup({
      withStatus: false,
      queryKeyPrefix: 'tags',
    });

    const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    // deep-equality: any extra status key would fail this
    expect(fetcher).toHaveBeenCalledWith({ page: 1, per_page: 10 });
    expect(fetcher.mock.calls[0][0]).not.toHaveProperty('status');

    const keys = queryClient.getQueryCache().getAll().map((q) => q.queryKey);
    expect(keys).toEqual([['tags', 1, 10, null, 'asc']]);
  });

  it('queryKey shape with withStatus is [prefix, page, perPage, status, sortBy, sortOrder]', async () => {
    const { usePagedList, Wrapper, queryClient } = setup({
      withStatus: true,
      queryKeyPrefix: 'masters',
    });

    const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const keys = queryClient.getQueryCache().getAll().map((q) => q.queryKey);
    // sortBy slot is null initially (no client sort picked yet)
    expect(keys).toEqual([['masters', 1, 10, 'active', null, 'asc']]);
  });

  it('usePagedList throws when used outside its Provider', () => {
    const { usePagedList } = setup();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function BrokenConsumer() {
      usePagedList();
      return null;
    }
    expect(() => render(<BrokenConsumer />)).toThrow(/must be used within its Provider/);
    spy.mockRestore();
  });

  // ─── #139 T1 additions: isPending / search predicate / page clamp ─────

  it('isPending is true on first load (no cached data for the query key)', async () => {
    // Fetcher that never resolves → stays in the initial-load state
    const fetcher = vi.fn(() => new Promise<PaginatedResponse<TestItem>>(() => {}));
    const { Provider, usePagedList } = createPagedListContext<TestItem>({
      queryKeyPrefix: 'tests-pending',
      fetcher: fetcher as Fetcher,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          <Provider>{children}</Provider>
        </QueryClientProvider>
      );
    }

    const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

    expect(result.current.isPending).toBe(true);
    await waitFor(() => {
      // the never-resolving fetch keeps isPending true even while fetching
      expect(result.current.isPending).toBe(true);
      expect(result.current.isFetching).toBe(true);
    });
  });

  it('searchPredicate: setSearch filters visibleItems without refetch (key stays search-free)', async () => {
    const { fetcher, usePagedList, Wrapper, queryClient } = setup({
      queryKeyPrefix: 'tags-search',
      searchPredicate: (item, q) => item.name.toLowerCase().includes(q.toLowerCase()),
    });
    fetcher.mockResolvedValueOnce(
      envelope(1, 10, 2, [
        { id: 't-1', name: 'Живопись' },
        { id: 't-2', name: 'Керамика' },
      ]),
    );

    const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });

    // No predicate application while search is empty → no derived view
    expect(result.current.visibleItems).toBeUndefined();

    act(() => {
      result.current.setSearch('жив');
    });

    await waitFor(() => {
      expect(result.current.visibleItems).toEqual([{ id: 't-1', name: 'Живопись' }]);
    });
    // items stays the full server page; only the derived view is filtered
    expect(result.current.items).toHaveLength(2);
    expect(result.current.search).toBe('жив');
    // B2 cat 9 guard: search is predicate-only — no refetch, key unchanged
    expect(fetcher).toHaveBeenCalledTimes(1);
    const keys = queryClient.getQueryCache().getAll().map((q) => q.queryKey);
    expect(keys).toEqual([['tags-search', 1, 10, null, 'asc']]);

    // Clearing the search restores the unfiltered view (visibleItems undefined)
    act(() => {
      result.current.setSearch('');
    });
    await waitFor(() => {
      expect(result.current.visibleItems).toBeUndefined();
    });
  });

  it('page clamp: settled empty non-first page decrements page', async () => {
    const { fetcher, usePagedList, Wrapper } = setup({ queryKeyPrefix: 'tests-clamp' });
    // Page 2 of a shrunk list → empty
    fetcher.mockImplementation((p) =>
      Promise.resolve(envelope(p.page, p.per_page, p.page === 1 ? 11 : 0)),
    );

    const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.setPage(2);
    });

    // Page 2 fetch settles empty → clamp effect decrements back to 1
    await waitFor(() => {
      expect(result.current.page).toBe(1);
    });
    expect(fetcher).toHaveBeenCalledWith({ page: 2, per_page: 10 });
  });
});
