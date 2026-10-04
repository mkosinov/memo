import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock only the wire fetcher — PhotosContext stays REAL, so this pins the
// actual fetcher params (useLocationsUrlState.test.tsx precedent).
vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return { ...actual, getPhotos: vi.fn() };
});
// Dictionary hooks — stubbed to empty (the adapter test asserts LIST params
// only; the dicts would otherwise fire extra mocked api calls).
vi.mock('@/hooks/useServices', () => ({ useServicesRaw: () => ({ data: [] }) }));
vi.mock('@/hooks/useLocations', () => ({ useLocationsRaw: () => ({ data: [] }) }));

// Real next/navigation shape via the shared stateful mock — the page-scoped
// hook reads AND writes through it, so pushed URLs must re-render the tree.
vi.mock('next/navigation', async () => await import('./helpers/nextNavigationMock'));
import { __resetNavigation, __lastPushedUrl } from './helpers/nextNavigationMock';

import { getPhotos } from '@memo/api-client';
import {
  usePhotosUrlState,
  photosUrlConfig,
} from '../app/(main)/photos/usePhotosUrlState';
import { PhotosProvider, usePhotosTable } from '@/contexts/PhotosContext';

const mockGetPhotos = vi.mocked(getPhotos);

/**
 * Paged envelope with enough rows that ANY page ≤ 2 at per_page 50 is
 * legitimately non-empty — otherwise the §6.7 page-clamp effect correctly
 * steps back to page 1 and fires a second fetch (test-data realism).
 */
function photoEnvelope(): { items: unknown[]; total: number; page: number; per_page: number } {
  return { items: Array.from({ length: 55 }, (_, i) => ({ id: `ph${i}` })), total: 55, page: 1, per_page: 50 };
}

function lastWireParams(): Record<string, unknown> {
  const calls = mockGetPhotos.mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

beforeEach(() => {
  mockGetPhotos.mockResolvedValue(photoEnvelope() as never);
  __resetNavigation('', '/photos');
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

/** Real-time sleep past the ~16ms coalescing window, inside act. */
async function settle(ms = 30): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe('usePhotosUrlState — config (#349 Task 8)', () => {
  it('exposes the canonical preset contract: q + tag_id arrayOf + page + per_page', () => {
    // Spec §5 п.6 — photos URL contract is q + tag_id + page (+ per_page:
    // the table has a page-size selector). Sort is NOT part of the contract.
    expect(Object.keys(photosUrlConfig).sort()).toEqual(['page', 'per_page', 'q', 'tag_id']);
    expect(photosUrlConfig.q).toEqual({ kind: 'string', maxLength: 200, defaultValue: '' });
    expect(photosUrlConfig.tag_id?.kind).toBe('arrayOf');
    expect(photosUrlConfig.page).toEqual({ kind: 'int', min: 1, max: 10000, defaultValue: 1 });
    expect(photosUrlConfig.per_page).toEqual({
      kind: 'enum',
      values: [10, 20, 50, 100],
      defaultValue: 10,
    });
  });

  it('repeated tag_id params are kept in order: tag1+tag2 → ["tag1","tag2"]', () => {
    __resetNavigation('?tag_id=tag1&tag_id=tag2', '/photos');
    const { result } = renderHook(() => usePhotosUrlState());
    expect(result.current.state.tagIds).toEqual(['tag1', 'tag2']);
  });

  it('duplicates are deduped: tag1+tag1 → ["tag1"]', () => {
    __resetNavigation('?tag_id=tag1&tag_id=tag1', '/photos');
    const { result } = renderHook(() => usePhotosUrlState());
    expect(result.current.state.tagIds).toEqual(['tag1']);
  });

  it('invalid elements are dropped, valid kept: empty/garbage + tag1 → ["tag1"]', () => {
    __resetNavigation('?tag_id=&tag_id=%21%21bad%21%21&tag_id=tag1', '/photos');
    const { result } = renderHook(() => usePhotosUrlState());
    expect(result.current.state.tagIds).toEqual(['tag1']);
  });

  it('more than 20 tags are truncated to the first 20', () => {
    const params = Array.from({ length: 25 }, (_, i) => `tag_id=tag${i}`).join('&');
    __resetNavigation(`?${params}`, '/photos');
    const { result } = renderHook(() => usePhotosUrlState());
    expect(result.current.state.tagIds).toHaveLength(20);
    expect(result.current.state.tagIds[0]).toBe('tag0');
    expect(result.current.state.tagIds[19]).toBe('tag19');
  });

  it('absent tag_id → empty array (param absent state)', () => {
    const { result } = renderHook(() => usePhotosUrlState());
    expect(result.current.state.tagIds).toEqual([]);
  });

  it('dirty page falls back to 1 silently, URL untouched', () => {
    __resetNavigation('?page=0&per_page=7', '/photos');
    const { result } = renderHook(() => usePhotosUrlState());
    expect(result.current.state.page).toBe(1);
    expect(result.current.state.perPage).toBe(10);
    expect(__lastPushedUrl()).toBeNull();
  });

  it('update({tagIds}) writes repeated params + implicit page reset in one push', async () => {
    __resetNavigation('?page=3', '/photos');
    const { result } = renderHook(() => usePhotosUrlState());
    act(() => {
      result.current.update({ tagIds: ['tag1', 'tag2'] });
    });
    await settle();
    expect(__lastPushedUrl()).toBe('/photos?tag_id=tag1&tag_id=tag2');
  });

  it('update({tagIds: []}) removes the param entirely (empty array = absent)', async () => {
    __resetNavigation('?tag_id=tag1', '/photos');
    const { result } = renderHook(() => usePhotosUrlState());
    act(() => {
      result.current.update({ tagIds: [] });
    });
    await settle();
    expect(__lastPushedUrl()).toBe('/photos');
  });

  it('update({search}) writes q to the URL', async () => {
    const { result } = renderHook(() => usePhotosUrlState());
    act(() => {
      result.current.update({ search: 'guest' });
    });
    await settle();
    expect(__lastPushedUrl()).toBe('/photos?q=guest');
  });
});

describe('PhotosProvider urlState wiring — fetcher params', () => {
  /** Renders hook + provider together, exactly like the page does. */
  function renderProvider() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const probe: { current: ReturnType<typeof usePhotosTable> | null } = { current: null };
    function Probe() {
      probe.current = usePhotosTable();
      return null;
    }
    function Page() {
      const urlState = usePhotosUrlState();
      return (
        <QueryClientProvider client={queryClient}>
          <PhotosProvider urlState={urlState}>
            <Probe />
          </PhotosProvider>
        </QueryClientProvider>
      );
    }
    const utils = render(<Page />);
    return { ...utils, probe };
  }

  it('clean mount: one fetch, defaults (page 1 / per_page 10, created_at desc), no q/tag_id', async () => {
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetPhotos).toHaveBeenCalledTimes(1));
    expect(lastWireParams()).toEqual({
      page: 1,
      per_page: 10,
      sort_by: 'created_at',
      sort_order: 'desc',
    });
    expect(probe.current!.search).toBe('');
    expect(probe.current!.filters.tag_id).toEqual([]);
    // Still exactly ONE request after settling (no double-fetch regression).
    await settle(100);
    expect(mockGetPhotos).toHaveBeenCalledTimes(1);
  });

  it('?q=guest&tag_id=tag7&page=2&per_page=50 — one fetch, exact params', async () => {
    __resetNavigation('?q=guest&tag_id=tag7&page=2&per_page=50', '/photos');
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetPhotos).toHaveBeenCalledTimes(1));
    expect(lastWireParams()).toEqual({
      q: 'guest',
      tag_id: ['tag7'],
      page: 2,
      per_page: 50,
      sort_by: 'created_at',
      sort_order: 'desc',
    });
    expect(probe.current!.search).toBe('guest');
    expect(probe.current!.filters.tag_id).toEqual(['tag7']);
    await settle(100);
    expect(mockGetPhotos).toHaveBeenCalledTimes(1);
  });

  it('1-char q stays in state but never reaches the wire (≥2 server clamp)', async () => {
    __resetNavigation('?q=x', '/photos');
    renderProvider();
    await waitFor(() => expect(mockGetPhotos).toHaveBeenCalledTimes(1));
    expect(lastWireParams()).toEqual({
      page: 1,
      per_page: 10,
      sort_by: 'created_at',
      sort_order: 'desc',
    });
  });

  it('setFilters({tag_id}) writes repeated params to the URL (one push)', async () => {
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetPhotos).toHaveBeenCalledTimes(1));
    act(() => {
      probe.current!.setFilters({ tag_id: ['tag1', 'tag2'] });
    });
    await settle(50);
    expect(__lastPushedUrl()).toBe('/photos?tag_id=tag1&tag_id=tag2');
    await waitFor(() =>
      expect(lastWireParams()).toMatchObject({ tag_id: ['tag1', 'tag2'], page: 1 }),
    );
  });

  it('removing one tag of two updates the URL without the second (dedup-by-write)', async () => {
    __resetNavigation('?tag_id=tag1&tag_id=tag2', '/photos');
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetPhotos).toHaveBeenCalledTimes(1));
    act(() => {
      // The PhotosFilters removeTag path: tag_id minus one element.
      probe.current!.setFilters({ tag_id: ['tag1'] });
    });
    await settle(50);
    expect(__lastPushedUrl()).toBe('/photos?tag_id=tag1');
  });

  it('resetFilters clears q + tag_id from the URL and the wire', async () => {
    __resetNavigation('?q=guest&tag_id=tag7&page=2', '/photos');
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetPhotos).toHaveBeenCalledTimes(1));
    act(() => {
      probe.current!.resetFilters();
    });
    await settle(50);
    expect(__lastPushedUrl()).toBe('/photos');
    await waitFor(() =>
      expect(lastWireParams()).toEqual({
        page: 1,
        per_page: 10,
        sort_by: 'created_at',
        sort_order: 'desc',
      }),
    );
  });
});
