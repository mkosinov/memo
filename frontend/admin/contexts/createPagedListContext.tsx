'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PaginatedResponse } from '@memo/api-client';
import type { PagedListState } from '@/app/components/shared/tableTypes';

export type ArchiveFilter = 'active' | 'all' | 'archived';
export type SortOrder = 'asc' | 'desc';

export interface PagedListFetcherParams {
  page: number;
  per_page: number;
  /** Present only after the user picks a sort — initial state sends neither (server default order). */
  sort_by?: string;
  sort_order?: SortOrder;
  status?: ArchiveFilter;
  /** Server-side search (#212 §5.1) — present only when serverSearch is on and search is ≥2 chars. */
  q?: string;
}

export interface PagedListContextValue<T> {
  items: T[];
  /** Derived filtered view when a searchPredicate + non-empty search is active; undefined otherwise. */
  visibleItems?: T[];
  total: number;
  page: number;
  perPage: number;
  sortBy: string | null;
  sortOrder: SortOrder;
  status: ArchiveFilter;
  isPending: boolean;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  search: string;
  setPage: (page: number) => void;
  setPerPage: (perPage: number) => void;
  setSort: (field: string, order: SortOrder) => void;
  setStatus: (status: ArchiveFilter) => void;
  setSearch: (s: string) => void;
  refetch: () => void;
}

interface PagedListConfig<T> {
  queryKeyPrefix: string;
  fetcher: (params: PagedListFetcherParams) => Promise<PaginatedResponse<T>>;
  withStatus?: boolean;
  defaultPerPage?: number;
  /**
   * Client-side filter predicate (spec §6.7 — dict search is predicate-only):
   * `search` stays OUT of the query key and fetcher params; the loaded page is
   * filtered locally into `visibleItems`. Ignored when serverSearch is on.
   */
  searchPredicate?: (item: T, q: string) => boolean;
  /**
   * Server-side search (#212 §5.5 pt 2): the debounced `search` value joins the
   * query key and is sent to the fetcher as `q` — clamped to ≥2 chars (a shorter
   * value is treated as unset). The client predicate is bypassed
   * (`visibleItems === items`), and setSearch resets page to 1.
   */
  serverSearch?: boolean;
}

/**
 * Shared server-pagination context factory for dictionary tables (#205).
 * Shape mirrors ClientsContext; setSort/setPerPage/setStatus reset page to 1
 * (deliberate upgrade over the Clients/Records precedent, spec §5.2).
 * sortBy starts null → initial fetch omits sort params → server default order
 * (spec §4.4), preserving today's unsorted-initial-render behavior.
 */
export function createPagedListContext<T>(config: PagedListConfig<T>) {
  const {
    queryKeyPrefix,
    fetcher,
    withStatus = false,
    defaultPerPage = 10,
    searchPredicate,
    serverSearch = false,
  } = config;
  const Context = createContext<PagedListContextValue<T> | null>(null);

  function Provider({ children }: { children: React.ReactNode }) {
    const [page, setPage] = useState(1);
    const [perPage, setPerPageState] = useState(defaultPerPage);
    const [sortBy, setSortBy] = useState<string | null>(null);
    const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
    const [status, setStatusState] = useState<ArchiveFilter>('active');
    const [search, setSearch] = useState('');

    // #212 §5.5 pt 2 — serverSearch: the ≥2-char clamp lives here (one place,
    // covers DataTable withSearch inputs AND *Filters bars). Shorter values are
    // treated as unset: no q in key/fetch, unfiltered page shown, no 422 noise.
    const q = serverSearch && search.length >= 2 ? search : undefined;

    const queryKey = withStatus
      ? [queryKeyPrefix, page, perPage, status, sortBy, sortOrder]
      : [queryKeyPrefix, page, perPage, sortBy, sortOrder];
    // q (or its absence) distinguishes cache entries → pages never collide
    // between searches. Slot present only when serverSearch is on.
    if (serverSearch) queryKey.push(q ?? '');

    const { data, isPending, isLoading, isFetching, error, refetch } = useQuery({
      queryKey,
      queryFn: () =>
        fetcher({
          page,
          per_page: perPage,
          ...(sortBy ? { sort_by: sortBy, sort_order: sortOrder } : {}),
          ...(withStatus ? { status } : {}),
          ...(q ? { q } : {}),
        }),
      placeholderData: keepPreviousData,
    });

    const setPerPage = useCallback((n: number) => {
      setPerPageState(n);
      setPage(1);
    }, []);

    const setSort = useCallback((field: string, order: SortOrder) => {
      setSortBy(field);
      setSortOrder(order);
      setPage(1);
    }, []);

    const setStatus = useCallback((s: ArchiveFilter) => {
      setStatusState(s);
      setPage(1);
    }, []);

    // serverSearch: a new q means a new result set → restart at page 1
    // (consistent with the setSort/setPerPage/setStatus reset contract).
    const setSearchWithReset = useCallback((s: string) => {
      setSearch(s);
      if (serverSearch) setPage(1);
    }, []);

    const items = data?.items ?? [];

    // Spec §6.7 — dict search is predicate-only: the loaded page is filtered
    // locally into `visibleItems`; `items` keeps its server-page contract.
    // serverSearch (#212): the server owns the filter — the predicate is
    // bypassed and visibleItems is the items array itself.
    const visibleItems = serverSearch
      ? items
      : searchPredicate && search
        ? items.filter((i) => searchPredicate(i, search))
        : undefined;

    // Spec §6.7 page clamp — after a SETTLED fetch returns an empty non-first
    // page (e.g. last row of page N deleted), step back. `!isFetching` guards
    // against mid-refetch races with keepPreviousData.
    useEffect(() => {
      if (!isPending && !isFetching && items.length === 0 && page > 1) setPage(page - 1);
    }, [isPending, isFetching, items.length, page]);

    const value: PagedListContextValue<T> = {
      items,
      visibleItems,
      total: data?.total ?? 0,
      page,
      perPage,
      sortBy,
      sortOrder,
      status,
      isPending,
      isLoading,
      isFetching,
      error: (error as Error) ?? null,
      search,
      setPage,
      setPerPage,
      setSort,
      setStatus,
      setSearch: setSearchWithReset,
      refetch,
    };
    return <Context.Provider value={value}>{children}</Context.Provider>;
  }

  function usePagedList(): PagedListContextValue<T> {
    const ctx = useContext(Context);
    if (!ctx) throw new Error(`usePagedList(${queryKeyPrefix}) must be used within its Provider`);
    return ctx;
  }

  return { Provider, usePagedList };
}

// Compile-time drift guard (#139 T1): the factory value must always satisfy the
// DataTable-facing PagedListState contract. Type-only import — no runtime cycle.
const _assertAssignable: (v: PagedListContextValue<unknown>) => PagedListState<unknown> = (
  v,
) => v;
void _assertAssignable;
