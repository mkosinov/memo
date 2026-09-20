/**
 * Deferred tag delete (#318, spec §3 D4/D5) — useDeleteTag rewrite.
 *
 * Flow under test (both entry points):
 *   1. capture item-level snapshots of every ['tags', ...] cache holding
 *      the row (read-only),
 *   2. clean path: dry-run DELETE ?dry_run=true — 409 (deps) REJECTS upward
 *      untouched (the call site opens DeleteDialog); 204 → continue,
 *   3. optimistic row removal from the captured keys only,
 *   4. enqueuePendingAction (5s window): undo restores snapshots by key,
 *      commit = resolveDeleteTag({expected, resolutions?}) + removal
 *      reconcile + NON-FATAL invalidation of the ['tags'] family only.
 *
 * No server calls until commit — except the dry-run (D5). PendingActions is
 * mocked; the real ApiError class stays (importOriginal) because the 409
 * rejection surface is part of the contract. Mirrors useDeleteRecord.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    dryRunDeleteTag: vi.fn(),
    resolveDeleteTag: vi.fn(),
  };
});

// Mock the PendingActions provider so the hook's enqueue call is controlled
// by tests (same approach as useDeleteRecord.test.ts).
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
  dryRunDeleteTag,
  resolveDeleteTag,
  ApiError,
} from '@memo/api-client';
import type { DependencyNode, PaginatedResponse, TagResponse } from '@memo/api-client';
import type { PendingAction } from '@/contexts/PendingActionsContext';
import { useDeleteTag } from '../hooks/useTagsMutations';

const mockDryRun = vi.mocked(dryRunDeleteTag);
const mockResolveDeleteTag = vi.mocked(resolveDeleteTag);

const tagId = 't1';

const mockTag: TagResponse = { id: tagId, title: 'Живопись' };
const otherTag: TagResponse = { id: 't2', title: 'Керамика' };

// Two ['tags', ...] cache shapes: the paged envelope (TagsContext factory
// key ['tags', page, perPage, …]) and a plain-array lookup cache.
const PAGE_KEY = ['tags', 1, 10, null, null, null, ''] as const;
const ALL_KEY = ['tags', 'all'] as const;

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

/** Seed the two-cache topology the hook must preserve: envelope + flat list. */
function seedCaches(queryClient: QueryClient) {
  queryClient.setQueryData([...PAGE_KEY], {
    items: [mockTag, otherTag],
    total: 2,
    page: 1,
    per_page: 10,
  });
  queryClient.setQueryData([...ALL_KEY], [mockTag, otherTag]);
}

/** A 409 dry-run tree (tag side, D1/D6): every node non-auto with items. */
const TAG_DEPS: DependencyNode[] = [
  {
    entity: 'service_tags', auto: false,
    relation: 'Услуга',
    count: 2,
    allowed_actions: ['cascade'],
    items: [
      { id: '11111111-1111-1111-1111-111111111111', label: 'Стрижка' },
      { id: '22222222-2222-2222-2222-222222222222', label: 'Маникюр' },
    ],
  },
  {
    entity: 'record_tags', auto: false,
    relation: 'Запись',
    count: 1,
    allowed_actions: ['cascade'],
    items: [{ id: '33333333-3333-3333-3333-333333333333', label: 'Запись от 12.05 10:00' }],
  },
];

const RESOLUTIONS: Record<string, string> = { service_tags: 'cascade', record_tags: 'cascade' };

function lastEnqueuedAction(): PendingAction {
  const calls = mockEnqueuePendingAction.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as PendingAction;
}

describe('useDeleteTag (deferred #318)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDryRun.mockResolvedValue(undefined);
    mockResolveDeleteTag.mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('removeTag — clean deferred path', () => {
    it('409 → ApiError propagates upward; enqueue NOT called; caches untouched', async () => {
      mockDryRun.mockRejectedValue(
        new ApiError(409, 'has_dependencies', undefined, TAG_DEPS),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteTag(), { wrapper });

      await act(async () => {
        await expect(result.current.removeTag(mockTag)).rejects.toThrow(ApiError);
      });

      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(mockResolveDeleteTag).not.toHaveBeenCalled();
      // Dry-run is a pure preview — the caches still hold the row
      const envelope = queryClient.getQueryData<PaginatedResponse<TagResponse>>([...PAGE_KEY]);
      expect(envelope?.items.find((t) => t.id === tagId)).toBe(mockTag);
      expect(queryClient.getQueryData<TagResponse[]>([...ALL_KEY])).toContain(mockTag);
    });

    it('non-409 dry-run error (404) propagates upward too — no interception in the hook', async () => {
      mockDryRun.mockRejectedValue(new ApiError(404, 'Tag not found', 'TAG_NOT_FOUND'));
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteTag(), { wrapper });

      await act(async () => {
        await expect(result.current.removeTag(mockTag)).rejects.toThrow(ApiError);
      });

      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(queryClient.getQueryData<TagResponse[]>([...ALL_KEY])).toContain(mockTag);
    });

    it('204 → enqueue(delete-tag-id, «Удалено. Отменить», 5s) with NO server calls before commit', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteTag(), { wrapper });

      await act(async () => {
        await result.current.removeTag(mockTag);
      });

      expect(mockDryRun).toHaveBeenCalledWith(tagId);
      expect(mockResolveDeleteTag).not.toHaveBeenCalled();
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);

      const action = lastEnqueuedAction();
      expect(action.id).toBe(`delete-tag-${tagId}`);
      expect(action.kind).toBe('delete');
      expect(action.message).toBe('Удалено. Отменить');
      expect(action.delayMs).toBe(5000);
    });

    it('204 → optimistic row removal from the captured caches only (total invariant)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteTag(), { wrapper });

      await act(async () => {
        await result.current.removeTag(mockTag);
      });

      const envelope = queryClient.getQueryData<PaginatedResponse<TagResponse>>([...PAGE_KEY]);
      expect(envelope?.items.map((t) => t.id)).toEqual(['t2']);
      expect(envelope?.total).toBe(2); // mapRowListCache invariant
      expect(queryClient.getQueryData<TagResponse[]>([...ALL_KEY])).toEqual([otherTag]);
    });

    it('commit → resolveDeleteTag({expected: {}}), then reconcile removal + invalidate the tags family only', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteTag(), { wrapper });

      await act(async () => {
        await result.current.removeTag(mockTag);
      });
      const { commit } = lastEnqueuedAction();

      // Simulate a mid-window refetch bringing the row back — commit must
      // reconcile it away again (resolve → remove → invalidate, in order).
      queryClient.setQueryData([...ALL_KEY], [mockTag, otherTag]);
      await act(async () => {
        await commit();
      });

      expect(mockResolveDeleteTag).toHaveBeenCalledTimes(1);
      expect(mockResolveDeleteTag).toHaveBeenCalledWith(tagId, { expected: {} });
      expect(queryClient.getQueryData<TagResponse[]>([...ALL_KEY])).toEqual([otherTag]);

      const invalidateCalls = invalidateSpy.mock.invocationCallOrder;
      expect(invalidateCalls.length).toBeGreaterThan(0);
      expect(mockResolveDeleteTag.mock.invocationCallOrder[0]).toBeLessThan(
        invalidateCalls[0],
      );
      // Invalidation union (#239 map): the ['tags'] family ONLY — tags have
      // no canonical point key and no cross-family cascade (D4).
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tags'] });
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['records'] });
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['services'] });
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['clients'] });
    });

    it('commit failure → the throw is NOT caught in the hook (onError owns the surface)', async () => {
      mockResolveDeleteTag.mockRejectedValue(
        new ApiError(500, 'Internal error', 'INTERNAL'),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteTag(), { wrapper });

      await act(async () => {
        await result.current.removeTag(mockTag);
      });
      const { commit } = lastEnqueuedAction();

      await act(async () => {
        await expect(commit()).rejects.toThrow(ApiError);
      });
    });

    it('undo → rows restored into THEIR OWN caches, both shapes preserved, no server calls', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteTag(), { wrapper });

      await act(async () => {
        await result.current.removeTag(mockTag);
      });
      expect(mockDryRun).toHaveBeenCalledTimes(1); // baseline before undo

      const { undo } = lastEnqueuedAction();
      act(() => {
        undo();
      });

      const envelope = queryClient.getQueryData<PaginatedResponse<TagResponse>>([...PAGE_KEY]);
      expect(envelope?.items.find((t) => t.id === tagId)).toBe(mockTag);
      expect(envelope?.total).toBe(2);
      expect(envelope?.page).toBe(1);
      expect(envelope?.per_page).toBe(10);
      expect(queryClient.getQueryData<TagResponse[]>([...ALL_KEY])).toEqual([
        otherTag,
        mockTag,
      ]);
      // Undo performs NO server calls (spec D4/D5)
      expect(mockDryRun).toHaveBeenCalledTimes(1);
      expect(mockResolveDeleteTag).not.toHaveBeenCalled();
    });
  });

  describe('removeTagResolved — cascade path from DeleteDialog', () => {
    const resolvedTag: TagResponse = { id: 't-cascade', title: 'Гончарное дело' };

    it('builds expected from dependency items (ids) — all 8 tag deps are non-auto', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...ALL_KEY], [resolvedTag, otherTag]);
      const { result } = renderHook(() => useDeleteTag(), { wrapper });

      await act(async () => {
        await result.current.removeTagResolved(resolvedTag, RESOLUTIONS, TAG_DEPS);
      });

      // The dialog path already owns the dependency tree — no second dry-run
      expect(mockDryRun).not.toHaveBeenCalled();

      const action = lastEnqueuedAction();
      expect(action.id).toBe(`delete-tag-${resolvedTag.id}`);
      await act(async () => {
        await action.commit();
      });

      expect(mockResolveDeleteTag).toHaveBeenCalledWith(resolvedTag.id, {
        resolutions: RESOLUTIONS,
        expected: {
          service_tags: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
          record_tags: ['33333333-3333-3333-3333-333333333333'],
        },
      });
    });

    it('optimistic removal happens at enqueue time (dialog closes immediately, D5)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...ALL_KEY], [resolvedTag, otherTag]);
      const { result } = renderHook(() => useDeleteTag(), { wrapper });

      await act(async () => {
        await result.current.removeTagResolved(resolvedTag, RESOLUTIONS, TAG_DEPS);
      });

      expect(queryClient.getQueryData<TagResponse[]>([...ALL_KEY])).toEqual([otherTag]);
      // enqueue is synchronous — dialog closes without awaiting the commit
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);
      expect(mockResolveDeleteTag).not.toHaveBeenCalled();
    });

    it('empty dependencies → expected {} (pure resolved path)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...ALL_KEY], [resolvedTag, otherTag]);
      const { result } = renderHook(() => useDeleteTag(), { wrapper });

      await act(async () => {
        await result.current.removeTagResolved(resolvedTag, {}, []);
      });
      const { commit } = lastEnqueuedAction();

      await act(async () => {
        await commit();
      });

      expect(mockResolveDeleteTag).toHaveBeenCalledWith(resolvedTag.id, {
        resolutions: {},
        expected: {},
      });
    });

    it('commit failure → NOT caught in the hook (same surface as the clean path)', async () => {
      mockResolveDeleteTag.mockRejectedValue(
        new ApiError(409, 'stale_dependencies', undefined, TAG_DEPS),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...ALL_KEY], [resolvedTag, otherTag]);
      const { result } = renderHook(() => useDeleteTag(), { wrapper });

      await act(async () => {
        await result.current.removeTagResolved(resolvedTag, RESOLUTIONS, TAG_DEPS);
      });
      const { commit } = lastEnqueuedAction();

      await act(async () => {
        await expect(commit()).rejects.toThrow(ApiError);
      });
    });
  });

  // ── staleAwareOnError — D4 honest-error branches (parameterized on 'tags') ──

  describe('staleAwareOnError — commit failures (D4 family)', () => {
    /** Re-grab the row into the caches after the optimistic removal —
     *  simulates the state onError receives (undo must restore snapshots). */
    function expectRowRestored(queryClient: QueryClient) {
      const envelope = queryClient.getQueryData<PaginatedResponse<TagResponse>>([...PAGE_KEY]);
      expect(envelope?.items.find((t) => t.id === tagId)).toBe(mockTag);
      expect(queryClient.getQueryData<TagResponse[]>([...ALL_KEY])).toContain(mockTag);
    }

    it('commit throw 409 + dependencies → onError: undo restores rows + stale toast with «Обновить» action', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteTag(), { wrapper });

      await act(async () => {
        await result.current.removeTag(mockTag);
      });
      const { onError } = lastEnqueuedAction();
      expect(onError).toBeDefined();

      // The PendingActions pipeline routes every non-404 commit error into
      // onError — invoke it as the pipeline would.
      await act(async () => {
        onError!(new ApiError(409, 'stale_dependencies', undefined, TAG_DEPS));
      });

      // undo ran — both captured caches hold the row again.
      expectRowRestored(queryClient);
      // Honest error: stale text + the «Обновить» action slot, no undo button.
      expect(mockShowToast).toHaveBeenCalledTimes(1);
      expect(mockShowToast).toHaveBeenCalledWith(
        'Не удалось удалить: данные изменились',
        'error',
        undefined,
        undefined,
        { label: 'Обновить', onAction: expect.any(Function) },
      );

      // The «Обновить» action invalidates the ['tags'] family.
      const action = mockShowToast.mock.calls[0][4] as {
        label: string;
        onAction: () => void;
      };
      expect(action.label).toBe('Обновить');
      act(() => {
        action.onAction();
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tags'] });
    });

    it('non-ApiError commit error (network/abort) → honest toast «Не удалось подтвердить удаление» (#243 S3)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteTag(), { wrapper });

      await act(async () => {
        await result.current.removeTag(mockTag);
      });
      const { onError } = lastEnqueuedAction();

      await act(async () => {
        onError!(new TypeError('Failed to fetch'));
      });

      expectRowRestored(queryClient);
      expect(mockShowToast).toHaveBeenCalledTimes(1);
      expect(mockShowToast).toHaveBeenCalledWith(
        'Не удалось подтвердить удаление',
        'error',
      );
    });

    it('non-409 commit error → context-default surface: undo + default toast, no action slot', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteTag(), { wrapper });

      await act(async () => {
        await result.current.removeTag(mockTag);
      });
      const { onError } = lastEnqueuedAction();

      await act(async () => {
        onError!(new ApiError(500, 'Internal error', 'INTERNAL'));
      });

      expectRowRestored(queryClient);
      expect(mockShowToast).toHaveBeenCalledTimes(1);
      expect(mockShowToast).toHaveBeenCalledWith(
        'Не удалось удалить. Изменение отменено',
        'error',
      );
    });

    it('cascade path carries the same onError — commit 409 → undo + stale toast', async () => {
      const resolvedTag: TagResponse = { id: 't-cascade', title: 'Гончарное дело' };
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...ALL_KEY], [resolvedTag, otherTag]);
      const { result } = renderHook(() => useDeleteTag(), { wrapper });

      await act(async () => {
        await result.current.removeTagResolved(resolvedTag, RESOLUTIONS, TAG_DEPS);
      });
      const { onError } = lastEnqueuedAction();

      await act(async () => {
        onError!(new ApiError(409, 'stale_dependencies', undefined, TAG_DEPS));
      });

      expect(mockShowToast).toHaveBeenCalledWith(
        'Не удалось удалить: данные изменились',
        'error',
        undefined,
        undefined,
        { label: 'Обновить', onAction: expect.any(Function) },
      );
      // The undo restored the cascade row into ITS captured cache.
      expect(queryClient.getQueryData<TagResponse[]>([...ALL_KEY])).toContain(resolvedTag);
    });
  });
});
