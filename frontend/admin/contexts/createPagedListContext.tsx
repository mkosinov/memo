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
  /**
   * Structured server filters (#140 §5.2) — present only when the factory is
   * configured with `filters`. The with-filters config types this as the
   * concrete F; the base contract keeps it opaque.
   */
  filters?: unknown;
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

export interface PagedListConfig<T> {
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
 * With-filters config (#140 §5.2) — the structured `filters` object joins the
 * query key wholesale (slot AFTER perPage, BEFORE status) and is passed to the
 * fetcher as-is. `defaultSort` seeds the initial sort state (sent on the first
 * fetch); absent → sortBy stays null = server default order (§4.4).
 * Fetcher is re-declared (not narrowed via extends) so params carry the
 * concrete F — plan-review finding 6b.
 */
export type WithFiltersConfig<T, F extends object> = Omit<PagedListConfig<T>, 'fetcher'> & {
  filters: { defaults: F };
  defaultSort?: { sortBy: string; sortOrder: SortOrder };
  fetcher: (params: PagedListFetcherParams & { filters: F }) => Promise<PaginatedResponse<T>>;
};

/** Extra context members exposed only by the with-filters overload (#140 T3). */
export interface PagedListFiltersState<F> {
  filters: F;
  setFilters: (patch: Partial<F>) => void;
  resetFilters: () => void;
}

/**
 * Internal implementation config (#140 T3, plan-review finding 6b adjustment —
 * types only). The plan's literal `PagedListConfig<T> & Partial<WithFiltersConfig<T, any>>`
 * does not typecheck (TS2394): under strictFunctionTypes the narrowed
 * with-filters fetcher (property syntax) is contravariantly incompatible with
 * the base property-syntax fetcher inside the intersection. Method syntax
 * keeps parameter matching bivariant so BOTH public overloads satisfy the
 * implementation, while the overloads' own fetcher contracts stay strict.
 */
type PagedListImplConfig<T, F extends object> = Omit<PagedListConfig<T>, 'fetcher'> & {
  fetcher(params: PagedListFetcherParams): Promise<PaginatedResponse<T>>;
  filters?: { defaults: F };
  defaultSort?: { sortBy: string; sortOrder: SortOrder };
};

/**
 * Shared server-pagination context factory for dictionary tables (#205).
 * Shape mirrors ClientsContext; setSort/setPerPage/setStatus reset page to 1
 * (deliberate upgrade over the Clients/Records precedent, spec §5.2).
 * sortBy starts null → initial fetch omits sort params → server default order
 * (spec §4.4), preserving today's unsorted-initial-render behavior.
 *
 * Two overloads (#140 T3): the with-filters one exposes `filters`/`setFilters`/
 * `resetFilters` and seeds sort from `defaultSort`; the classic one is
 * bit-identical to the pre-#140 behavior (no filters slot in the key, sortBy
 * null). ONE runtime implementation — `config.filters?.defaults` drives the
 * difference.
 */
export function createPagedListContext<T, F extends object>(config: WithFiltersConfig<T, F>): {
  Provider: React.ComponentType<{ children: React.ReactNode }>;
  usePagedList: () => PagedListContextValue<T> & PagedListFiltersState<F>;
};
export function createPagedListContext<T>(config: PagedListConfig<T>): {
  Provider: React.ComponentType<{ children: React.ReactNode }>;
  usePagedList: () => PagedListContextValue<T>;
};
export function createPagedListContext<T, F extends object>(
  config: PagedListImplConfig<T, F>,
) {
  const {
    queryKeyPrefix,
    fetcher,
    withStatus = false,
    defaultPerPage = 10,
    searchPredicate,
    serverSearch = false,
  } = config;
  const filtersDefaults = config.filters?.defaults;
  const defaultSort = config.defaultSort;
  const Context = createContext<(PagedListContextValue<T> & Partial<PagedListFiltersState<F>>) | null>(null);

  function Provider({ children }: { children: React.ReactNode }) {
    const [page, setPage] = useState(1);
    const [perPage, setPerPageState] = useState(defaultPerPage);
    const [sortBy, setSortBy] = useState<string | null>(defaultSort?.sortBy ?? null);
    const [sortOrder, setSortOrder] = useState<SortOrder>(defaultSort?.sortOrder ?? 'asc');
    const [status, setStatusState] = useState<ArchiveFilter>('active');
    const [search, setSearch] = useState('');
    const [filters, setFiltersState] = useState<F | undefined>(filtersDefaults);

    // #212 §5.5 pt 2 — serverSearch: the ≥2-char clamp lives here (one place,
    // covers DataTable withSearch inputs AND *Filters bars). Shorter values are
    // treated as unset: no q in key/fetch, unfiltered page shown, no 422 noise.
    const q = serverSearch && search.length >= 2 ? search : undefined;

    // Key slot order (#140 §5.2): prefix, page, perPage, [filters], [status],
    // sortBy, sortOrder, [q]. Classic consumers get arrays identical to the
    // pre-#140 ternary — pinned by the factory test suite.
    const queryKey: unknown[] = [queryKeyPrefix, page, perPage];
    if (filters !== undefined) queryKey.push(filters);
    if (withStatus) queryKey.push(status);
    queryKey.push(sortBy, sortOrder);
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
          ...(filters !== undefined ? { filters } : {}),
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

    // #140 T3 — with-filters only: merge-patch semantics mirroring the
    // hand-rolled ClientsContext precedent; a new filter set means a new
    // result set → restart at page 1.
    const setFilters = useCallback((patch: Partial<F>) => {
      setFiltersState((prev) => (prev !== undefined ? { ...prev, ...patch } : prev));
      setPage(1);
    }, []);

    const resetFilters = useCallback(() => {
      setFiltersState(filtersDefaults);
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

    // #140 T3 — value built exactly as the classic shape PLUS a conditional
    // filters spread: classic consumers see no new members (bit-identical),
    // with-filters consumers get the typed PagedListFiltersState<F> trio via
    // the overload signature.
    const value: PagedListContextValue<T> & Partial<PagedListFiltersState<F>> = {
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
      ...(filters !== undefined ? { filters, setFilters, resetFilters } : {}),
    };
    return <Context.Provider value={value}>{children}</Context.Provider>;
  }

  function usePagedList(): PagedListContextValue<T> & PagedListFiltersState<F> {
    const ctx = useContext(Context);
    if (!ctx) throw new Error(`usePagedList(${queryKeyPrefix}) must be used within its Provider`);
    // With-filters consumers get the full trio (value spread above guarantees
    // it); classic consumers are typed by their overload to never see it.
    return ctx as PagedListContextValue<T> & PagedListFiltersState<F>;
  }

  return { Provider, usePagedList };
}

// Compile-time drift guard (#139 T1): the factory value must always satisfy the
// DataTable-facing PagedListState contract. Type-only import — no runtime cycle.
const _assertAssignable: (v: PagedListContextValue<unknown>) => PagedListState<unknown> = (
  v,
) => v;
void _assertAssignable;
