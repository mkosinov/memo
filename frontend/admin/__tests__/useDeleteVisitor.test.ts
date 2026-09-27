/**
 * Deferred visitor delete (#324 Task 8, spec §6/§9.3/§9.4) — useDeleteVisitor.
 *
 * Mirror of useDeletePhoto.test.ts (T7): both entry points are NON-BLOCKING
 * deferred actions —
 *   1. capture item-level snapshots of every ['visitors', clientId] cache
 *      holding the row (read-only),
 *   2. clean path: dry-run DELETE ?dry_run=true — 409 (deps) REJECTS upward
 *      untouched (the call site opens DeleteDialog); 204 → continue,
 *   3. optimistic row removal from the captured keys only,
 *   4. enqueuePendingAction (5s window): undo restores snapshots by key,
 *      commit = resolveDeleteVisitor({expected, resolutions?}) + removal
 *      reconcile + NON-FATAL invalidation of the ['records','clients'] family.
 *
 * Visitor-specific (spec §6): the with-visits dry-run answers 409 with TWO
 * nodes — «Посещение» (NON-auto, items = visit ids) and «Тег» (visitor_tags,
 * auto, items = tag ids); the cascade commit carries
 * {resolutions: {visits: cascade}, expected: {visits: [...], visitor_tags:
 * [...]}} — BOTH groups' ids from the tree (the executor deletes both). A
 * visit-less visitor commits as the leaf-clean {expected: {}}.
 *
 * Invalidation family (spec §6): ['records'] + ['clients'] — the visits
 * cascade recomputes record seats/status (['records'], view rows + canonical
 * lists) and the client stats cards/visitors count change (['clients']).
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
    dryRunDeleteVisitor: vi.fn(),
    resolveDeleteVisitor: vi.fn(),
  };
});

// Mock the PendingActions provider so the hook's enqueue call is controlled
// by tests (same approach as useDeletePhoto.test.ts).
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
  dryRunDeleteVisitor,
  resolveDeleteVisitor,
  ApiError,
} from '@memo/api-client';
import type { DependencyNode, VisitorResponse } from '@memo/api-client';
import type { PendingAction } from '@/contexts/PendingActionsContext';
import { useDeleteVisitor } from '../hooks/useVisitorsMutations';

const mockDryRun = vi.mocked(dryRunDeleteVisitor);
const mockResolveDeleteVisitor = vi.mocked(resolveDeleteVisitor);

const visitorId = 'vis1';

const mockVisitor: VisitorResponse = {
  id: visitorId,
  client_id: 'c1',
  name: 'Маша',
  age: 8,
  created_at: '2026-06-07T14:05:00',
  updated_at: '2026-06-07T14:05:00',
};
const otherVisitor: VisitorResponse = { ...mockVisitor, id: 'vis2', name: 'Анна' };

// The visitors cache family: bare arrays at ['visitors', clientId] — the
// shape useRecordData/ClientInfoTab refetch produce (qk.visitors factory).
const C1_KEY = ['visitors', 'c1'] as const;

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

/** Seed the per-client visitors cache (bare array). */
function seedCaches(queryClient: QueryClient) {
  queryClient.setQueryData([...C1_KEY], [mockVisitor, otherVisitor]);
}

/** A 409 dry-run tree (visitor side): «Посещение» (non-auto, visit items)
 * + «Тег» (visitor_tags auto node, tag items) — BOTH carry the id-sets the
 * `expected` commit must snapshot. */
const VISITOR_DEPS: DependencyNode[] = [
  {
    entity: 'visits',
    auto: false,
    relation: 'Посещение',
    count: 2,
    allowed_actions: ['cascade'],
    items: [
      { id: 'uuid-visit-1', label: 'Гуашь, 3500' },
      { id: 'uuid-visit-2', label: 'Гуашь, 3500' },
    ],
  },
  {
    entity: 'visitor_tags',
    auto: true,
    relation: 'Тег',
    count: 1,
    allowed_actions: ['cascade'],
    items: [{ id: 'uuid-tag-1', label: 'Гуашь' }],
  },
];

const RESOLUTIONS: Record<string, string> = { visits: 'cascade' };

function lastEnqueuedAction(): PendingAction {
  const calls = mockEnqueuePendingAction.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as PendingAction;
}

describe('useDeleteVisitor (deferred #324 Task 8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDryRun.mockResolvedValue(undefined);
    mockResolveDeleteVisitor.mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('removeVisitor — clean deferred path', () => {
    it('409 → ApiError propagates upward; enqueue NOT called; caches untouched', async () => {
      mockDryRun.mockRejectedValue(
        new ApiError(409, 'has_dependencies', undefined, VISITOR_DEPS),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteVisitor(), { wrapper });

      await act(async () => {
        await expect(result.current.removeVisitor(mockVisitor)).rejects.toThrow(ApiError);
      });

      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(mockResolveDeleteVisitor).not.toHaveBeenCalled();
      // Dry-run is a pure preview — the cache still holds the row (the call
      // site opens DeleteDialog on this rejection).
      const list = queryClient.getQueryData<VisitorResponse[]>([...C1_KEY]);
      expect(list?.find((v) => v.id === visitorId)).toBe(mockVisitor);
    });

    it('non-409 dry-run error (404) propagates upward too — no interception in the hook', async () => {
      mockDryRun.mockRejectedValue(new ApiError(404, 'Visitor not found', 'VISITOR_NOT_FOUND'));
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteVisitor(), { wrapper });

      await act(async () => {
        await expect(result.current.removeVisitor(mockVisitor)).rejects.toThrow(ApiError);
      });

      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      const list = queryClient.getQueryData<VisitorResponse[]>([...C1_KEY]);
      expect(list).toContain(mockVisitor);
    });

    it('204 → enqueue(delete-visitor-id, «Удалено. Отменить», 5s) with NO server calls before commit', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteVisitor(), { wrapper });

      await act(async () => {
        await result.current.removeVisitor(mockVisitor);
      });

      expect(mockDryRun).toHaveBeenCalledWith(visitorId);
      expect(mockResolveDeleteVisitor).not.toHaveBeenCalled();
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);

      const action = lastEnqueuedAction();
      expect(action.id).toBe(`delete-visitor-${visitorId}`);
      expect(action.kind).toBe('delete');
      expect(action.message).toBe('Удалено. Отменить');
      expect(action.delayMs).toBe(5000);
    });

    it('204 → optimistic row removal from the captured caches only', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteVisitor(), { wrapper });

      await act(async () => {
        await result.current.removeVisitor(mockVisitor);
      });

      const list = queryClient.getQueryData<VisitorResponse[]>([...C1_KEY]);
      expect(list?.map((v) => v.id)).toEqual(['vis2']);
    });

    it('commit → resolveDeleteVisitor({expected: {}}), then reconcile removal + invalidate the records+clients family', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteVisitor(), { wrapper });

      await act(async () => {
        await result.current.removeVisitor(mockVisitor);
      });
      const { commit } = lastEnqueuedAction();

      // Simulate a mid-window refetch bringing the row back — commit must
      // reconcile it away again (resolve → remove → invalidate, in order).
      queryClient.setQueryData([...C1_KEY], [mockVisitor, otherVisitor]);
      await act(async () => {
        await commit();
      });

      expect(mockResolveDeleteVisitor).toHaveBeenCalledTimes(1);
      expect(mockResolveDeleteVisitor).toHaveBeenCalledWith(visitorId, { expected: {} });
      const list = queryClient.getQueryData<VisitorResponse[]>([...C1_KEY]);
      expect(list?.map((v) => v.id)).toEqual(['vis2']);

      const invalidateCalls = invalidateSpy.mock.invocationCallOrder;
      expect(invalidateCalls.length).toBeGreaterThan(0);
      expect(mockResolveDeleteVisitor.mock.invocationCallOrder[0]).toBeLessThan(
        invalidateCalls[0],
      );
      // The spec §6 family ['records','clients'] via the #239 map union:
      // records → ['records'] + ['visitors']; clients → ['clients'] +
      // ['records'](dedup) — the visits cascade recomputes record
      // seats/status (['records']), the per-client visitor counts/lists
      // (['visitors']) and the client stats (['clients']).
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['visitors'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clients'] });
      // No cross-family sprawl beyond the spec union.
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['photos'] });
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['tags'] });
    });

    it('commit failure → the throw is NOT caught in the hook (onError owns the surface)', async () => {
      mockResolveDeleteVisitor.mockRejectedValue(
        new ApiError(500, 'Internal error', 'INTERNAL'),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteVisitor(), { wrapper });

      await act(async () => {
        await result.current.removeVisitor(mockVisitor);
      });
      const { commit } = lastEnqueuedAction();

      await act(async () => {
        await expect(commit()).rejects.toThrow(ApiError);
      });
    });

    it('undo → row restored into its own cache, no server calls', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteVisitor(), { wrapper });

      await act(async () => {
        await result.current.removeVisitor(mockVisitor);
      });
      expect(mockDryRun).toHaveBeenCalledTimes(1); // baseline before undo

      const { undo } = lastEnqueuedAction();
      act(() => {
        undo();
      });

      const list = queryClient.getQueryData<VisitorResponse[]>([...C1_KEY]);
      expect(list?.find((v) => v.id === visitorId)).toBe(mockVisitor);
      // Undo performs NO server calls (spec §6)
      expect(mockDryRun).toHaveBeenCalledTimes(1);
      expect(mockResolveDeleteVisitor).not.toHaveBeenCalled();
    });
  });

  describe('removeVisitorResolved — cascade path from DeleteDialog', () => {
    const resolvedVisitor: VisitorResponse = { ...mockVisitor, id: 'vis-cascade', name: 'Каскадный' };

    it('builds expected from BOTH dependency nodes\' items (visits + visitor_tags); commit carries cascade resolutions', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...C1_KEY], [resolvedVisitor, otherVisitor]);
      const { result } = renderHook(() => useDeleteVisitor(), { wrapper });

      await act(async () => {
        await result.current.removeVisitorResolved(resolvedVisitor, RESOLUTIONS, VISITOR_DEPS);
      });

      // The dialog path already owns the dependency tree — no second dry-run
      expect(mockDryRun).not.toHaveBeenCalled();

      const action = lastEnqueuedAction();
      expect(action.id).toBe(`delete-visitor-${resolvedVisitor.id}`);
      await act(async () => {
        await action.commit();
      });

      expect(mockResolveDeleteVisitor).toHaveBeenCalledWith(resolvedVisitor.id, {
        resolutions: RESOLUTIONS,
        expected: {
          visits: ['uuid-visit-1', 'uuid-visit-2'],
          visitor_tags: ['uuid-tag-1'],
        },
      });
    });

    it('optimistic removal happens at enqueue time (dialog closes immediately)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...C1_KEY], [resolvedVisitor, otherVisitor]);
      const { result } = renderHook(() => useDeleteVisitor(), { wrapper });

      await act(async () => {
        await result.current.removeVisitorResolved(resolvedVisitor, RESOLUTIONS, VISITOR_DEPS);
      });

      const list = queryClient.getQueryData<VisitorResponse[]>([...C1_KEY]);
      expect(list?.map((v) => v.id)).toEqual(['vis2']);
      // enqueue is synchronous — dialog closes without awaiting the commit
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);
      expect(mockResolveDeleteVisitor).not.toHaveBeenCalled();
    });

    it('commit failure → NOT caught in the hook (same surface as the clean path)', async () => {
      mockResolveDeleteVisitor.mockRejectedValue(
        new ApiError(409, 'stale_dependencies', undefined, VISITOR_DEPS),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...C1_KEY], [resolvedVisitor, otherVisitor]);
      const { result } = renderHook(() => useDeleteVisitor(), { wrapper });

      await act(async () => {
        await result.current.removeVisitorResolved(resolvedVisitor, RESOLUTIONS, VISITOR_DEPS);
      });
      const { commit } = lastEnqueuedAction();

      await act(async () => {
        await expect(commit()).rejects.toThrow(ApiError);
      });
    });
  });

  // ── staleAwareOnError — D4 honest-error branches (spec §9.4) ──

  describe('staleAwareOnError — commit failures', () => {
    function expectRowRestored(queryClient: QueryClient) {
      const list = queryClient.getQueryData<VisitorResponse[]>([...C1_KEY]);
      expect(list?.find((v) => v.id === visitorId)).toBe(mockVisitor);
    }

    it('commit throw 409 + dependencies → onError: undo restores row + stale toast with «Обновить» action', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteVisitor(), { wrapper });

      await act(async () => {
        await result.current.removeVisitor(mockVisitor);
      });
      const { onError } = lastEnqueuedAction();
      expect(onError).toBeDefined();

      await act(async () => {
        onError!(new ApiError(409, 'stale_dependencies', undefined, VISITOR_DEPS));
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

      // The «Обновить» action invalidates the 'records' family entry of the
      // #239 map (records + visitors). Deliberately narrower than the commit
      // union: the stale 409 REFUSED the delete — the server state of THIS
      // client's stats didn't change, so the refresh converges exactly what
      // the user sees (the restored row + the records surface the racing
      // visit touched).
      const action = mockShowToast.mock.calls[0][4] as {
        label: string;
        onAction: () => void;
      };
      act(() => {
        action.onAction();
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['visitors'] });
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['clients'] });
    });

    it('non-ApiError commit error (network) → honest toast «Не удалось подтвердить удаление»', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteVisitor(), { wrapper });

      await act(async () => {
        await result.current.removeVisitor(mockVisitor);
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
      const { result } = renderHook(() => useDeleteVisitor(), { wrapper });

      await act(async () => {
        await result.current.removeVisitor(mockVisitor);
      });
      const { onError } = lastEnqueuedAction();

      await act(async () => {
        onError!(new ApiError(404, 'Visitor not found', 'VISITOR_NOT_FOUND'));
      });

      expect(mockShowToast).not.toHaveBeenCalled();
      const list = queryClient.getQueryData<VisitorResponse[]>([...C1_KEY]);
      expect(list?.find((v) => v.id === visitorId)).toBeUndefined();
    });
  });
});
