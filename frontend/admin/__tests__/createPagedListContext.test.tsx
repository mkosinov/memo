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
    serverSearch?: boolean;
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
    serverSearch: config.serverSearch,
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

// ─── #140 T3: filters + defaultSort fixtures ────────────────────────────

interface TestFilters {
  search: string;
  minPaid: number | null;
}

const testFilterDefaults: TestFilters = { search: '', minPaid: null };

type FiltersFetcher = (
  params: PagedListFetcherParams & { filters: TestFilters },
) => Promise<PaginatedResponse<TestItem>>;

/**
 * Same idiom as setup() but for the with-filters factory overload — mirrors
 * the Task 4 ClientsContext config (perPage 20, sort name/asc, structured
 * filters object in the query key, spec §5.2).
 */
function setupFilters(
  config: {
    withStatus?: boolean;
    queryKeyPrefix?: string;
    defaultSort?: { sortBy: string; sortOrder: 'asc' | 'desc' };
    defaultPerPage?: number;
  } = {},
) {
  const fetcher = vi.fn((params: PagedListFetcherParams & { filters: TestFilters }) =>
    Promise.resolve(envelope(params.page, params.per_page, 0)),
  );
  const { Provider, usePagedList } = createPagedListContext<TestItem, TestFilters>({
    queryKeyPrefix: config.queryKeyPrefix ?? 'items',
    fetcher: fetcher as FiltersFetcher,
    withStatus: config.withStatus,
    defaultPerPage: config.defaultPerPage,
    filters: { defaults: testFilterDefaults },
    defaultSort: config.defaultSort,
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

  // ─── #212 T10: serverSearch — server-side q path (spec §5.5 pt 2) ──────

  describe('serverSearch', () => {
    it('setSearch with ≥2 chars refetches with q and puts q in the queryKey', async () => {
      const { fetcher, usePagedList, Wrapper, queryClient } = setup({
        serverSearch: true,
        queryKeyPrefix: 'tests-ss',
      });

      const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledWith({ page: 1, per_page: 10 });

      act(() => {
        result.current.setSearch('анна');
      });

      await waitFor(() => {
        expect(fetcher).toHaveBeenCalledWith({ page: 1, per_page: 10, q: 'анна' });
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(result.current.search).toBe('анна');
      const keys = queryClient.getQueryCache().getAll().map((q) => q.queryKey);
      expect(keys).toEqual([
        ['tests-ss', 1, 10, null, 'asc', ''],
        ['tests-ss', 1, 10, null, 'asc', 'анна'],
      ]);
    });

    it('1-char search does NOT fire with q (≥2 clamp — treated as unset)', async () => {
      const { fetcher, usePagedList, Wrapper, queryClient } = setup({
        serverSearch: true,
        queryKeyPrefix: 'tests-ss-clamp',
      });

      const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.setSearch('а');
      });

      // Raw state reflects the input, but no refetch fires and no q enters the key
      await waitFor(() => {
        expect(result.current.search).toBe('а');
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][0]).not.toHaveProperty('q');
      const keys = queryClient.getQueryCache().getAll().map((q) => q.queryKey);
      expect(keys).toEqual([['tests-ss-clamp', 1, 10, null, 'asc', '']]);
    });

    it('empty search sends no q and clears search resets to an unfiltered fetch', async () => {
      const { fetcher, usePagedList, Wrapper } = setup({
        serverSearch: true,
        queryKeyPrefix: 'tests-ss-empty',
      });

      const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
      // initial fetch carries no q
      expect(fetcher.mock.calls[0][0]).not.toHaveProperty('q');

      act(() => {
        result.current.setSearch('ке');
      });
      await waitFor(() => {
        expect(fetcher).toHaveBeenCalledWith({ page: 1, per_page: 10, q: 'ке' });
      });

      act(() => {
        result.current.setSearch('');
      });
      await waitFor(() => {
        // deep equality — no q key on the post-clear fetch
        expect(fetcher).toHaveBeenLastCalledWith({ page: 1, per_page: 10 });
      });
      expect(fetcher.mock.calls[2][0]).not.toHaveProperty('q');
    });

    it('setSearch resets page to 1', async () => {
      const { fetcher, usePagedList, Wrapper } = setup({
        serverSearch: true,
        queryKeyPrefix: 'tests-ss-page',
      });
      // Non-empty pages → the page clamp never interferes with this flow
      fetcher.mockImplementation((p) =>
        Promise.resolve(envelope(p.page, p.per_page, 30, [{ id: 't-1', name: 'Анна' }])),
      );

      const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.setPage(3);
      });
      await waitFor(() => {
        expect(fetcher).toHaveBeenCalledWith({ page: 3, per_page: 10 });
      });
      expect(result.current.page).toBe(3);

      act(() => {
        result.current.setSearch('ива');
      });

      await waitFor(() => {
        expect(fetcher).toHaveBeenCalledWith({ page: 1, per_page: 10, q: 'ива' });
      });
      expect(result.current.page).toBe(1);
    });

    it('predicate is NOT applied — visibleItems === items even with a predicate set', async () => {
      const { fetcher, usePagedList, Wrapper } = setup({
        serverSearch: true,
        queryKeyPrefix: 'tests-ss-visible',
        searchPredicate: (item, q) => item.name.toLowerCase().includes(q.toLowerCase()),
      });
      // Persistent response → the q-refetch returns the same 2-row page
      fetcher.mockImplementation(() =>
        Promise.resolve(
          envelope(1, 10, 2, [
            { id: 't-1', name: 'Живопись' },
            { id: 't-2', name: 'Керамика' },
          ]),
        ),
      );

      const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.items).toHaveLength(2);
      });

      act(() => {
        result.current.setSearch('жив');
      });

      // server owns the filter → the client predicate is bypassed
      await waitFor(() => {
        expect(fetcher).toHaveBeenCalledWith({ page: 1, per_page: 10, q: 'жив' });
        expect(result.current.items).toHaveLength(2);
      });
      expect(result.current.visibleItems).toBe(result.current.items);
      expect(result.current.visibleItems).toHaveLength(2);
    });

    it('serverSearch off: predicate behavior unchanged (#139 pins this)', async () => {
      const { fetcher, usePagedList, Wrapper } = setup({
        queryKeyPrefix: 'tests-ss-off',
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

      act(() => {
        result.current.setSearch('жив');
      });

      await waitFor(() => {
        expect(result.current.visibleItems).toEqual([{ id: 't-1', name: 'Живопись' }]);
      });
      // no server round-trip — predicate path only
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][0]).not.toHaveProperty('q');
    });
  });

  // ─── #140 T3: filters + defaultSort options (with-filters overload) ───

  describe('filters + defaultSort', () => {
    it('initial state: filters equal defaults, sortBy/sortOrder equal defaultSort', async () => {
      const { fetcher, usePagedList, Wrapper } = setupFilters({
        defaultSort: { sortBy: 'name', sortOrder: 'asc' },
        defaultPerPage: 20,
      });

      const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.filters).toEqual({ search: '', minPaid: null });
      expect(result.current.sortBy).toBe('name');
      expect(result.current.sortOrder).toBe('asc');
      expect(result.current.perPage).toBe(20);
      // defaultSort IS sent on the very first fetch (spec §5.1)
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledWith({
        page: 1,
        per_page: 20,
        sort_by: 'name',
        sort_order: 'asc',
        filters: { search: '', minPaid: null },
      });
    });

    it('setFilters(patch) merges into filters and resets page to 1', async () => {
      const { fetcher, usePagedList, Wrapper } = setupFilters({
        defaultSort: { sortBy: 'name', sortOrder: 'asc' },
      });
      // Non-empty pages → the clamp never interferes
      fetcher.mockImplementation((p) =>
        Promise.resolve(envelope(p.page, p.per_page, 30, [{ id: 't-1', name: 'Анна' }])),
      );

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
        result.current.setFilters({ minPaid: 1500 });
      });

      await waitFor(() => {
        expect(fetcher).toHaveBeenLastCalledWith({
          page: 1,
          per_page: 10,
          sort_by: 'name',
          sort_order: 'asc',
          filters: { search: '', minPaid: 1500 },
        });
      });
      // merge, not replace: untouched keys keep their value
      expect(result.current.filters).toEqual({ search: '', minPaid: 1500 });
      expect(result.current.page).toBe(1);
    });

    it('resetFilters() restores defaults and resets page to 1', async () => {
      const { fetcher, usePagedList, Wrapper } = setupFilters({
        defaultSort: { sortBy: 'name', sortOrder: 'asc' },
      });
      fetcher.mockImplementation((p) =>
        Promise.resolve(envelope(p.page, p.per_page, 30, [{ id: 't-1', name: 'Анна' }])),
      );

      const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.setFilters({ search: 'анна', minPaid: 900 });
      });
      await waitFor(() => {
        expect(result.current.filters).toEqual({ search: 'анна', minPaid: 900 });
      });

      act(() => {
        result.current.setPage(2);
      });
      await waitFor(() => {
        expect(result.current.page).toBe(2);
      });

      act(() => {
        result.current.resetFilters();
      });

      await waitFor(() => {
        expect(fetcher).toHaveBeenLastCalledWith({
          page: 1,
          per_page: 10,
          sort_by: 'name',
          sort_order: 'asc',
          filters: { search: '', minPaid: null },
        });
      });
      expect(result.current.filters).toEqual({ search: '', minPaid: null });
      expect(result.current.page).toBe(1);
    });

    it('queryKey is [prefix, page, perPage, filters, sortBy, sortOrder] — filters slot AFTER perPage', async () => {
      const { usePagedList, Wrapper, queryClient } = setupFilters({
        queryKeyPrefix: 'items',
        defaultSort: { sortBy: 'name', sortOrder: 'asc' },
        defaultPerPage: 20,
      });

      const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const keys = queryClient.getQueryCache().getAll().map((q) => q.queryKey);
      expect(keys).toEqual([
        ['items', 1, 20, { search: '', minPaid: null }, 'name', 'asc'],
      ]);
    });

    it('withStatus: false + filters → no status slot in the key', async () => {
      const { usePagedList, Wrapper, queryClient } = setupFilters({
        queryKeyPrefix: 'items-nostatus',
        withStatus: false,
        defaultSort: { sortBy: 'name', sortOrder: 'asc' },
      });

      const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const keys = queryClient.getQueryCache().getAll().map((q) => q.queryKey);
      expect(keys).toEqual([
        ['items-nostatus', 1, 10, { search: '', minPaid: null }, 'name', 'asc'],
      ]);
    });

    it('withStatus: true + filters → status slot BETWEEN filters and sort', async () => {
      const { fetcher, usePagedList, Wrapper, queryClient } = setupFilters({
        queryKeyPrefix: 'items-status',
        withStatus: true,
        defaultSort: { sortBy: 'name', sortOrder: 'asc' },
      });

      const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const keys = queryClient.getQueryCache().getAll().map((q) => q.queryKey);
      expect(keys).toEqual([
        ['items-status', 1, 10, { search: '', minPaid: null }, 'active', 'name', 'asc'],
      ]);
      expect(fetcher).toHaveBeenCalledWith({
        page: 1,
        per_page: 10,
        sort_by: 'name',
        sort_order: 'asc',
        status: 'active',
        filters: { search: '', minPaid: null },
      });
    });

    it('NON-filters context key is UNCHANGED: [prefix, page, perPage, null, asc] (bit-identical pin)', async () => {
      const { usePagedList, Wrapper, queryClient } = setup({ queryKeyPrefix: 'items' });

      const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const keys = queryClient.getQueryCache().getAll().map((q) => q.queryKey);
      // No filters slot, sortBy null — exactly today's shape
      expect(keys).toEqual([['items', 1, 10, null, 'asc']]);
    });

    it('defaultSort absent → sortBy starts null, defaultPerPage still honored', async () => {
      const { fetcher, usePagedList, Wrapper, queryClient } = setupFilters({
        queryKeyPrefix: 'items-nosort',
        defaultPerPage: 20,
        // no defaultSort
      });

      const { result } = renderHook(() => usePagedList(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.sortBy).toBeNull();
      expect(result.current.sortOrder).toBe('asc');
      expect(result.current.perPage).toBe(20);
      // No sort params on the wire (server §4.4 default order) — same as classic
      expect(fetcher).toHaveBeenCalledWith({
        page: 1,
        per_page: 20,
        filters: { search: '', minPaid: null },
      });
      expect(fetcher.mock.calls[0][0]).not.toHaveProperty('sort_by');
      const keys = queryClient.getQueryCache().getAll().map((q) => q.queryKey);
      expect(keys).toEqual([['items-nosort', 1, 20, { search: '', minPaid: null }, null, 'asc']]);
    });

    it('page-clamp parity: settled empty page 2 steps back to page 1', async () => {
      const { fetcher, usePagedList, Wrapper } = setupFilters({
        queryKeyPrefix: 'items-clamp',
        defaultSort: { sortBy: 'name', sortOrder: 'asc' },
      });
      // Page 2 of a shrunk list → empty (spec §5.2 clamp parity with hand-rolled Clients)
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

      await waitFor(() => {
        expect(result.current.page).toBe(1);
      });
      expect(fetcher).toHaveBeenCalledWith({
        page: 2,
        per_page: 10,
        sort_by: 'name',
        sort_order: 'asc',
        filters: { search: '', minPaid: null },
      });
    });
  });
});
