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
   * filtered locally into `visibleItems`.
   */
  searchPredicate?: (item: T, q: string) => boolean;
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
  } = config;
  const Context = createContext<PagedListContextValue<T> | null>(null);

  function Provider({ children }: { children: React.ReactNode }) {
    const [page, setPage] = useState(1);
    const [perPage, setPerPageState] = useState(defaultPerPage);
    const [sortBy, setSortBy] = useState<string | null>(null);
    const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
    const [status, setStatusState] = useState<ArchiveFilter>('active');
    const [search, setSearch] = useState('');

    const queryKey = withStatus
      ? [queryKeyPrefix, page, perPage, status, sortBy, sortOrder]
      : [queryKeyPrefix, page, perPage, sortBy, sortOrder];

    const { data, isPending, isLoading, isFetching, error, refetch } = useQuery({
      queryKey,
      queryFn: () =>
        fetcher({
          page,
          per_page: perPage,
          ...(sortBy ? { sort_by: sortBy, sort_order: sortOrder } : {}),
          ...(withStatus ? { status } : {}),
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

    const items = data?.items ?? [];

    // Spec §6.7 — dict search is predicate-only: the loaded page is filtered
    // locally into `visibleItems`; `items` keeps its server-page contract.
    const visibleItems =
      searchPredicate && search ? items.filter((i) => searchPredicate(i, search)) : undefined;

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
      setSearch,
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
