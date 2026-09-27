/**
 * Deferred position delete (#324, spec §6) — useDeletePosition rewrite.
 *
 * Mirror of useDeletePhoto/useDeleteTag tests: both entry points are
 * NON-BLOCKING deferred actions over the ['positions', ...] family —
 *
 * Positions-specific (spec §6/§9.5/§9.6):
 * - busy position: dry-run 409 → staff_positions node «Сотрудник» (items =
 *   staff ids/names); the cascade commit carries {resolutions:
 *   {staff_positions: cascade}, expected: {staff_positions: ids}} — the
 *   staff cards SURVIVE.
 * - system position: the dry-run itself answers 422 POSITION_IS_SYSTEM —
 *   the hook does NOT intercept it (the ApiError propagates upward; the
 *   call site surfaces the explanation toast; NOTHING is enqueued).
 * - positions is deliberately absent from lib/invalidate.ts
 *   INVALIDATION_MAP (drift-guarded); invalidation goes at the ['positions']
 *   PREFIX directly, covering the /all lookup (usePositions) and the paged
 *   table (PositionsContext).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    dryRunDeletePosition: vi.fn(),
    resolveDeletePosition: vi.fn(),
  };
});

const mockEnqueuePendingAction = vi.fn();
vi.mock('@/contexts/PendingActionsContext', () => ({
  usePendingActions: () => ({ enqueuePendingAction: mockEnqueuePendingAction }),
}));

const mockShowToast = vi.fn();
vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({ showToast: mockShowToast }),
}));

import {
  dryRunDeletePosition,
  resolveDeletePosition,
  ApiError,
} from '@memo/api-client';
import type { DependencyNode, PaginatedResponse, PositionResponse } from '@memo/api-client';
import type { PendingAction } from '@/contexts/PendingActionsContext';
import { useDeletePosition } from '../hooks/usePositionsMutations';

const mockDryRun = vi.mocked(dryRunDeletePosition);
const mockResolveDeletePosition = vi.mocked(resolveDeletePosition);

const positionId = 'smm';

const mockPosition: PositionResponse = {
  id: positionId,
  title: 'СММ',
  is_system: false,
  created_at: '2024-01-01T10:00:00Z',
  updated_at: '2024-01-01T10:00:00Z',
};
const otherPosition: PositionResponse = { ...mockPosition, id: 'master', title: 'Мастер', is_system: true };

// Two ['positions', ...] cache shapes: the /all lookup (usePositions —
// qk.positions = ['positions']) and the paged table (createPagedListContext
// key ['positions', page, perPage]).
const ALL_KEY = ['positions'] as const;
const PAGE_KEY = ['positions', 1, 10] as const;

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

/** Seed both cache granularities the prefix invalidation must cover. */
function seedCaches(queryClient: QueryClient) {
  queryClient.setQueryData([...PAGE_KEY], {
    items: [mockPosition, otherPosition],
    total: 2,
    page: 1,
    per_page: 10,
  });
  queryClient.setQueryData([...ALL_KEY], [mockPosition, otherPosition]);
}

/** A 409 dry-run tree (position side): the single staff_positions node
 *  «Сотрудник» with items (staff ids/names — the `expected` snapshot). */
const POSITION_DEPS: DependencyNode[] = [
  {
    entity: 'staff_positions',
    auto: false,
    relation: 'Сотрудник',
    count: 2,
    allowed_actions: ['cascade'],
    items: [
      { id: 'st-1', label: 'Анна Иванова' },
      { id: 'st-2', label: 'Мария Петрова' },
    ],
  },
];

const RESOLUTIONS: Record<string, string> = { staff_positions: 'cascade' };

function lastEnqueuedAction(): PendingAction {
  const calls = mockEnqueuePendingAction.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as PendingAction;
}

describe('useDeletePosition (deferred #324)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDryRun.mockResolvedValue(undefined);
    mockResolveDeletePosition.mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('removePosition — clean deferred path', () => {
    it('409 → ApiError propagates upward; enqueue NOT called; caches untouched', async () => {
      mockDryRun.mockRejectedValue(
        new ApiError(409, 'has_dependencies', undefined, POSITION_DEPS),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeletePosition(), { wrapper });

      await act(async () => {
        await expect(result.current.removePosition(mockPosition)).rejects.toThrow(ApiError);
      });

      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(mockResolveDeletePosition).not.toHaveBeenCalled();
      const envelope = queryClient.getQueryData<PaginatedResponse<PositionResponse>>([...PAGE_KEY]);
      expect(envelope?.items.find((p) => p.id === positionId)).toBe(mockPosition);
      expect(queryClient.getQueryData<PositionResponse[]>([...ALL_KEY])).toContain(mockPosition);
    });

    it('SYSTEM position: dry-run 422 POSITION_IS_SYSTEM propagates upward — nothing enqueued, row intact', async () => {
      mockDryRun.mockRejectedValue(
        new ApiError(422, 'Встроенная должность не удаляется', 'POSITION_IS_SYSTEM'),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeletePosition(), { wrapper });

      await act(async () => {
        await expect(result.current.removePosition(otherPosition)).rejects.toThrow(ApiError);
      });

      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(mockResolveDeletePosition).not.toHaveBeenCalled();
      // The row stays — a built-in is neither previewed nor deleted.
      expect(queryClient.getQueryData<PositionResponse[]>([...ALL_KEY])).toContain(otherPosition);
    });

    it('204 → enqueue(delete-position-id, «Удалено. Отменить», 5s) with NO server calls before commit', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeletePosition(), { wrapper });

      await act(async () => {
        await result.current.removePosition(mockPosition);
      });

      expect(mockDryRun).toHaveBeenCalledWith(positionId);
      expect(mockResolveDeletePosition).not.toHaveBeenCalled();
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);

      const action = lastEnqueuedAction();
      expect(action.id).toBe(`delete-position-${positionId}`);
      expect(action.kind).toBe('delete');
      expect(action.message).toBe('Удалено. Отменить');
      expect(action.delayMs).toBe(5000);
    });

    it('204 → optimistic row removal from BOTH captured caches', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeletePosition(), { wrapper });

      await act(async () => {
        await result.current.removePosition(mockPosition);
      });

      const envelope = queryClient.getQueryData<PaginatedResponse<PositionResponse>>([...PAGE_KEY]);
      expect(envelope?.items.map((p) => p.id)).toEqual(['master']);
      expect(queryClient.getQueryData<PositionResponse[]>([...ALL_KEY])).toEqual([otherPosition]);
    });

    it('commit → resolveDeletePosition({expected: {}}), then reconcile + invalidate the positions PREFIX', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeletePosition(), { wrapper });

      await act(async () => {
        await result.current.removePosition(mockPosition);
      });
      const { commit } = lastEnqueuedAction();

      // Simulate a mid-window refetch bringing the row back.
      queryClient.setQueryData([...ALL_KEY], [mockPosition, otherPosition]);
      await act(async () => {
        await commit();
      });

      expect(mockResolveDeletePosition).toHaveBeenCalledTimes(1);
      expect(mockResolveDeletePosition).toHaveBeenCalledWith(positionId, { expected: {} });
      expect(queryClient.getQueryData<PositionResponse[]>([...ALL_KEY])).toEqual([otherPosition]);

      // The ['positions'] family PREFIX — the only target (positions is
      // deliberately absent from INVALIDATION_MAP; no cross-family cascade).
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['positions'] });
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['staff'] });
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['records'] });
    });

    it('commit failure → the throw is NOT caught in the hook (onError owns the surface)', async () => {
      mockResolveDeletePosition.mockRejectedValue(
        new ApiError(500, 'Internal error', 'INTERNAL'),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeletePosition(), { wrapper });

      await act(async () => {
        await result.current.removePosition(mockPosition);
      });
      const { commit } = lastEnqueuedAction();

      await act(async () => {
        await expect(commit()).rejects.toThrow(ApiError);
      });
    });

    it('undo → row restored into ITS OWN caches, both shapes preserved, no server calls', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeletePosition(), { wrapper });

      await act(async () => {
        await result.current.removePosition(mockPosition);
      });
      expect(mockDryRun).toHaveBeenCalledTimes(1);

      const { undo } = lastEnqueuedAction();
      act(() => {
        undo();
      });

      const envelope = queryClient.getQueryData<PaginatedResponse<PositionResponse>>([...PAGE_KEY]);
      expect(envelope?.items.find((p) => p.id === positionId)).toBe(mockPosition);
      expect(queryClient.getQueryData<PositionResponse[]>([...ALL_KEY])).toEqual([
        otherPosition,
        mockPosition,
      ]);
      expect(mockDryRun).toHaveBeenCalledTimes(1);
      expect(mockResolveDeletePosition).not.toHaveBeenCalled();
    });
  });

  describe('removePositionResolved — cascade path from DeleteDialog', () => {
    const resolvedPosition: PositionResponse = { ...mockPosition, id: 'p-cascade', title: 'Менеджер' };

    it('builds expected from dependency items (staff ids); commit carries cascade resolutions', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...ALL_KEY], [resolvedPosition, otherPosition]);
      const { result } = renderHook(() => useDeletePosition(), { wrapper });

      await act(async () => {
        await result.current.removePositionResolved(resolvedPosition, RESOLUTIONS, POSITION_DEPS);
      });

      // The dialog path already owns the dependency tree — no second dry-run
      expect(mockDryRun).not.toHaveBeenCalled();

      const action = lastEnqueuedAction();
      expect(action.id).toBe(`delete-position-${resolvedPosition.id}`);
      await act(async () => {
        await action.commit();
      });

      expect(mockResolveDeletePosition).toHaveBeenCalledWith(resolvedPosition.id, {
        resolutions: RESOLUTIONS,
        expected: { staff_positions: ['st-1', 'st-2'] },
      });
    });

    it('optimistic removal happens at enqueue time (dialog closes immediately)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...ALL_KEY], [resolvedPosition, otherPosition]);
      const { result } = renderHook(() => useDeletePosition(), { wrapper });

      await act(async () => {
        await result.current.removePositionResolved(resolvedPosition, RESOLUTIONS, POSITION_DEPS);
      });

      expect(queryClient.getQueryData<PositionResponse[]>([...ALL_KEY])).toEqual([otherPosition]);
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);
      expect(mockResolveDeletePosition).not.toHaveBeenCalled();
    });

    it('commit failure → NOT caught in the hook (same surface as the clean path)', async () => {
      mockResolveDeletePosition.mockRejectedValue(
        new ApiError(409, 'stale_dependencies', undefined, POSITION_DEPS),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...ALL_KEY], [resolvedPosition, otherPosition]);
      const { result } = renderHook(() => useDeletePosition(), { wrapper });

      await act(async () => {
        await result.current.removePositionResolved(resolvedPosition, RESOLUTIONS, POSITION_DEPS);
      });
      const { commit } = lastEnqueuedAction();

      await act(async () => {
        await expect(commit()).rejects.toThrow(ApiError);
      });
    });
  });

  // ── staleAwareOnError — D4 honest-error branches (['positions'] prefix) ──

  describe('staleAwareOnError — commit failures', () => {
    function expectRowRestored(queryClient: QueryClient) {
      const envelope = queryClient.getQueryData<PaginatedResponse<PositionResponse>>([...PAGE_KEY]);
      expect(envelope?.items.find((p) => p.id === positionId)).toBe(mockPosition);
      expect(queryClient.getQueryData<PositionResponse[]>([...ALL_KEY])).toContain(mockPosition);
    }

    it('commit throw 409 + dependencies → onError: undo restores rows + stale toast with «Обновить» (positions prefix)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeletePosition(), { wrapper });

      await act(async () => {
        await result.current.removePosition(mockPosition);
      });
      const { onError } = lastEnqueuedAction();
      expect(onError).toBeDefined();

      await act(async () => {
        onError!(new ApiError(409, 'stale_dependencies', undefined, POSITION_DEPS));
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

      const action = mockShowToast.mock.calls[0][4] as {
        label: string;
        onAction: () => void;
      };
      act(() => {
        action.onAction();
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['positions'] });
    });

    it('non-409 commit error → context-default surface: undo + «Не удалось удалить. Изменение отменено»', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeletePosition(), { wrapper });

      await act(async () => {
        await result.current.removePosition(mockPosition);
      });
      const { onError } = lastEnqueuedAction();

      await act(async () => {
        onError!(new ApiError(500, 'Internal error', 'INTERNAL'));
      });

      expectRowRestored(queryClient);
      expect(mockShowToast).toHaveBeenCalledWith(
        'Не удалось удалить. Изменение отменено',
        'error',
      );
    });

    it('commit throw 404 → quiet success: no toast, no undo — the row stays removed', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeletePosition(), { wrapper });

      await act(async () => {
        await result.current.removePosition(mockPosition);
      });
      const { onError } = lastEnqueuedAction();

      await act(async () => {
        onError!(new ApiError(404, 'Должность не найдена', 'POSITION_NOT_FOUND'));
      });

      expect(mockShowToast).not.toHaveBeenCalled();
      expect(queryClient.getQueryData<PositionResponse[]>([...ALL_KEY])).toEqual([otherPosition]);
    });
  });
});
