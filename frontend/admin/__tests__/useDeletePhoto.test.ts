/**
 * Deferred photo delete (#324, spec §6) — useDeletePhoto rewrite.
 *
 * Mirror of useDeleteTag.test.ts (#318): both entry points are
 * NON-BLOCKING deferred actions —
 *   1. capture item-level snapshots of every ['photos', ...] cache holding
 *      the row (read-only),
 *   2. clean path: dry-run DELETE ?dry_run=true — 409 (deps) REJECTS upward
 *      untouched (the call site opens DeleteDialog); 204 → continue,
 *   3. optimistic row removal from the captured keys only,
 *   4. enqueuePendingAction (5s window): undo restores snapshots by key,
 *      commit = resolveDeletePhoto({expected, resolutions?}) + removal
 *      reconcile + NON-FATAL invalidation of the ['photos'] family only.
 *
 * Photo-specific (spec §6/§9.2): the tagged dry-run answers 409 with the
 * photo_tags node «Тег» (items = tag ids/titles); the cascade commit
 * carries {resolutions: {photo_tags: cascade}, expected: {photo_tags: ids}}
 * — the tags SURVIVE (join rows die).
 *
 * PendingActions is mocked; the real ApiError class stays (importOriginal)
 * because the 409 rejection surface is part of the contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    dryRunDeletePhoto: vi.fn(),
    resolveDeletePhoto: vi.fn(),
  };
});

// Mock the PendingActions provider so the hook's enqueue call is controlled
// by tests (same approach as useDeleteTag.test.ts).
const mockEnqueuePendingAction = vi.fn();
vi.mock('@/contexts/PendingActionsContext', () => ({
  usePendingActions: () => ({ enqueuePendingAction: mockEnqueuePendingAction }),
}));

// The stale-aware onError (D4 family) calls showToast directly from the
// hook — mock the UI context to assert the honest-error surface.
const mockShowToast = vi.fn();
vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({ showToast: mockShowToast }),
}));

import {
  dryRunDeletePhoto,
  resolveDeletePhoto,
  ApiError,
} from '@memo/api-client';
import type { DependencyNode, PaginatedResponse, PhotoResponse } from '@memo/api-client';
import type { PendingAction } from '@/contexts/PendingActionsContext';
import { useDeletePhoto } from '../hooks/usePhotosMutations';

const mockDryRun = vi.mocked(dryRunDeletePhoto);
const mockResolveDeletePhoto = vi.mocked(resolveDeletePhoto);

const photoId = 'p1';

const mockPhoto: PhotoResponse = {
  id: photoId,
  filename: 'test.jpg',
  client_id: null,
  service_id: null,
  activity_id: null,
  location_id: null,
  is_public: false,
  tags: [{ id: 't-1', title: 'Гуашь' }],
  client_name: null,
  created_at: '2026-06-07T14:05:00',
  updated_at: '2026-06-07T14:05:00',
};
const otherPhoto: PhotoResponse = { ...mockPhoto, id: 'p2', filename: 'other.png' };

// The photos cache family: the PhotosContext paged envelope (key
// ['photos', {page, perPage, sortBy, sortOrder, q, ...filters}]) — the only
// shape photos caches exist in (no /all lookup list for photos).
const PAGE_KEY = ['photos', { page: 1, perPage: 10, sortBy: null, sortOrder: null, q: null }] as const;

function createQueryClientWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    queryClient,
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  };
}

/** Seed the paged-envelope cache (PhotosContext shape). */
function seedCaches(queryClient: QueryClient) {
  queryClient.setQueryData([...PAGE_KEY], {
    items: [mockPhoto, otherPhoto],
    total: 2,
    page: 1,
    per_page: 10,
  });
}

/** A 409 dry-run tree (photo side): the single photo_tags node «Тег» with
 *  items (tag ids/titles — the `expected` snapshot source). */
const PHOTO_DEPS: DependencyNode[] = [
  {
    entity: 'photo_tags',
    auto: false,
    relation: 'Тег',
    count: 1,
    allowed_actions: ['cascade'],
    items: [{ id: 't-1', label: 'Гуашь' }],
  },
];

const RESOLUTIONS: Record<string, string> = { photo_tags: 'cascade' };

function lastEnqueuedAction(): PendingAction {
  const calls = mockEnqueuePendingAction.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as PendingAction;
}

describe('useDeletePhoto (deferred #324)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDryRun.mockResolvedValue(undefined);
    mockResolveDeletePhoto.mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('removePhoto — clean deferred path', () => {
    it('409 → ApiError propagates upward; enqueue NOT called; caches untouched', async () => {
      mockDryRun.mockRejectedValue(
        new ApiError(409, 'has_dependencies', undefined, PHOTO_DEPS),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeletePhoto(), { wrapper });

      await act(async () => {
        await expect(result.current.removePhoto(mockPhoto)).rejects.toThrow(ApiError);
      });

      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(mockResolveDeletePhoto).not.toHaveBeenCalled();
      // Dry-run is a pure preview — the cache still holds the row (the call
      // site opens DeleteDialog on this rejection).
      const envelope = queryClient.getQueryData<PaginatedResponse<PhotoResponse>>([...PAGE_KEY]);
      expect(envelope?.items.find((p) => p.id === photoId)).toBe(mockPhoto);
    });

    it('non-409 dry-run error (404) propagates upward too — no interception in the hook', async () => {
      mockDryRun.mockRejectedValue(new ApiError(404, 'Photo not found', 'PHOTO_NOT_FOUND'));
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeletePhoto(), { wrapper });

      await act(async () => {
        await expect(result.current.removePhoto(mockPhoto)).rejects.toThrow(ApiError);
      });

      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      const envelope = queryClient.getQueryData<PaginatedResponse<PhotoResponse>>([...PAGE_KEY]);
      expect(envelope?.items).toContain(mockPhoto);
    });

    it('204 → enqueue(delete-photo-id, «Удалено. Отменить», 5s) with NO server calls before commit', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeletePhoto(), { wrapper });

      await act(async () => {
        await result.current.removePhoto(mockPhoto);
      });

      expect(mockDryRun).toHaveBeenCalledWith(photoId);
      expect(mockResolveDeletePhoto).not.toHaveBeenCalled();
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);

      const action = lastEnqueuedAction();
      expect(action.id).toBe(`delete-photo-${photoId}`);
      expect(action.kind).toBe('delete');
      expect(action.message).toBe('Удалено. Отменить');
      expect(action.delayMs).toBe(5000);
    });

    it('204 → optimistic row removal from the captured caches only', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeletePhoto(), { wrapper });

      await act(async () => {
        await result.current.removePhoto(mockPhoto);
      });

      const envelope = queryClient.getQueryData<PaginatedResponse<PhotoResponse>>([...PAGE_KEY]);
      expect(envelope?.items.map((p) => p.id)).toEqual(['p2']);
      expect(envelope?.total).toBe(2); // mapRowListCache invariant
    });

    it('commit → resolveDeletePhoto({expected: {}}), then reconcile removal + invalidate the photos family only', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeletePhoto(), { wrapper });

      await act(async () => {
        await result.current.removePhoto(mockPhoto);
      });
      const { commit } = lastEnqueuedAction();

      // Simulate a mid-window refetch bringing the row back — commit must
      // reconcile it away again (resolve → remove → invalidate, in order).
      queryClient.setQueryData([...PAGE_KEY], {
        items: [mockPhoto, otherPhoto],
        total: 2,
        page: 1,
        per_page: 10,
      });
      await act(async () => {
        await commit();
      });

      expect(mockResolveDeletePhoto).toHaveBeenCalledTimes(1);
      expect(mockResolveDeletePhoto).toHaveBeenCalledWith(photoId, { expected: {} });
      const envelope = queryClient.getQueryData<PaginatedResponse<PhotoResponse>>([...PAGE_KEY]);
      expect(envelope?.items.map((p) => p.id)).toEqual(['p2']);

      const invalidateCalls = invalidateSpy.mock.invocationCallOrder;
      expect(invalidateCalls.length).toBeGreaterThan(0);
      expect(mockResolveDeletePhoto.mock.invocationCallOrder[0]).toBeLessThan(
        invalidateCalls[0],
      );
      // The ['photos'] family ONLY — no cross-family cascade.
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['photos'] });
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['tags'] });
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['records'] });
    });

    it('commit failure → the throw is NOT caught in the hook (onError owns the surface)', async () => {
      mockResolveDeletePhoto.mockRejectedValue(
        new ApiError(500, 'Internal error', 'INTERNAL'),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeletePhoto(), { wrapper });

      await act(async () => {
        await result.current.removePhoto(mockPhoto);
      });
      const { commit } = lastEnqueuedAction();

      await act(async () => {
        await expect(commit()).rejects.toThrow(ApiError);
      });
    });

    it('undo → row restored into its own cache, no server calls', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeletePhoto(), { wrapper });

      await act(async () => {
        await result.current.removePhoto(mockPhoto);
      });
      expect(mockDryRun).toHaveBeenCalledTimes(1); // baseline before undo

      const { undo } = lastEnqueuedAction();
      act(() => {
        undo();
      });

      const envelope = queryClient.getQueryData<PaginatedResponse<PhotoResponse>>([...PAGE_KEY]);
      expect(envelope?.items.find((p) => p.id === photoId)).toBe(mockPhoto);
      expect(envelope?.total).toBe(2);
      expect(envelope?.page).toBe(1);
      expect(envelope?.per_page).toBe(10);
      // Undo performs NO server calls (spec D4/D5)
      expect(mockDryRun).toHaveBeenCalledTimes(1);
      expect(mockResolveDeletePhoto).not.toHaveBeenCalled();
    });
  });

  describe('removePhotoResolved — cascade path from DeleteDialog', () => {
    const resolvedPhoto: PhotoResponse = { ...mockPhoto, id: 'p-cascade', filename: 'cascade.jpg' };

    it('builds expected from dependency items (tag ids); commit carries cascade resolutions', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...PAGE_KEY], {
        items: [resolvedPhoto, otherPhoto],
        total: 2,
        page: 1,
        per_page: 10,
      });
      const { result } = renderHook(() => useDeletePhoto(), { wrapper });

      await act(async () => {
        await result.current.removePhotoResolved(resolvedPhoto, RESOLUTIONS, PHOTO_DEPS);
      });

      // The dialog path already owns the dependency tree — no second dry-run
      expect(mockDryRun).not.toHaveBeenCalled();

      const action = lastEnqueuedAction();
      expect(action.id).toBe(`delete-photo-${resolvedPhoto.id}`);
      await act(async () => {
        await action.commit();
      });

      expect(mockResolveDeletePhoto).toHaveBeenCalledWith(resolvedPhoto.id, {
        resolutions: RESOLUTIONS,
        expected: { photo_tags: ['t-1'] },
      });
    });

    it('optimistic removal happens at enqueue time (dialog closes immediately)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...PAGE_KEY], {
        items: [resolvedPhoto, otherPhoto],
        total: 2,
        page: 1,
        per_page: 10,
      });
      const { result } = renderHook(() => useDeletePhoto(), { wrapper });

      await act(async () => {
        await result.current.removePhotoResolved(resolvedPhoto, RESOLUTIONS, PHOTO_DEPS);
      });

      const envelope = queryClient.getQueryData<PaginatedResponse<PhotoResponse>>([...PAGE_KEY]);
      expect(envelope?.items.map((p) => p.id)).toEqual(['p2']);
      // enqueue is synchronous — dialog closes without awaiting the commit
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);
      expect(mockResolveDeletePhoto).not.toHaveBeenCalled();
    });

    it('commit failure → NOT caught in the hook (same surface as the clean path)', async () => {
      mockResolveDeletePhoto.mockRejectedValue(
        new ApiError(409, 'stale_dependencies', undefined, PHOTO_DEPS),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...PAGE_KEY], {
        items: [resolvedPhoto, otherPhoto],
        total: 2,
        page: 1,
        per_page: 10,
      });
      const { result } = renderHook(() => useDeletePhoto(), { wrapper });

      await act(async () => {
        await result.current.removePhotoResolved(resolvedPhoto, RESOLUTIONS, PHOTO_DEPS);
      });
      const { commit } = lastEnqueuedAction();

      await act(async () => {
        await expect(commit()).rejects.toThrow(ApiError);
      });
    });
  });

  // ── staleAwareOnError — D4 honest-error branches (parameterized on 'photos') ──

  describe('staleAwareOnError — commit failures (D4 family)', () => {
    function expectRowRestored(queryClient: QueryClient) {
      const envelope = queryClient.getQueryData<PaginatedResponse<PhotoResponse>>([...PAGE_KEY]);
      expect(envelope?.items.find((p) => p.id === photoId)).toBe(mockPhoto);
    }

    it('commit throw 409 + dependencies → onError: undo restores row + stale toast with «Обновить» action', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeletePhoto(), { wrapper });

      await act(async () => {
        await result.current.removePhoto(mockPhoto);
      });
      const { onError } = lastEnqueuedAction();
      expect(onError).toBeDefined();

      await act(async () => {
        onError!(new ApiError(409, 'stale_dependencies', undefined, PHOTO_DEPS));
      });

      expectRowRestored(queryClient);
      expect(mockShowToast).toHaveBeenCalledTimes(1);
      expect(mockShowToast).toHaveBeenCalledWith(
        'Не удалось удалить: данные изменились',
        'error',
        undefined,
        undefined,
        { label: 'Обновить', onAction: expect.any(Function) },
      );

      // The «Обновить» action invalidates the ['photos'] family.
      const action = mockShowToast.mock.calls[0][4] as {
        label: string;
        onAction: () => void;
      };
      act(() => {
        action.onAction();
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['photos'] });
    });

    it('non-ApiError commit error (network) → honest toast «Не удалось подтвердить удаление»', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeletePhoto(), { wrapper });

      await act(async () => {
        await result.current.removePhoto(mockPhoto);
      });
      const { onError } = lastEnqueuedAction();

      await act(async () => {
        onError!(new TypeError('Failed to fetch'));
      });

      expectRowRestored(queryClient);
      expect(mockShowToast).toHaveBeenCalledWith(
        'Не удалось подтвердить удаление',
        'error',
      );
    });

    it('commit throw 404 → quiet success: no toast, no undo — the row stays removed', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeletePhoto(), { wrapper });

      await act(async () => {
        await result.current.removePhoto(mockPhoto);
      });
      const { onError } = lastEnqueuedAction();

      await act(async () => {
        onError!(new ApiError(404, 'Photo not found', 'PHOTO_NOT_FOUND'));
      });

      expect(mockShowToast).not.toHaveBeenCalled();
      const envelope = queryClient.getQueryData<PaginatedResponse<PhotoResponse>>([...PAGE_KEY]);
      expect(envelope?.items.find((p) => p.id === photoId)).toBeUndefined();
    });
  });
});
