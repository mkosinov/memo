import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getPhotos } from '@memo/api-client';
import type { PhotoResponse } from '@memo/api-client';
import { PhotosProvider, usePhotosTable } from '../contexts/PhotosContext';

// ─── Mock @memo/api-client — spy on getPhotos (preserve other exports) ─────
// The adapter fetcher wraps the UNPAGINATED getPhotos(); the tests assert the
// client-side pagination envelope (slicing, total, sort) built around it.

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return { ...actual, getPhotos: vi.fn() };
});

const mockGetPhotos = vi.mocked(getPhotos);

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makePhoto(i: number, overrides: Partial<PhotoResponse> = {}): PhotoResponse {
  return {
    id: `p-${i}`,
    filename: `photo-${String(i).padStart(3, '0')}.jpg`,
    visitor_id: null,
    service_id: null,
    activity_id: null,
    is_public: i % 2 === 0,
    tags: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Real QueryClient (retry: false) + real PhotosProvider; data via mocked getPhotos. */
function setup(photos: PhotoResponse[]) {
  mockGetPhotos.mockResolvedValue(photos);
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

// ─── T7 client-adapter tests (Part A) ──────────────────────────────────────

describe('PhotosContext client adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('slices page 1 of the full array and exposes total (no sort → API order kept)', async () => {
    const photos = Array.from({ length: 25 }, (_, i) => makePhoto(i + 1));
    const { result } = setup(photos);

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });

    // Adapter calls the unpaginated endpoint with no params (interim — #211
    // swaps internals for server pagination).
    expect(mockGetPhotos).toHaveBeenCalledWith();

    expect(result.current.items.map((p) => p.id)).toEqual([
      'p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6', 'p-7', 'p-8', 'p-9', 'p-10',
    ]);
    expect(result.current.total).toBe(25);
    expect(result.current.page).toBe(1);
    expect(result.current.perPage).toBe(10);
    expect(result.current.sortBy).toBeNull();
    expect(result.current.search).toBe('');
    expect(result.current.visibleItems).toBeUndefined();
  });

  it('setPage slices (page-1)*per_page windows, including a partial last page', async () => {
    const photos = Array.from({ length: 25 }, (_, i) => makePhoto(i + 1));
    const { result } = setup(photos);

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });

    act(() => {
      result.current.setPage(2);
    });
    await waitFor(() => {
      expect(result.current.items[0]?.id).toBe('p-11');
    });
    expect(result.current.items).toHaveLength(10);
    expect(result.current.items[9]?.id).toBe('p-20');
    expect(result.current.total).toBe(25);

    act(() => {
      result.current.setPage(3);
    });
    await waitFor(() => {
      expect(result.current.items[0]?.id).toBe('p-21');
    });
    // Partial last page: 25 - 20 = 5 rows
    expect(result.current.items.map((p) => p.id)).toEqual([
      'p-21', 'p-22', 'p-23', 'p-24', 'p-25',
    ]);
    expect(result.current.total).toBe(25);
  });

  it('setPerPage(20) re-slices from the start and resets page to 1', async () => {
    const photos = Array.from({ length: 25 }, (_, i) => makePhoto(i + 1));
    const { result } = setup(photos);

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });

    act(() => {
      result.current.setPerPage(20);
    });

    await waitFor(() => {
      expect(result.current.items).toHaveLength(20);
    });
    expect(result.current.items[0]?.id).toBe('p-1');
    expect(result.current.items[19]?.id).toBe('p-20');
    expect(result.current.page).toBe(1);
    expect(result.current.perPage).toBe(20);
  });

  it('setSort(filename) applies the pre-#139 client comparator — asc then desc', async () => {
    // Order chosen so API order ≠ sorted order for BOTH directions.
    const photos = [
      makePhoto(1, { filename: 'ягода.jpg' }),
      makePhoto(2, { filename: 'арбуз.jpg' }),
      makePhoto(3, { filename: 'банан.jpg' }),
    ];
    const { result } = setup(photos);

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });
    // No sort picked yet → API order preserved verbatim.
    expect(result.current.items.map((p) => p.id)).toEqual(['p-1', 'p-2', 'p-3']);

    act(() => {
      result.current.setSort('filename', 'asc');
    });
    await waitFor(() => {
      expect(result.current.items.map((p) => p.filename)).toEqual([
        'арбуз.jpg', 'банан.jpg', 'ягода.jpg',
      ]);
    });
    expect(result.current.page).toBe(1); // setSort resets page (§6.10.2)

    act(() => {
      result.current.setSort('filename', 'desc');
    });
    await waitFor(() => {
      expect(result.current.items.map((p) => p.filename)).toEqual([
        'ягода.jpg', 'банан.jpg', 'арбуз.jpg',
      ]);
    });
  });

  it('setSort(is_public) sorts booleans false-before-true on asc (verbatim old comparator)', async () => {
    const photos = [
      makePhoto(1, { is_public: true }),
      makePhoto(2, { is_public: false }),
      makePhoto(3, { is_public: true }),
    ];
    const { result } = setup(photos);

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });

    act(() => {
      result.current.setSort('is_public', 'asc');
    });
    // Old comparator: true ? 1 : -1 → false sorts FIRST; stable sort keeps the
    // API order among equal values (p-2 false; then p-1, p-3 true).
    await waitFor(() => {
      expect(result.current.items.map((p) => p.id)).toEqual(['p-2', 'p-1', 'p-3']);
    });

    act(() => {
      result.current.setSort('is_public', 'desc');
    });
    await waitFor(() => {
      expect(result.current.items.map((p) => p.id)).toEqual(['p-1', 'p-3', 'p-2']);
    });
  });

  it('setSearch filters the loaded page into visibleItems via the filename predicate', async () => {
    const photos = [
      makePhoto(1, { filename: 'море.jpg' }),
      makePhoto(2, { filename: 'горы.png' }),
    ];
    const { result } = setup(photos);

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });

    // Empty search → no derived view.
    expect(result.current.visibleItems).toBeUndefined();

    // Case-insensitive filename match (predicate-only; no refetch, key stays
    // search-free — spec §6.7 dict search contract).
    act(() => {
      result.current.setSearch('ГОРЫ');
    });
    await waitFor(() => {
      expect(result.current.visibleItems).toEqual([
        expect.objectContaining({ id: 'p-2' }),
      ]);
    });
    expect(result.current.items).toHaveLength(2); // items keeps its page contract

    // Clearing restores the unfiltered view.
    act(() => {
      result.current.setSearch('');
    });
    await waitFor(() => {
      expect(result.current.visibleItems).toBeUndefined();
    });
  });
});
