'use client';

import React, { createContext, useCallback, useContext, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PaginatedResponse } from '@memo/api-client';

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
  total: number;
  page: number;
  perPage: number;
  sortBy: string | null;
  sortOrder: SortOrder;
  status: ArchiveFilter;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  setPage: (page: number) => void;
  setPerPage: (perPage: number) => void;
  setSort: (field: string, order: SortOrder) => void;
  setStatus: (status: ArchiveFilter) => void;
  refetch: () => void;
}

interface PagedListConfig<T> {
  queryKeyPrefix: string;
  fetcher: (params: PagedListFetcherParams) => Promise<PaginatedResponse<T>>;
  withStatus?: boolean;
  defaultPerPage?: number;
}

/**
 * Shared server-pagination context factory for dictionary tables (#205).
 * Shape mirrors ClientsContext; setSort/setPerPage/setStatus reset page to 1
 * (deliberate upgrade over the Clients/Records precedent, spec §5.2).
 * sortBy starts null → initial fetch omits sort params → server default order
 * (spec §4.4), preserving today's unsorted-initial-render behavior.
 */
export function createPagedListContext<T>(config: PagedListConfig<T>) {
  const { queryKeyPrefix, fetcher, withStatus = false, defaultPerPage = 10 } = config;
  const Context = createContext<PagedListContextValue<T> | null>(null);

  function Provider({ children }: { children: React.ReactNode }) {
    const [page, setPage] = useState(1);
    const [perPage, setPerPageState] = useState(defaultPerPage);
    const [sortBy, setSortBy] = useState<string | null>(null);
    const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
    const [status, setStatusState] = useState<ArchiveFilter>('active');

    const queryKey = withStatus
      ? [queryKeyPrefix, page, perPage, status, sortBy, sortOrder]
      : [queryKeyPrefix, page, perPage, sortBy, sortOrder];

    const { data, isLoading, isFetching, error, refetch } = useQuery({
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

    const value: PagedListContextValue<T> = {
      items: data?.items ?? [],
      total: data?.total ?? 0,
      page,
      perPage,
      sortBy,
      sortOrder,
      status,
      isLoading,
      isFetching,
      error: (error as Error) ?? null,
      setPage,
      setPerPage,
      setSort,
      setStatus,
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
