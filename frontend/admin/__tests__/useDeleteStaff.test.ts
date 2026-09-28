/**
 * useDeleteStaff — GH #345 Task 6: deferred staff delete, the conveyor
 * template of useDeleteTag (#318) / useDeleteRecord (#285).
 *
 * Flow under test (both entry points):
 *   1. capture item-level snapshots of every ['staff', ...] cache holding
 *      the row (read-only),
 *   2. ALWAYS dryRunDeleteStaff first — 409 (deps) REJECTS upward untouched
 *      (the call site parks the tree + opens DeleteDialog); 204 → continue,
 *   3. optimistic row removal from the captured keys only,
 *   4. enqueuePendingAction (5s window): undo restores snapshots by key,
 *      commit = resolveDeleteStaff({expected, resolutions?}) + removal
 *      reconcile + NON-FATAL invalidation of the ['staff'] family
 *      (INVALIDATION_MAP: ['staff'] + ['masters'] + ['records']).
 *
 * Preview-phase branches (§5.3): isPending gates the delete button (double
 * click → ONE dry-run request); dry-run 404 → silent family invalidation,
 * dialog NOT opened; network/5xx → error toast «Не удалось проверить
 * зависимости», state unchanged.
 *
 * Mirrors useDeleteTag.test.ts (mocked PendingActions + UI contexts, real
 * ApiError class kept via importOriginal — the 409 rejection surface is
 * part of the contract).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    dryRunDeleteStaff: vi.fn(),
    resolveDeleteStaff: vi.fn(),
  };
});

// Mock the PendingActions provider so the hook's enqueue call is controlled
// by tests (same approach as useDeleteTag.test.ts).
const mockEnqueuePendingAction = vi.fn();
vi.mock('@/contexts/PendingActionsContext', () => ({
  usePendingActions: () => ({ enqueuePendingAction: mockEnqueuePendingAction }),
}));

// The stale-aware onError (commit-failure family) calls showToast directly
// from the hook — mock the UI context to assert the error surface.
const mockShowToast = vi.fn();
vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({ showToast: mockShowToast }),
}));

import { dryRunDeleteStaff, resolveDeleteStaff, ApiError } from '@memo/api-client';
import type { DependencyNode, PaginatedResponse, StaffResponse } from '@memo/api-client';
import type { PendingAction } from '@/contexts/PendingActionsContext';
import { useDeleteStaff } from '../hooks/useStaffMutations';

const mockDryRun = vi.mocked(dryRunDeleteStaff);
const mockResolveDeleteStaff = vi.mocked(resolveDeleteStaff);

const staffId = 's-1';

const mockStaff: StaffResponse = {
  id: staffId, first_name: 'Иван', last_name: 'Иванов', avatar_url: null,
  sort_order: 0, master: null, position_ids: [], has_user: false,
  archived: false, created_at: '', updated_at: '',
};
const otherStaff: StaffResponse = { ...mockStaff, id: 's-2', first_name: 'Пётр' };

// Two ['staff', ...] cache shapes: the paged envelope (StaffContext factory
// key ['staff', page, perPage, status]) and the bare lookup array (useStaff).
const PAGE_KEY = ['staff', 1, 10, 'active'] as const;
const ALL_KEY = ['staff'] as const;

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
    items: [mockStaff, otherStaff],
    total: 2,
    page: 1,
    per_page: 10,
  });
  queryClient.setQueryData([...ALL_KEY], [mockStaff, otherStaff]);
}

/**
 * Staff 409 tree (§4.4 matrix): activities BLOCK (allowed_actions: []);
 * users, the masters row, master_tags and staff_positions auto-cascade.
 * Only the CLIENT/record trees carry items on resolvable nodes — the staff
 * tree's nodes are auto/blocked, carrying NO items (expected → {} from them).
 */
const STAFF_DEPS: DependencyNode[] = [
  {
    entity: 'activities', auto: false, relation: 'Активность',
    count: 3, allowed_actions: [], message: null,
  },
  { entity: 'users', auto: true, relation: 'Пользователь', count: 1, allowed_actions: ['cascade'], message: null },
  { entity: 'masters', auto: true, relation: 'Мастер', count: 1, allowed_actions: ['cascade'], message: null },
  { entity: 'staff_positions', auto: true, relation: 'Должность', count: 2, allowed_actions: ['cascade'], message: null },
];

/** All-auto tree (§4.4): no blocked node, no items anywhere → Mode A with
 *  information lines only; confirm → commit {resolutions: {}, expected: {}}. */
const STAFF_DEPS_AUTO: DependencyNode[] = [
  { entity: 'users', auto: true, relation: 'Пользователь', count: 1, allowed_actions: ['cascade'], message: null },
  { entity: 'masters', auto: true, relation: 'Мастер', count: 1, allowed_actions: ['cascade'], message: null },
  { entity: 'master_tags', auto: true, relation: 'Тег', count: 2, allowed_actions: ['cascade'], message: null },
  { entity: 'staff_positions', auto: true, relation: 'Должность', count: 1, allowed_actions: ['cascade'], message: null },
];

function lastEnqueuedAction(): PendingAction {
  const calls = mockEnqueuePendingAction.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as PendingAction;
}

describe('useDeleteStaff (deferred #345)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDryRun.mockResolvedValue(undefined);
    mockResolveDeleteStaff.mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('removeStaff — clean deferred path', () => {
    it('409 + tree → ApiError propagates upward; enqueue NOT called; caches untouched', async () => {
      mockDryRun.mockRejectedValue(
        new ApiError(409, 'has_dependencies', undefined, STAFF_DEPS),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteStaff(), { wrapper });

      await act(async () => {
        await expect(result.current.removeStaff(mockStaff)).rejects.toThrow(ApiError);
      });

      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(mockResolveDeleteStaff).not.toHaveBeenCalled();
      // Dry-run is a pure preview — the caches still hold the row
      const envelope = queryClient.getQueryData<PaginatedResponse<StaffResponse>>([...PAGE_KEY]);
      expect(envelope?.items.find((s) => s.id === staffId)).toBe(mockStaff);
      expect(queryClient.getQueryData<StaffResponse[]>([...ALL_KEY])).toContain(mockStaff);
    });

    it('204 → enqueue(delete-staff-id, «Удалено. Отменить», 5s) with NO server calls before commit', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteStaff(), { wrapper });

      await act(async () => {
        await result.current.removeStaff(mockStaff);
      });

      expect(mockDryRun).toHaveBeenCalledWith(staffId);
      expect(mockResolveDeleteStaff).not.toHaveBeenCalled();
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);

      const action = lastEnqueuedAction();
      expect(action.id).toBe(`delete-staff-${staffId}`);
      expect(action.kind).toBe('delete');
      expect(action.message).toBe('Удалено. Отменить');
      expect(action.delayMs).toBe(5000);
    });

    it('204 → optimistic row removal from the captured caches only (total invariant)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteStaff(), { wrapper });

      await act(async () => {
        await result.current.removeStaff(mockStaff);
      });

      const envelope = queryClient.getQueryData<PaginatedResponse<StaffResponse>>([...PAGE_KEY]);
      expect(envelope?.items.map((s) => s.id)).toEqual(['s-2']);
      expect(envelope?.total).toBe(2); // mapRowListCache invariant
      expect(queryClient.getQueryData<StaffResponse[]>([...ALL_KEY])).toEqual([otherStaff]);
    });

    it('commit → resolveDeleteStaff({expected: {}}), then reconcile removal + invalidate the staff family map', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteStaff(), { wrapper });

      await act(async () => {
        await result.current.removeStaff(mockStaff);
      });
      const { commit } = lastEnqueuedAction();

      // Simulate a mid-window refetch bringing the row back — commit must
      // reconcile it away again (resolve → remove → invalidate, in order).
      queryClient.setQueryData([...ALL_KEY], [mockStaff, otherStaff]);
      await act(async () => {
        await commit();
      });

      expect(mockResolveDeleteStaff).toHaveBeenCalledTimes(1);
      expect(mockResolveDeleteStaff).toHaveBeenCalledWith(staffId, { expected: {} });
      expect(queryClient.getQueryData<StaffResponse[]>([...ALL_KEY])).toEqual([otherStaff]);

      // Invalidation union (#239 map): ['staff'] + ['masters'] + ['records'].
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['staff'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['masters'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
      // Family invalidation runs AFTER the server call (order contract).
      expect(mockResolveDeleteStaff.mock.invocationCallOrder[0]).toBeLessThan(
        invalidateSpy.mock.invocationCallOrder[0],
      );
    });

    it('commit failure → the throw is NOT caught in the hook (onError owns the surface)', async () => {
      mockResolveDeleteStaff.mockRejectedValue(
        new ApiError(500, 'Internal error', 'INTERNAL'),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteStaff(), { wrapper });

      await act(async () => {
        await result.current.removeStaff(mockStaff);
      });
      const { commit } = lastEnqueuedAction();

      await act(async () => {
        await expect(commit()).rejects.toThrow(ApiError);
      });
    });

    it('undo → rows restored into THEIR OWN caches, both shapes preserved, no server calls', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteStaff(), { wrapper });

      await act(async () => {
        await result.current.removeStaff(mockStaff);
      });
      expect(mockDryRun).toHaveBeenCalledTimes(1); // baseline before undo

      const { undo } = lastEnqueuedAction();
      act(() => {
        undo();
      });

      const envelope = queryClient.getQueryData<PaginatedResponse<StaffResponse>>([...PAGE_KEY]);
      expect(envelope?.items.find((s) => s.id === staffId)).toBe(mockStaff);
      expect(envelope?.total).toBe(2);
      expect(envelope?.page).toBe(1);
      expect(envelope?.per_page).toBe(10);
      expect(queryClient.getQueryData<StaffResponse[]>([...ALL_KEY])).toEqual([
        otherStaff,
        mockStaff,
      ]);
      // Undo performs NO server calls (spec §5.2)
      expect(mockDryRun).toHaveBeenCalledTimes(1);
      expect(mockResolveDeleteStaff).not.toHaveBeenCalled();
    });
  });

  describe('removeStaffResolved — cascade path from DeleteDialog', () => {
    const resolvedStaff: StaffResponse = { ...mockStaff, id: 's-cascade' };

    it('confirm → enqueue {resolutions, expected} — staff tree (all-auto, no items) → expected {}', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...ALL_KEY], [resolvedStaff, otherStaff]);
      const { result } = renderHook(() => useDeleteStaff(), { wrapper });

      await act(async () => {
        await result.current.removeStaffResolved(resolvedStaff, {}, STAFF_DEPS_AUTO);
      });

      // The dialog path already owns the dependency tree — no second dry-run
      expect(mockDryRun).not.toHaveBeenCalled();

      const action = lastEnqueuedAction();
      expect(action.id).toBe(`delete-staff-${resolvedStaff.id}`);
      await act(async () => {
        await action.commit();
      });

      expect(mockResolveDeleteStaff).toHaveBeenCalledWith(resolvedStaff.id, {
        resolutions: {},
        expected: {},
      });
    });

    it('optimistic removal happens at enqueue time (dialog closes immediately)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...ALL_KEY], [resolvedStaff, otherStaff]);
      const { result } = renderHook(() => useDeleteStaff(), { wrapper });

      await act(async () => {
        await result.current.removeStaffResolved(resolvedStaff, {}, STAFF_DEPS_AUTO);
      });

      expect(queryClient.getQueryData<StaffResponse[]>([...ALL_KEY])).toEqual([otherStaff]);
      // enqueue is synchronous — dialog closes without awaiting the commit
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);
      expect(mockResolveDeleteStaff).not.toHaveBeenCalled();
    });

    it('commit failure → NOT caught in the hook (same surface as the clean path)', async () => {
      mockResolveDeleteStaff.mockRejectedValue(
        new ApiError(409, 'stale_dependencies', undefined, STAFF_DEPS_AUTO),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...ALL_KEY], [resolvedStaff, otherStaff]);
      const { result } = renderHook(() => useDeleteStaff(), { wrapper });

      await act(async () => {
        await result.current.removeStaffResolved(resolvedStaff, {}, STAFF_DEPS_AUTO);
      });
      const { commit } = lastEnqueuedAction();

      await act(async () => {
        await expect(commit()).rejects.toThrow(ApiError);
      });
    });
  });

  // ── Preview-phase branches (§5.3) ──

  describe('preview phase (§5.3)', () => {
    it('isPending gates the delete button — double click fires ONE dry-run request', async () => {
      // Pending promise: the first click stays in-flight while the second lands.
      let resolveFirst: (v: void) => void = () => {};
      mockDryRun.mockImplementation(
        () => new Promise<void>((res) => { resolveFirst = res; }),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteStaff(), { wrapper });

      expect(result.current.isPending).toBe(false);
      let first!: Promise<void>;
      act(() => {
        first = result.current.removeStaff(mockStaff);
      });
      // The spinner state landed (§5.3: button disabled while preview runs).
      expect(result.current.isPending).toBe(true);

      // Second click while the dry-run is in flight — the guard skips it.
      const second = result.current.removeStaff(mockStaff);
      await act(async () => {
        resolveFirst();
        await Promise.allSettled([first, second]);
      });

      expect(mockDryRun).toHaveBeenCalledTimes(1);
      expect(result.current.isPending).toBe(false);
    });

    it('404 on dry-run → quiet family invalidation; dialog NOT opened; no toast; caches stay', async () => {
      mockDryRun.mockRejectedValue(new ApiError(404, 'Staff not found', 'STAFF_NOT_FOUND'));
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteStaff(), { wrapper });

      // Swallowed by the hook (§5.3): the row leaves on refetch — the call
      // site must NOT surface an error toast, so removeStaff resolves.
      await act(async () => {
        await expect(result.current.removeStaff(mockStaff)).resolves.toBeUndefined();
      });

      // Silent family invalidation (#239 map: staff + masters + records) —
      // the row leaves on refetch; no dialog (no enqueue), no toast.
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['staff'] });
      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(mockShowToast).not.toHaveBeenCalled();
      const all = queryClient.getQueryData<StaffResponse[]>([...ALL_KEY]);
      expect(all).toContain(mockStaff);
    });

    it('network/5xx on dry-run → error toast «Не удалось проверить зависимости»; state unchanged', async () => {
      mockDryRun.mockRejectedValue(new ApiError(500, 'Internal error', 'INTERNAL'));
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteStaff(), { wrapper });

      await act(async () => {
        await expect(result.current.removeStaff(mockStaff)).resolves.toBeUndefined();
      });

      expect(mockShowToast).toHaveBeenCalledTimes(1);
      expect(mockShowToast).toHaveBeenCalledWith('Не удалось проверить зависимости', 'error');
      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(invalidateSpy).not.toHaveBeenCalled();
      expect(queryClient.getQueryData<StaffResponse[]>([...ALL_KEY])).toContain(mockStaff);
    });

    it('non-ApiError (network) on dry-run → same «Не удалось проверить зависимости» toast', async () => {
      mockDryRun.mockRejectedValue(new TypeError('Failed to fetch'));
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteStaff(), { wrapper });

      await act(async () => {
        await expect(result.current.removeStaff(mockStaff)).resolves.toBeUndefined();
      });

      expect(mockShowToast).toHaveBeenCalledWith('Не удалось проверить зависимости', 'error');
      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
    });
  });

  // ── staleAwareOnError — commit-failure branches (§5.4) ──

  describe('staleAwareOnError — commit failures', () => {
    /** Re-grab the row into the caches after the optimistic removal —
     *  simulates the state onError receives (undo must restore snapshots). */
    function expectRowRestored(queryClient: QueryClient) {
      const envelope = queryClient.getQueryData<PaginatedResponse<StaffResponse>>([...PAGE_KEY]);
      expect(envelope?.items.find((s) => s.id === staffId)).toBe(mockStaff);
      expect(queryClient.getQueryData<StaffResponse[]>([...ALL_KEY])).toContain(mockStaff);
    }

    it('commit throw 409 + dependencies → onError: undo restores rows + stale toast with «Обновить» action', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteStaff(), { wrapper });

      await act(async () => {
        await result.current.removeStaff(mockStaff);
      });
      const { onError } = lastEnqueuedAction();
      expect(onError).toBeDefined();

      // The PendingActions pipeline routes every non-404 commit error into
      // onError — invoke it as the pipeline would.
      await act(async () => {
        onError!(new ApiError(409, 'stale_dependencies', undefined, STAFF_DEPS));
      });

      // undo ran — both captured caches hold the row again.
      expectRowRestored(queryClient);
      // Honest error: stale text + the «Обновить» action slot.
      expect(mockShowToast).toHaveBeenCalledTimes(1);
      expect(mockShowToast).toHaveBeenCalledWith(
        'Не удалось удалить: данные изменились',
        'error',
        undefined,
        undefined,
        { label: 'Обновить', onAction: expect.any(Function) },
      );

      // The «Обновить» action invalidates the staff family map.
      const action = mockShowToast.mock.calls[0][4] as {
        label: string;
        onAction: () => void;
      };
      expect(action.label).toBe('Обновить');
      act(() => {
        action.onAction();
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['staff'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['masters'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
    });

    it('422 commit error → undo + error toast (blocked body unreachable from UI)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteStaff(), { wrapper });

      await act(async () => {
        await result.current.removeStaff(mockStaff);
      });
      const { onError } = lastEnqueuedAction();

      await act(async () => {
        onError!(new ApiError(422, 'expected_state_required', 'EXPECTED_STATE_REQUIRED'));
      });

      expectRowRestored(queryClient);
      expect(mockShowToast).toHaveBeenCalledTimes(1);
      expect(mockShowToast).toHaveBeenCalledWith(
        'Не удалось удалить. Изменение отменено',
        'error',
      );
    });

    it('non-ApiError commit error (network/abort) → honest toast «Не удалось подтвердить удаление» (#243 S3)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteStaff(), { wrapper });

      await act(async () => {
        await result.current.removeStaff(mockStaff);
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

    it('commit throw 404 → quiet success: no toast, no undo — the row stays removed', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteStaff(), { wrapper });

      await act(async () => {
        await result.current.removeStaff(mockStaff);
      });
      const { onError } = lastEnqueuedAction();

      await act(async () => {
        onError!(new ApiError(404, 'Staff not found', 'STAFF_NOT_FOUND'));
      });

      // Quiet success: a competitor already deleted the staff — nothing to
      // announce, nothing to roll back; the optimistic removal stands.
      expect(mockShowToast).not.toHaveBeenCalled();
      const envelope = queryClient.getQueryData<PaginatedResponse<StaffResponse>>([...PAGE_KEY]);
      expect(envelope?.items.find((s) => s.id === staffId)).toBeUndefined();
      expect(queryClient.getQueryData<StaffResponse[]>([...ALL_KEY])).toEqual([otherStaff]);
    });
  });
});
