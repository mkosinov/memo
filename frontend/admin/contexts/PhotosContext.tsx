'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { getPhotos } from '@memo/api-client';
import type {
  PhotoResponse,
  PhotoListResponse,
  PhotoListParams,
  ServiceResponse,
  LocationResponse,
} from '@memo/api-client';
import { useServicesRaw } from '@/hooks/useServices';
import { useLocationsRaw } from '@/hooks/useLocations';
import { qk } from '@/lib/queryKeys';
import type { PagedListState } from '@/app/components/shared/tableTypes';
import type { SortOrder } from './createPagedListContext';

// ─── Server-driven photos list (GH #211 Task 6) ────────────────────────────
// Replaces the #139 client adapter: GET /api/v1/photos is now paginated, so
// page/perPage/sort/q/filters travel to the server verbatim (RecordsContext
// model). The PagedListState contract seen by <DataTable> is unchanged.

export interface PhotoFilters {
  client_id?: string;
  activity_id?: string;
  service_id?: string;
  location_id?: string;
  tag_id: string[];
}

const EMPTY_FILTERS: PhotoFilters = { tag_id: [] };

/** Server sort whitelist (domain-rules/photos.md); default order created_at desc. */
export type PhotoSortField = 'filename' | 'is_public' | 'created_at';

export interface PhotosContextType {
  /** Server-page items — PagedListState.items contract (spec §6.4, #139 T8). */
  items: PhotoResponse[];
  /** Server search owns the filter — the predicate view is bypassed (#212 precedent). */
  visibleItems: PhotoResponse[];
  total: number;
  page: number;
  perPage: number;
  sortBy: string | null;
  sortOrder: SortOrder;
  /** Contract name; mapped to `q` at the fetcher (spec §7.2). */
  search: string;
  filters: PhotoFilters;
  isPending: boolean;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  /** /all dictionaries (shared raw hooks, 1h dict staleTime) — service/location titles resolve client-side. */
  servicesMap: Map<string, ServiceResponse>;
  locationsMap: Map<string, LocationResponse>;
  setPage: (page: number) => void;
  setPerPage: (perPage: number) => void;
  setSort: (field: string, order: SortOrder) => void;
  setSearch: (s: string) => void;
  setFilters: (newFilters: Partial<PhotoFilters>) => void;
  /** Clears filters + search, resets page to 1. */
  resetFilters: () => void;
  refetch: () => void;
}

const PhotosContext = createContext<PhotosContextType | null>(null);

export function PhotosProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [perPage, setPerPageState] = useState(10);
  const [sortBy, setSortBy] = useState<string | null>('created_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [search, setSearchState] = useState('');
  const [filters, setFiltersState] = useState<PhotoFilters>(EMPTY_FILTERS);

  // Server 422s on q < 2 chars — clamp: treated as unset until ≥2 (RecordsContext
  // precedent, GH #212). Lives in ONE place: covers the key AND the fetcher, so a
  // 1-char search neither fires a request nor changes the cache key.
  const q = search.length >= 2 ? search : undefined;

  const refetch = useCallback(() => {
    void queryClient.refetchQueries({ queryKey: qk.photos });
  }, [queryClient]);

  const { data, isLoading, isPending, isFetching, error } = useQuery<PhotoListResponse>({
    queryKey: [qk.photos[0], { page, perPage, sortBy, sortOrder, q, ...filters }],
    queryFn: () => getPhotos({
      page,
      per_page: perPage,
      sort_by: sortBy ? (sortBy as PhotoSortField) : undefined,
      sort_order: sortOrder,
      q,
      client_id: filters.client_id || undefined,
      activity_id: filters.activity_id || undefined,
      service_id: filters.service_id || undefined,
      location_id: filters.location_id || undefined,
      tag_id: filters.tag_id.length ? filters.tag_id : undefined,
    } satisfies PhotoListParams),
    placeholderData: keepPreviousData,
  });
  const items = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;

  // A new filter/search means a new result set → restart at page 1
  // (RecordsContext precedent).
  const setFilters = useCallback((newFilters: Partial<PhotoFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...newFilters }));
    setPage(1);
  }, []);

  const setSearch = useCallback((s: string) => {
    setSearchState(s);
    setPage(1);
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState(EMPTY_FILTERS);
    setSearchState('');
    setPage(1);
  }, []);

  const setPerPage = useCallback((pp: number) => {
    setPerPageState(pp);
    setPage(1);
  }, []);

  // PagedListState.setSort contract (spec §6.4): field+order applied verbatim
  // + page reset (§6.10.2). `field` is `string` per the contract; the server
  // whitelist validates it upstream.
  const setSort = useCallback((field: string, order: SortOrder) => {
    setSortBy(field);
    setSortOrder(order);
    setPage(1);
  }, []);

  // Spec §6.7 page clamp — after a SETTLED fetch returns an empty non-first
  // page (e.g. last row of page N deleted), step back. `!isFetching` guards
  // against mid-refetch races with keepPreviousData.
  useEffect(() => {
    if (!isPending && !isFetching && items.length === 0 && page > 1) {
      setPage(page - 1);
    }
  }, [isPending, isFetching, items.length, page]);

  // Always-cached reference data (bare /all lists — #205) via the shared raw
  // hooks (#140); same keys as RecordsContext so the dictionaries load once
  // across contexts. Dict staleTime = 1h (queryKeys.ts) — was Infinity here.
  const { data: servicesRaw = [] } = useServicesRaw();

  const { data: locationsRaw = [] } = useLocationsRaw();

  const servicesMap = useMemo(() => {
    const map = new Map<string, ServiceResponse>();
    servicesRaw.forEach((s) => map.set(s.id, s));
    return map;
  }, [servicesRaw]);

  const locationsMap = useMemo(() => {
    const map = new Map<string, LocationResponse>();
    locationsRaw.forEach((l) => map.set(l.id, l));
    return map;
  }, [locationsRaw]);

  const contextValue = useMemo<PhotosContextType>(
    () => ({
      items,
      visibleItems: items,
      total,
      page,
      perPage,
      sortBy,
      sortOrder,
      search,
      filters,
      isPending,
      isLoading,
      isFetching,
      error: error ?? null,
      servicesMap,
      locationsMap,
      setPage,
      setPerPage,
      setSort,
      setSearch,
      setFilters,
      resetFilters,
      refetch,
    }),
    [items, total, page, perPage, sortBy, sortOrder, search, filters, isPending, isLoading, isFetching, error, servicesMap, locationsMap, setPerPage, setSort, setSearch, setFilters, resetFilters, refetch],
  );

  return (
    <PhotosContext.Provider value={contextValue}>
      {children}
    </PhotosContext.Provider>
  );
}

export function usePhotosTable(): PhotosContextType {
  const context = useContext(PhotosContext);
  if (!context) throw new Error('usePhotosTable must be used within PhotosProvider');
  return context;
}

// Compile-time drift guard (#139 T1): the context value must always satisfy the
// DataTable-facing PagedListState contract. Type-only — no runtime cycle.
const _assertAssignable: (v: PhotosContextType) => PagedListState<PhotoResponse> = (v) => v;
void _assertAssignable;
