/**
 * Tests for PhotosContext — server-driven list (GH #211 Task 6).
 *
 * The provider is a hand-rolled server context modeled on RecordsContext:
 *   queryKey: ['photos', { page, perPage, sortBy, sortOrder, q, ...filters }]
 *   queryFn:  getPhotos({ page, per_page, sort_by, sort_order, q, ...filters })
 * plus the /all dictionary maps (servicesMap, locationsMap).
 *
 * Server semantics under test: query key composition, page reset on
 * setFilters/setSearch, the ≥2-char q clamp (server 422s below 2), the
 * per_page=10 default, sort param mapping, the §6.7 page clamp, and the
 * dictionary map loads.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── Mock @memo/api-client — spy on the three endpoints (keep the rest) ───

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    getPhotos: vi.fn(),
    getAllServices: vi.fn(),
    getAllLocations: vi.fn(),
  };
});

import { getPhotos, getAllServices, getAllLocations } from '@memo/api-client';
import type {
  PhotoResponse,
  PhotoListResponse,
  ServiceResponse,
  LocationResponse,
} from '@memo/api-client';
import { PhotosProvider, usePhotosTable } from '../contexts/PhotosContext';

const mockGetPhotos = vi.mocked(getPhotos);
const mockGetAllServices = vi.mocked(getAllServices);
const mockGetAllLocations = vi.mocked(getAllLocations);

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makePhoto(i: number, overrides: Partial<PhotoResponse> = {}): PhotoResponse {
  return {
    id: `p-${i}`,
    filename: `photo-${String(i).padStart(3, '0')}.jpg`,
    client_id: null,
    service_id: null,
    activity_id: null,
    location_id: null,
    is_public: i % 2 === 0,
    tags: [],
    client_name: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeService(id: string, overrides: Partial<ServiceResponse> = {}): ServiceResponse {
  return {
    id,
    title: `Service ${id}`,
    description: '',
    image_url: '',
    specialty: '',
    min_age: 0,
    max_age: null,
    duration: 60,
    record_info: '',
    tariffs: [],
    tags: [],
    materials: [],
    archived: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeLocation(id: string, overrides: Partial<LocationResponse> = {}): LocationResponse {
  return {
    id,
    name: `Location ${id}`,
    address: null,
    description: null,
    capacity: 10,
    yandex_map_url: null,
    review_url: null,
    record_info: null,
    image_url: null,
    archived: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Server envelope the paginated GET /api/v1/photos returns. */
function envelope(
  items: PhotoResponse[],
  overrides: Partial<PhotoListResponse> = {},
): PhotoListResponse {
  return { items, total: items.length, page: 1, per_page: 10, ...overrides };
}

/** Real QueryClient (retry: false) + real PhotosProvider; data via mocked api-client. */
function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <PhotosProvider>{children}</PhotosProvider>
      </QueryClientProvider>
    );
  }
  const hook = renderHook(() => usePhotosTable(), { wrapper: Wrapper });
  return { ...hook, queryClient };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('PhotosContext — server-driven list (GH #211 Task 6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPhotos.mockResolvedValue(envelope([]));
    mockGetAllServices.mockResolvedValue([]);
    mockGetAllLocations.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('composes the query key from page/perPage/sort/q/filters and maps fetch params to snake_case', async () => {
    const { result, queryClient } = setup();

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });

    // findAll prefix-matches ('photos', ...); find() is exact-only in v5.
    const photosQuery = queryClient.getQueryCache().findAll({ queryKey: ['photos'] })[0];
    expect(photosQuery?.queryKey).toEqual([
      'photos',
      {
        page: 1,
        perPage: 10,
        sortBy: 'created_at',
        sortOrder: 'desc',
        q: undefined,
        tag_id: [],
      },
    ]);

    // Fetcher receives the server-shaped snake_case params (q/tag_id unset →
    // undefined so the api-client omits them from the query string).
    expect(mockGetPhotos).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        per_page: 10,
        sort_by: 'created_at',
        sort_order: 'desc',
        q: undefined,
        tag_id: undefined,
      }),
    );
  });

  it('defaults to per_page=10', async () => {
    const { result } = setup();

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });

    expect(result.current.perPage).toBe(10);
    expect(mockGetPhotos).toHaveBeenCalledWith(
      expect.objectContaining({ per_page: 10 }),
    );
  });

  it('setFilters resets page to 1 and sends the filters to the server', async () => {
    const { result } = setup();

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });

    act(() => {
      result.current.setPage(2);
    });
    await waitFor(() => {
      expect(mockGetPhotos).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2 }),
      );
    });

    act(() => {
      result.current.setFilters({ service_id: 's-1', tag_id: ['t-1', 't-2'] });
    });

    await waitFor(() => {
      expect(mockGetPhotos).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 1,
          service_id: 's-1',
          tag_id: ['t-1', 't-2'],
        }),
      );
    });
    expect(result.current.page).toBe(1);
    expect(result.current.filters).toEqual({ service_id: 's-1', tag_id: ['t-1', 't-2'] });
  });

  it('setSearch resets page to 1 and sends q for a ≥2-char search', async () => {
    const { result } = setup();

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });

    act(() => {
      result.current.setPage(2);
    });
    await waitFor(() => {
      expect(mockGetPhotos).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2 }),
      );
    });

    act(() => {
      result.current.setSearch('море');
    });

    await waitFor(() => {
      expect(mockGetPhotos).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, q: 'море' }),
      );
    });
    expect(result.current.page).toBe(1);
    expect(result.current.search).toBe('море');
  });

  it('does NOT fetch with q for a 1-char search (≥2-char clamp — server min_length=2)', async () => {
    const { result } = setup();

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });

    const callsBefore = mockGetPhotos.mock.calls.length;

    act(() => {
      result.current.setSearch('м');
    });

    // The search state lands…
    await waitFor(() => {
      expect(result.current.search).toBe('м');
    });
    // …but the clamped q keeps the query key unchanged → no new fetch fires.
    expect(mockGetPhotos.mock.calls.length).toBe(callsBefore);
    // And nothing ever carried a sub-2-char q.
    expect(
      mockGetPhotos.mock.calls.every(([params]) => params?.q === undefined),
    ).toBe(true);
  });

  it('setSort maps field+order to sort_by/sort_order and resets page to 1', async () => {
    const { result } = setup();

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });

    act(() => {
      result.current.setPage(3);
    });
    await waitFor(() => {
      expect(mockGetPhotos).toHaveBeenCalledWith(
        expect.objectContaining({ page: 3 }),
      );
    });

    act(() => {
      result.current.setSort('filename', 'asc');
    });

    expect(result.current.sortBy).toBe('filename');
    expect(result.current.sortOrder).toBe('asc');
    await waitFor(() => {
      expect(mockGetPhotos).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 1,
          sort_by: 'filename',
          sort_order: 'asc',
        }),
      );
    });
  });

  it('page clamp: a settled empty non-first page steps back (§6.7)', async () => {
    // Page 1 has one row; every later page is empty (list shrunk — the
    // last-row-deleted case).
    mockGetPhotos.mockImplementation((params) =>
      Promise.resolve(envelope(params?.page && params.page > 1 ? [] : [makePhoto(1)])),
    );

    const { result } = setup();

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
      expect(result.current.items).toHaveLength(1);
    });

    act(() => {
      result.current.setPage(2);
    });

    // Page-2 fetch settles empty → the clamp effect steps back to page 1.
    await waitFor(() => {
      expect(result.current.page).toBe(1);
    });
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
    });
  });

  it('loads /all services + locations once into servicesMap/locationsMap', async () => {
    mockGetAllServices.mockResolvedValue([makeService('s-1')]);
    mockGetAllLocations.mockResolvedValue([makeLocation('l-1')]);

    const { result } = setup();

    await waitFor(() => {
      expect(result.current.servicesMap.get('s-1')?.title).toBe('Service s-1');
      expect(result.current.locationsMap.get('l-1')?.name).toBe('Location l-1');
    });
    expect(mockGetAllServices).toHaveBeenCalledTimes(1);
    expect(mockGetAllLocations).toHaveBeenCalledTimes(1);
  });

  it('resetFilters clears filters + search and resets page to 1', async () => {
    const { result } = setup();

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });

    act(() => {
      result.current.setFilters({ service_id: 's-1' });
    });
    act(() => {
      result.current.setSearch('море');
    });
    await waitFor(() => {
      expect(mockGetPhotos).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: 'море', service_id: 's-1' }),
      );
    });

    act(() => {
      result.current.setPage(2);
    });
    await waitFor(() => {
      expect(mockGetPhotos).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2 }),
      );
    });

    act(() => {
      result.current.resetFilters();
    });

    expect(result.current.filters).toEqual({ tag_id: [] });
    expect(result.current.search).toBe('');
    await waitFor(() => {
      expect(result.current.page).toBe(1);
    });
    await waitFor(() => {
      expect(mockGetPhotos).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, q: undefined, tag_id: undefined }),
      );
    });
    // The reset fetch carries no leftover filter params.
    const lastParams = mockGetPhotos.mock.calls.at(-1)?.[0] ?? {};
    expect(lastParams.service_id).toBeUndefined();
  });
});
