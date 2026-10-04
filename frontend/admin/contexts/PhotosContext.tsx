'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
import { isValidTagId } from '@/app/(main)/photos/usePhotosUrlState';
import type { PhotosUrlAdapter, PhotosUrlStateView } from '@/app/(main)/photos/usePhotosUrlState';
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

/** Value equality of two mirror views (tag arrays compare element-wise). */
function photosStateEq(a: PhotosUrlStateView, b: PhotosUrlStateView): boolean {
  return (
    a.search === b.search &&
    a.page === b.page &&
    a.perPage === b.perPage &&
    a.tagIds.length === b.tagIds.length &&
    a.tagIds.every((id, i) => id === b.tagIds[i])
  );
}

/** Sanitize a tag write through the adapter (mirror == URL == wire). */
function sanitizeTagIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!isValidTagId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 20) break;
  }
  return out;
}

export function PhotosProvider({
  children,
  urlState,
}: {
  children: React.ReactNode;
  /**
   * #349 Task 8 — the page-scoped URL adapter (managed mode): the q/tag_id/
   * page/per_page half of the table state is URL state; every setter is a
   * URL write through the adapter's single useTableUrlState instance
   * (RecordsProvider precedent). Sort + the id filters (client/activity/
   * service/location) are NOT in the photos URL contract (spec §5 п.6) —
   * they stay provider-local state.
   */
  urlState: PhotosUrlAdapter;
}) {
  const queryClient = useQueryClient();
  const { state: urlSnapshot, update } = urlState;

  // #349 Task 8 — OPTIMISTIC MIRROR (RecordsProvider precedent). The URL is
  // the source of truth, but a query-key switch driven by a router
  // navigation Transition lets the React Query data notification race the
  // DOM read. The mirror restores the synchronous flow: every setter applies
  // its value LOCALLY at once and the URL write follows; EXTERNAL
  // navigations (deep link / «назад») are adopted by the effect below once
  // the URL state actually differs from a pending write.
  const [mirror, setMirror] = useState<PhotosUrlStateView>(urlSnapshot);
  /** Read-latest base for same-tick writes — never re-subscribes effects. */
  const mirrorRef = useRef(mirror);
  const pendingWriteRef = useRef<PhotosUrlStateView | null>(null);

  /** Keep ref + state in lockstep (single-writer discipline). */
  const commitMirror = useCallback((next: PhotosUrlStateView) => {
    mirrorRef.current = next;
    setMirror(next);
  }, []);

  // Deps include `mirror` as a TRIGGER only (values are read from refs):
  // a write whose target URL equals the current URL (a coalesced no-op)
  // produces NO URL event, so the pending comparison must also run right
  // after each commitMirror.
  useEffect(() => {
    const pending = pendingWriteRef.current;
    if (pending) {
      // Our own write is in flight: adopt NOTHING until its navigation
      // commits (the URL then equals the pending values).
      if (photosStateEq(pending, urlSnapshot)) {
        pendingWriteRef.current = null;
      }
      return;
    }
    if (!photosStateEq(mirrorRef.current, urlSnapshot)) {
      commitMirror(urlSnapshot);
    }
  }, [urlSnapshot, mirror, commitMirror]);

  /**
   * Apply a write optimistically: mirror now, URL right after. The next
   * state is BUILT from the latest committed view (an in-flight pending,
   * else the mirror ref) so two writes in the same tick compose instead of
   * the second overwriting the first from a stale snapshot.
   */
  const applyWrite = useCallback(
    (
      build: (prev: PhotosUrlStateView) => PhotosUrlStateView,
      urlPatch: Parameters<PhotosUrlAdapter['update']>[0],
      options?: { history?: 'push' | 'replace' },
    ) => {
      const next = build(pendingWriteRef.current ?? mirrorRef.current);
      pendingWriteRef.current = next;
      commitMirror(next);
      update(urlPatch, options);
    },
    [update, commitMirror],
  );

  const { search, tagIds, page, perPage } = mirror;

  // NOT in the photos URL contract (spec §5 п.6): sort + the id filters
  // (client/activity/service/location) stay local provider state.
  const [sortBy, setSortBy] = useState<string | null>('created_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [localFilters, setLocalFilters] = useState<Omit<PhotoFilters, 'tag_id'>>({});

  // Server 422s on q < 2 chars — clamp: treated as unset until ≥2 (RecordsContext
  // precedent, GH #212). Lives in ONE place: covers the key AND the fetcher, so a
  // 1-char search neither fires a request nor changes the cache key.
  const q = search.length >= 2 ? search : undefined;

  const filters = useMemo<PhotoFilters>(
    () => ({ ...localFilters, tag_id: tagIds }),
    [localFilters, tagIds],
  );

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

  // #349 Task 8 — setters are optimistic URL writes: the value lands in the
  // mirror at once (synchronous re-render) and the URL navigation follows;
  // the hook's filter-change rule resets page→1 in the SAME navigation
  // (spec §3) — the mirror applies the identical reset to stay in lockstep.
  // The hook clamps `page` into 1…10⁴ on its URL read; the mirror must clamp
  // on WRITE too — an out-of-range mirror page never equals the clamped URL
  // snapshot and would pin pendingWriteRef forever.
  const setPage = useCallback(
    (p: number) => {
      const clamped = Math.min(10_000, Math.max(1, p));
      applyWrite((prev) => ({ ...prev, page: clamped }), { page: clamped });
    },
    [applyWrite],
  );

  const setPerPage = useCallback(
    (pp: number) => applyWrite((prev) => ({ ...prev, perPage: pp, page: 1 }), { perPage: pp }),
    [applyWrite],
  );

  // PagedListState.setSort contract (spec §6.4): field+order applied verbatim
  // + page reset (§6.10.2). Sort is NOT in the photos URL contract (spec
  // §5 п.6): local state + the page reset through the URL (stripped when
  // already at the default 1). `field` is `string` per the contract; the
  // server whitelist validates it upstream.
  const setSort = useCallback(
    (field: string, order: SortOrder) => {
      setSortBy(field);
      setSortOrder(order);
      applyWrite((prev) => ({ ...prev, page: 1 }), { page: 1 });
    },
    [applyWrite],
  );

  const setSearch = useCallback(
    (s: string) => applyWrite((prev) => ({ ...prev, search: s, page: 1 }), { search: s }),
    [applyWrite],
  );

  // A new filter/search means a new result set → restart at page 1
  // (RecordsContext precedent). tag_id goes through the URL (spec §5 п.6);
  // the id filters stay local — ANY filter change still resets page→1 (an
  // already-default page serializes to a no-op URL write).
  const setFilters = useCallback(
    (newFilters: Partial<PhotoFilters>) => {
      const { tag_id: _tagId, ...rest } = newFilters;
      if (Object.keys(rest).length > 0) {
        setLocalFilters((prev) => ({ ...prev, ...rest }));
      }
      // One sanitized array feeds BOTH the mirror build and the URL patch
      // (mirror == URL == wire); undefined = tag_id not in this patch.
      const nextTagIds =
        newFilters.tag_id !== undefined ? sanitizeTagIds(newFilters.tag_id) : undefined;
      // With tag_id the hook's filter rule resets page implicitly; a
      // local-only change must carry the page reset EXPLICITLY (an empty
      // patch would never navigate → a pending page≠URL write would pin
      // pendingWriteRef forever). An already-default page serializes to a
      // no-op URL write (cleared by the pending==snapshot comparison).
      const tagPatch: Parameters<PhotosUrlAdapter['update']>[0] =
        nextTagIds !== undefined ? { tagIds: nextTagIds } : { page: 1 };
      applyWrite(
        (prev) => ({
          ...prev,
          ...(nextTagIds !== undefined ? { tagIds: nextTagIds } : {}),
          page: 1,
        }),
        tagPatch,
      );
    },
    [applyWrite],
  );

  const resetFilters = useCallback(() => {
    setLocalFilters({});
    applyWrite((prev) => ({ ...prev, tagIds: [], search: '', page: 1 }), { tagIds: [], search: '' });
  }, [applyWrite]);

  // Spec §6.7 page clamp — after a SETTLED fetch returns an empty non-first
  // page (e.g. last row of page N deleted), step back. `!isFetching` guards
  // against mid-refetch races with keepPreviousData. #349: a service
  // correction — written with history:'replace' (no extra history entry).
  useEffect(() => {
    const settled = data?.items || [];
    if (!isPending && !isFetching && settled.length === 0 && page > 1) {
      const stepBack = Math.max(1, page - 1);
      applyWrite((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }), { page: stepBack }, { history: 'replace' });
    }
  }, [isPending, isFetching, data, page, applyWrite]);

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
    [items, total, page, perPage, sortBy, sortOrder, search, filters, isPending, isLoading, isFetching, error, servicesMap, locationsMap, setPage, setPerPage, setSort, setSearch, setFilters, resetFilters, refetch],
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
