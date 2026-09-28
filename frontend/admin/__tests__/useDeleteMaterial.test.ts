/**
 * useDeleteMaterial — GH #345 Task 7: deferred material delete, the conveyor
 * template of useDeleteTag (#318) / useDeleteRecord (#285) / useDeleteStaff
 * (Task 6).
 *
 * Flow under test (both entry points):
 *   1. capture item-level snapshots of every ['materials', ...] cache holding
 *      the row (read-only),
 *   2. ALWAYS dryRunDeleteMaterial first — 409 (deps) REJECTS upward untouched
 *      (the call site parks the tree + opens DeleteDialog); 204 → continue,
 *   3. optimistic row removal from the captured keys only,
 *   4. enqueuePendingAction (5s window): undo restores snapshots by key,
 *      commit = resolveDeleteMaterial({expected, resolutions?}) + removal
 *      reconcile + NON-FATAL invalidation of the ['materials'] family
 *      (INVALIDATION_MAP: ['materials'] only).
 *
 * Material matrix (§4.4): NO blocked state — an unlinked material is clean
 * (204), a linked one returns a single auto `service_materials` node → the
 * all-auto dialog commits `{resolutions: {}, expected: {}}`.
 *
 * Mirrors useDeleteStaff.test.ts (mocked PendingActions + UI contexts, real
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
    dryRunDeleteMaterial: vi.fn(),
    resolveDeleteMaterial: vi.fn(),
  };
});

// Mock the PendingActions provider so the hook's enqueue call is controlled
// by tests (same approach as useDeleteStaff.test.ts).
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

import { dryRunDeleteMaterial, resolveDeleteMaterial, ApiError } from '@memo/api-client';
import type { DependencyNode, PaginatedResponse, MaterialResponse } from '@memo/api-client';
import type { PendingAction } from '@/contexts/PendingActionsContext';
import { useDeleteMaterial } from '../hooks/useMaterialsMutations';

const mockDryRun = vi.mocked(dryRunDeleteMaterial);
const mockResolveDeleteMaterial = vi.mocked(resolveDeleteMaterial);

const materialId = 'mat-1';

const mockMaterial: MaterialResponse = {
  id: materialId, title: 'Краски акварельные', description: 'Набор 12 цветов',
  archived: false, used_in_services_count: 0, created_at: '', updated_at: '',
};
const otherMaterial: MaterialResponse = { ...mockMaterial, id: 'mat-2', title: 'Кисти' };

// Two ['materials', ...] cache shapes: the paged envelope (MaterialsContext
// factory key ['materials', page, perPage, status, ...]) and the bare lookup
// array (useMaterialsRaw).
const PAGE_KEY = ['materials', 1, 10, 'active'] as const;
const ALL_KEY = ['materials'] as const;

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
    items: [mockMaterial, otherMaterial],
    total: 2,
    page: 1,
    per_page: 10,
  });
  queryClient.setQueryData([...ALL_KEY], [mockMaterial, otherMaterial]);
}

/**
 * Material 409 tree (§4.4 matrix — GH #223): a linked material returns ONE
 * auto-cascade node `service_materials`; there is NO blocked variant. The
 * node carries no items (items exist only on client record/visitor nodes)
 * → expected {} from the full tree.
 */
const MATERIAL_DEPS: DependencyNode[] = [
  { entity: 'service_materials', auto: true, relation: 'Услуга', count: 2, allowed_actions: ['cascade'], message: null },
];

function lastEnqueuedAction(): PendingAction {
  const calls = mockEnqueuePendingAction.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as PendingAction;
}

describe('useDeleteMaterial (deferred #345)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDryRun.mockResolvedValue(undefined);
    mockResolveDeleteMaterial.mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('removeMaterial — clean deferred path', () => {
    it('409 + tree → ApiError propagates upward; enqueue NOT called; caches untouched', async () => {
      mockDryRun.mockRejectedValue(
        new ApiError(409, 'has_dependencies', undefined, MATERIAL_DEPS),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteMaterial(), { wrapper });

      await act(async () => {
        await expect(result.current.removeMaterial(mockMaterial)).rejects.toThrow(ApiError);
      });

      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(mockResolveDeleteMaterial).not.toHaveBeenCalled();
      // Dry-run is a pure preview — the caches still hold the row
      const envelope = queryClient.getQueryData<PaginatedResponse<MaterialResponse>>([...PAGE_KEY]);
      expect(envelope?.items.find((m) => m.id === materialId)).toBe(mockMaterial);
      expect(queryClient.getQueryData<MaterialResponse[]>([...ALL_KEY])).toContain(mockMaterial);
    });

    it('204 → enqueue(delete-material-id, «Удалено. Отменить», 5s) with NO server calls before commit', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteMaterial(), { wrapper });

      await act(async () => {
        await result.current.removeMaterial(mockMaterial);
      });

      expect(mockDryRun).toHaveBeenCalledWith(materialId);
      expect(mockResolveDeleteMaterial).not.toHaveBeenCalled();
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);

      const action = lastEnqueuedAction();
      expect(action.id).toBe(`delete-material-${materialId}`);
      expect(action.kind).toBe('delete');
      expect(action.message).toBe('Удалено. Отменить');
      expect(action.delayMs).toBe(5000);
    });

    it('204 → optimistic row removal from the captured caches only (total invariant)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteMaterial(), { wrapper });

      await act(async () => {
        await result.current.removeMaterial(mockMaterial);
      });

      const envelope = queryClient.getQueryData<PaginatedResponse<MaterialResponse>>([...PAGE_KEY]);
      expect(envelope?.items.map((m) => m.id)).toEqual(['mat-2']);
      expect(envelope?.total).toBe(2); // mapRowListCache invariant
      expect(queryClient.getQueryData<MaterialResponse[]>([...ALL_KEY])).toEqual([otherMaterial]);
    });

    it('commit → resolveDeleteMaterial({expected: {}}), then reconcile removal + invalidate the materials family', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteMaterial(), { wrapper });

      await act(async () => {
        await result.current.removeMaterial(mockMaterial);
      });
      const { commit } = lastEnqueuedAction();

      // Simulate a mid-window refetch bringing the row back — commit must
      // reconcile it away again (resolve → remove → invalidate, in order).
      queryClient.setQueryData([...ALL_KEY], [mockMaterial, otherMaterial]);
      await act(async () => {
        await commit();
      });

      expect(mockResolveDeleteMaterial).toHaveBeenCalledTimes(1);
      expect(mockResolveDeleteMaterial).toHaveBeenCalledWith(materialId, { expected: {} });
      expect(queryClient.getQueryData<MaterialResponse[]>([...ALL_KEY])).toEqual([otherMaterial]);

      // Invalidation union (#239 map): ['materials'] only.
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['materials'] });
      // Family invalidation runs AFTER the server call (order contract).
      expect(mockResolveDeleteMaterial.mock.invocationCallOrder[0]).toBeLessThan(
        invalidateSpy.mock.invocationCallOrder[0],
      );
    });

    it('commit failure → the throw is NOT caught in the hook (onError owns the surface)', async () => {
      mockResolveDeleteMaterial.mockRejectedValue(
        new ApiError(500, 'Internal error', 'INTERNAL'),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteMaterial(), { wrapper });

      await act(async () => {
        await result.current.removeMaterial(mockMaterial);
      });
      const { commit } = lastEnqueuedAction();

      await act(async () => {
        await expect(commit()).rejects.toThrow(ApiError);
      });
    });

    it('undo → rows restored into THEIR OWN caches, both shapes preserved, no server calls', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteMaterial(), { wrapper });

      await act(async () => {
        await result.current.removeMaterial(mockMaterial);
      });
      expect(mockDryRun).toHaveBeenCalledTimes(1); // baseline before undo

      const { undo } = lastEnqueuedAction();
      act(() => {
        undo();
      });

      const envelope = queryClient.getQueryData<PaginatedResponse<MaterialResponse>>([...PAGE_KEY]);
      expect(envelope?.items.find((m) => m.id === materialId)).toBe(mockMaterial);
      expect(envelope?.total).toBe(2);
      expect(envelope?.page).toBe(1);
      expect(envelope?.per_page).toBe(10);
      expect(queryClient.getQueryData<MaterialResponse[]>([...ALL_KEY])).toEqual([
        otherMaterial,
        mockMaterial,
      ]);
      // Undo performs NO server calls (spec §5.2)
      expect(mockDryRun).toHaveBeenCalledTimes(1);
      expect(mockResolveDeleteMaterial).not.toHaveBeenCalled();
    });
  });

  describe('removeMaterialResolved — cascade path from DeleteDialog', () => {
    const resolvedMaterial: MaterialResponse = { ...mockMaterial, id: 'mat-cascade' };

    it('confirm → enqueue {resolutions, expected} — material tree (all-auto, no items) → expected {}', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...ALL_KEY], [resolvedMaterial, otherMaterial]);
      const { result } = renderHook(() => useDeleteMaterial(), { wrapper });

      await act(async () => {
        await result.current.removeMaterialResolved(resolvedMaterial, {}, MATERIAL_DEPS);
      });

      // The dialog path already owns the dependency tree — no second dry-run
      expect(mockDryRun).not.toHaveBeenCalled();

      const action = lastEnqueuedAction();
      expect(action.id).toBe(`delete-material-${resolvedMaterial.id}`);
      await act(async () => {
        await action.commit();
      });

      expect(mockResolveDeleteMaterial).toHaveBeenCalledWith(resolvedMaterial.id, {
        resolutions: {},
        expected: {},
      });
    });

    it('optimistic removal happens at enqueue time (dialog closes immediately)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...ALL_KEY], [resolvedMaterial, otherMaterial]);
      const { result } = renderHook(() => useDeleteMaterial(), { wrapper });

      await act(async () => {
        await result.current.removeMaterialResolved(resolvedMaterial, {}, MATERIAL_DEPS);
      });

      expect(queryClient.getQueryData<MaterialResponse[]>([...ALL_KEY])).toEqual([otherMaterial]);
      // enqueue is synchronous — dialog closes without awaiting the commit
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);
      expect(mockResolveDeleteMaterial).not.toHaveBeenCalled();
    });

    it('commit failure → NOT caught in the hook (same surface as the clean path)', async () => {
      mockResolveDeleteMaterial.mockRejectedValue(
        new ApiError(409, 'stale_dependencies', undefined, MATERIAL_DEPS),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...ALL_KEY], [resolvedMaterial, otherMaterial]);
      const { result } = renderHook(() => useDeleteMaterial(), { wrapper });

      await act(async () => {
        await result.current.removeMaterialResolved(resolvedMaterial, {}, MATERIAL_DEPS);
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
      const { result } = renderHook(() => useDeleteMaterial(), { wrapper });

      expect(result.current.isPending).toBe(false);
      let first!: Promise<void>;
      act(() => {
        first = result.current.removeMaterial(mockMaterial);
      });
      // The spinner state landed (§5.3: button disabled while preview runs).
      expect(result.current.isPending).toBe(true);

      // Second click while the dry-run is in flight — the guard skips it.
      const second = result.current.removeMaterial(mockMaterial);
      await act(async () => {
        resolveFirst();
        await Promise.allSettled([first, second]);
      });

      expect(mockDryRun).toHaveBeenCalledTimes(1);
      expect(result.current.isPending).toBe(false);
    });

    it('404 on dry-run → quiet family invalidation; dialog NOT opened; no toast; caches stay', async () => {
      mockDryRun.mockRejectedValue(new ApiError(404, 'Material not found', 'MATERIAL_NOT_FOUND'));
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteMaterial(), { wrapper });

      // Swallowed by the hook (§5.3): the row leaves on refetch — the call
      // site must NOT surface an error toast, so removeMaterial resolves.
      await act(async () => {
        await expect(result.current.removeMaterial(mockMaterial)).resolves.toBeUndefined();
      });

      // Silent family invalidation (#239 map: materials only) — the row
      // leaves on refetch; no dialog (no enqueue), no toast.
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['materials'] });
      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(mockShowToast).not.toHaveBeenCalled();
      const all = queryClient.getQueryData<MaterialResponse[]>([...ALL_KEY]);
      expect(all).toContain(mockMaterial);
    });

    it('network/5xx on dry-run → error toast «Не удалось проверить зависимости»; state unchanged', async () => {
      mockDryRun.mockRejectedValue(new ApiError(500, 'Internal error', 'INTERNAL'));
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteMaterial(), { wrapper });

      await act(async () => {
        await expect(result.current.removeMaterial(mockMaterial)).resolves.toBeUndefined();
      });

      expect(mockShowToast).toHaveBeenCalledTimes(1);
      expect(mockShowToast).toHaveBeenCalledWith('Не удалось проверить зависимости', 'error');
      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(invalidateSpy).not.toHaveBeenCalled();
      expect(queryClient.getQueryData<MaterialResponse[]>([...ALL_KEY])).toContain(mockMaterial);
    });

    it('non-ApiError (network) on dry-run → same «Не удалось проверить зависимости» toast', async () => {
      mockDryRun.mockRejectedValue(new TypeError('Failed to fetch'));
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteMaterial(), { wrapper });

      await act(async () => {
        await expect(result.current.removeMaterial(mockMaterial)).resolves.toBeUndefined();
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
      const envelope = queryClient.getQueryData<PaginatedResponse<MaterialResponse>>([...PAGE_KEY]);
      expect(envelope?.items.find((m) => m.id === materialId)).toBe(mockMaterial);
      expect(queryClient.getQueryData<MaterialResponse[]>([...ALL_KEY])).toContain(mockMaterial);
    }

    it('commit throw 409 + dependencies → onError: undo restores rows + stale toast with «Обновить» action', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteMaterial(), { wrapper });

      await act(async () => {
        await result.current.removeMaterial(mockMaterial);
      });
      const { onError } = lastEnqueuedAction();
      expect(onError).toBeDefined();

      // The PendingActions pipeline routes every non-404 commit error into
      // onError — invoke it as the pipeline would.
      await act(async () => {
        onError!(new ApiError(409, 'stale_dependencies', undefined, MATERIAL_DEPS));
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

      // The «Обновить» action invalidates the materials family.
      const action = mockShowToast.mock.calls[0][4] as {
        label: string;
        onAction: () => void;
      };
      expect(action.label).toBe('Обновить');
      act(() => {
        action.onAction();
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['materials'] });
    });

    it('422 commit error → undo + error toast (blocked body unreachable from UI)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteMaterial(), { wrapper });

      await act(async () => {
        await result.current.removeMaterial(mockMaterial);
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
      const { result } = renderHook(() => useDeleteMaterial(), { wrapper });

      await act(async () => {
        await result.current.removeMaterial(mockMaterial);
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
      const { result } = renderHook(() => useDeleteMaterial(), { wrapper });

      await act(async () => {
        await result.current.removeMaterial(mockMaterial);
      });
      const { onError } = lastEnqueuedAction();

      await act(async () => {
        onError!(new ApiError(404, 'Material not found', 'MATERIAL_NOT_FOUND'));
      });

      // Quiet success: a competitor already deleted the material — nothing
      // to announce, nothing to roll back; the optimistic removal stands.
      expect(mockShowToast).not.toHaveBeenCalled();
      const envelope = queryClient.getQueryData<PaginatedResponse<MaterialResponse>>([...PAGE_KEY]);
      expect(envelope?.items.find((m) => m.id === materialId)).toBeUndefined();
      expect(queryClient.getQueryData<MaterialResponse[]>([...ALL_KEY])).toEqual([otherMaterial]);
    });
  });
});
