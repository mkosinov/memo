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

/** Canonical names the factory maps itself (#349); everything else → filters. */
const CANONICAL_URL_KEYS = new Set([
  'page',
  'per_page',
  'sort_by',
  'sort_order',
  'q',
  'status',
]);

/** Extra context members exposed only by the with-filters overload (#140 T3). */
export interface PagedListFiltersState<F> {
  filters: F;
  setFilters: (patch: Partial<F>) => void;
  resetFilters: () => void;
}

/**
 * #349 controlled-mode integration contract — the return of `useTableUrlState`.
 * `state` uses canonical URL names (`page`, `per_page`, `sort_by`,
 * `sort_order`, `q`, `status`, …); every other key is a structured filter.
 * `update` is the single writer (atomic batch; a filter-only patch
 * auto-resets `page`→1 in the same navigation — the hook enforces it).
 * `state.effectiveStatus` — #349 clients overlay: a page-level rule
 * (`status ?? clientId→'all' : default`) feeding the wire WITHOUT writing the
 * URL (spec §3). It is declared ON the state (where the Provider reads it),
 * not on the integration root. `reset` — #349 clients: the factory's
 * controlled resetFilters routes here when present (defaults = URL without
 * filter params; #232 §3.5 clients reset also drops `clientId`).
 */
export interface PagedListUrlState {
  state: Record<string, unknown>;
  update: (patch: Record<string, unknown>, options?: { history?: 'push' | 'replace' }) => void;
  /** Optional (clients-only today): see interface doc. */
  reset?: () => void;
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
  Provider: React.ComponentType<
    { children: React.ReactNode; initialFilters?: Partial<F> } & { urlState?: PagedListUrlState }
  >;
  usePagedList: () => PagedListContextValue<T> & PagedListFiltersState<F>;
};
export function createPagedListContext<T>(config: PagedListConfig<T>): {
  Provider: React.ComponentType<{ children: React.ReactNode } & { urlState?: PagedListUrlState }>;
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

  function Provider({
    children,
    initialFilters,
    urlState,
  }: {
    children: React.ReactNode;
    initialFilters?: Partial<F>;
    urlState?: PagedListUrlState;
  }) {
    // #349 controlled mode: page/perPage/sort/status/search/filters are
    // derived from `urlState.state` (canonical URL names); the setters below
    // become single-batch `urlState.update` calls. Uncontrolled (no urlState)
    // keeps the classic useState implementation byte-identical.
    const urlPage = urlState ? Number(urlState.state.page ?? 1) || 1 : undefined;
    const urlPerPage = urlState
      ? Number(urlState.state.per_page ?? defaultPerPage) || defaultPerPage
      : undefined;
    const urlSortBy = urlState
      ? urlState.state.sort_by
        ? String(urlState.state.sort_by)
        : null
      : undefined;
    const urlSortOrder = urlState
      ? ((urlState.state.sort_order as SortOrder | undefined) ?? 'asc')
      : undefined;
    const urlStatus = urlState
      ? ((urlState.state.effectiveStatus as ArchiveFilter | undefined) ??
        (urlState.state.status as ArchiveFilter | undefined) ??
        'active')
      : undefined;
    const urlSearch = urlState ? String(urlState.state.q ?? '') : undefined;

    const [pageState, setPage] = useState(1);
    const [perPageState, setPerPageState] = useState(defaultPerPage);
    const [sortByState, setSortBy] = useState<string | null>(defaultSort?.sortBy ?? null);
    const [sortOrderState, setSortOrder] = useState<SortOrder>(defaultSort?.sortOrder ?? 'asc');
    const [statusState, setStatusState] = useState<ArchiveFilter>('active');
    const [searchState, setSearch] = useState('');

    const page = urlPage ?? pageState;
    const perPage = urlPerPage ?? perPageState;
    const sortBy = urlSortBy !== undefined ? urlSortBy : sortByState;
    const sortOrder = urlSortOrder ?? sortOrderState;
    const status = urlStatus ?? statusState;
    const search = urlSearch ?? searchState;
    // #231 §5.1 — mount-time seed: the lazy initializer runs ONCE per provider
    // mount; later changes of the initialFilters prop are deliberately ignored
    // (seed, not live sync — a param arriving after mount is not picked up).
    // Merge over config defaults mirrors setFilters semantics. The cast is
    // sound: only the with-filters overload types the prop, and there
    // `config.filters.defaults` is required — the overlay keeps every F key.
    const [filters, setFiltersState] = useState<F | undefined>(() =>
      initialFilters
        ? ({ ...filtersDefaults, ...initialFilters } as F)
        : filtersDefaults,
    );
    // #349: in controlled mode every state key OTHER than the canonical
    // page/per_page/sort_by/sort_order/q/status names is a structured filter
    // (read-only view over urlState.state; setters go through update()).
    const urlFilters = urlState
      ? (() => {
          const rest: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(urlState.state)) {
            if (!CANONICAL_URL_KEYS.has(k)) rest[k] = v;
          }
          return rest as unknown as F;
        })()
      : undefined;
    const effectiveFilters = urlState ? urlFilters : filters;

    // #212 §5.5 pt 2 — serverSearch: the ≥2-char clamp lives here (one place,
    // covers DataTable withSearch inputs AND *Filters bars). Shorter values are
    // treated as unset: no q in key/fetch, unfiltered page shown, no 422 noise.
    const q = serverSearch && search.length >= 2 ? search : undefined;

    // Key slot order (#140 §5.2): prefix, page, perPage, [filters], [status],
    // sortBy, sortOrder, [q]. Classic consumers get arrays identical to the
    // pre-#140 ternary — pinned by the factory test suite.
    const queryKey: unknown[] = [queryKeyPrefix, page, perPage];
    if (effectiveFilters !== undefined) queryKey.push(effectiveFilters);
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
          ...(effectiveFilters !== undefined ? { filters: effectiveFilters } : {}),
        }),
      placeholderData: keepPreviousData,
    });

    const setPageUrl = useCallback(
      (n: number) => {
        if (urlState) {
          urlState.update({ page: n });
          return;
        }
        setPage(n);
      },
      [urlState],
    );
    const setPageExposed = urlState ? setPageUrl : setPage;

    const setPerPage = useCallback(
      (n: number) => {
        if (urlState) {
          // Explicit page: survives the per-page change in the same entry.
          urlState.update({ per_page: n, page: 1 });
          return;
        }
        setPerPageState(n);
        setPage(1);
      },
      [urlState],
    );

    const setSort = useCallback(
      (field: string, order: SortOrder) => {
        if (urlState) {
          // One atomic batch; a cleared sort (field '') leaves a possible
          // orphan sort_order — the hook's `requires` linkage ignores it.
          urlState.update({ sort_by: field, sort_order: order });
          return;
        }
        setSortBy(field);
        setSortOrder(order);
        setPage(1);
      },
      [urlState],
    );

    const setStatus = useCallback(
      (s: ArchiveFilter) => {
        if (urlState) {
          urlState.update({ status: s });
          return;
        }
        setStatusState(s);
        setPage(1);
      },
      [urlState],
    );

    // #140 T3 — with-filters only: merge-patch semantics mirroring the
    // hand-rolled ClientsContext precedent; a new filter set means a new
    // result set → restart at page 1. #349 controlled mode: ONE update()
    // batch — the hook's implicit page reset covers the restart-at-1 rule.
    const setFilters = useCallback(
      (patch: Partial<F>) => {
        if (urlState) {
          urlState.update(patch as Record<string, unknown>);
          return;
        }
        setFiltersState((prev) => (prev !== undefined ? { ...prev, ...patch } : prev));
        setPage(1);
      },
      [urlState],
    );

    const resetFilters = useCallback(() => {
      if (urlState) {
        // #349 clients adapter exposes `reset` (defaults = URL without
        // filter params; the clients variant also drops `clientId`, #232
        // §3.5) — prefer it over the defaults patch, which cannot strip
        // unmanaged params like clientId.
        if (urlState.reset) {
          urlState.reset();
          return;
        }
        // Defaults as the patch: the hook strips values equal to presets'
        // defaults during serialization → params disappear in one batch (page
        // auto-resets via the implicit rule — no explicit page key needed).
        urlState.update({ ...(filtersDefaults as object) });
        return;
      }
      setFiltersState(filtersDefaults);
      setPage(1);
    }, [urlState]);

    // serverSearch: a new q means a new result set → restart at page 1
    // (consistent with the setSort/setPerPage/setStatus reset contract).
    // #349 controlled mode: q joins the same atomic update.
    const setSearchWithReset = useCallback(
      (s: string) => {
        if (urlState) {
          urlState.update({ q: s });
          return;
        }
        setSearch(s);
        if (serverSearch) setPage(1);
      },
      [urlState],
    );

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
    // #349 controlled mode: single service correction — total>0 →
    // ceil(total/per_page) (may equal the current page), total=0 → default 1;
    // served via history: 'replace'. Uncontrolled keeps the classic decrement.
    const total = data?.total ?? 0;
    useEffect(() => {
      if (isPending || isFetching || items.length !== 0 || page <= 1) return;
      if (urlState) {
        const corrected = total > 0 ? Math.ceil(total / perPage) : 1;
        if (corrected < page) urlState.update({ page: corrected }, { history: 'replace' });
        return;
      }
      setPage(page - 1);
    }, [isPending, isFetching, items.length, page, perPage, total, urlState]);

    // #140 T3 — value built exactly as the classic shape PLUS a conditional
    // filters spread: classic consumers see no new members (bit-identical),
    // with-filters consumers get the typed PagedListFiltersState<F> trio via
    // the overload signature.
    const value: PagedListContextValue<T> & Partial<PagedListFiltersState<F>> = {
      items,
      visibleItems,
      total,
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
      setPage: setPageExposed,
      setPerPage,
      setSort,
      setStatus,
      setSearch: setSearchWithReset,
      refetch,
      ...(effectiveFilters !== undefined
        ? { filters: effectiveFilters, setFilters, resetFilters }
        : {}),
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
