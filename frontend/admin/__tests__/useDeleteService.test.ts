/**
 * useDeleteService — GH #345 Task 7: deferred service delete, the conveyor
 * template of useDeleteTag (#318) / useDeleteRecord (#285) / useDeleteStaff
 * (Task 6).
 *
 * Flow under test (both entry points):
 *   1. capture item-level snapshots of every ['services', ...] cache holding
 *      the row (read-only),
 *   2. ALWAYS dryRunDeleteService first — 409 (deps) REJECTS upward untouched
 *      (the call site parks the tree + opens DeleteDialog); 204 → continue,
 *   3. optimistic row removal from the captured keys only,
 *   4. enqueuePendingAction (5s window): undo restores snapshots by key,
 *      commit = resolveDeleteService({expected, resolutions?}) + removal
 *      reconcile + NON-FATAL invalidation of the ['services'] family
 *      (INVALIDATION_MAP: ['services'] + ['materials'] + ['records']).
 *
 * Service matrix (§4.4): activities BLOCK (Mode B «Архивировать вместо» —
 * unchanged, delete branch unreachable from UI); tariffs, photos,
 * service_tags and service_materials auto-cascade — the all-auto dialog
 * commits `{resolutions: {}, expected: {}}`.
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
    dryRunDeleteService: vi.fn(),
    resolveDeleteService: vi.fn(),
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

import { dryRunDeleteService, resolveDeleteService, ApiError } from '@memo/api-client';
import type { DependencyNode, PaginatedResponse, ServiceResponse } from '@memo/api-client';
import type { PendingAction } from '@/contexts/PendingActionsContext';
import { useDeleteService } from '../hooks/useServicesMutations';

const mockDryRun = vi.mocked(dryRunDeleteService);
const mockResolveDeleteService = vi.mocked(resolveDeleteService);

const serviceId = 'svc-1';

const mockService: ServiceResponse = {
  id: serviceId, title: 'Картина маслом', description: '', image_url: '', specialty: '',
  min_age: 0, max_age: null, duration: 150, record_info: '',
  tariffs: [], tags: [], materials: [], archived: false, created_at: '', updated_at: '',
};
const otherService: ServiceResponse = { ...mockService, id: 'svc-2', title: 'Гончарное дело' };

// Two ['services', ...] cache shapes: the paged envelope (ServicesContext
// factory key ['services', page, perPage, filters, status, ...]) and the bare
// lookup array (useServices/useServicesRaw).
const PAGE_KEY = ['services', 1, 10, 'active'] as const;
const ALL_KEY = ['services'] as const;

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
    items: [mockService, otherService],
    total: 2,
    page: 1,
    per_page: 10,
  });
  queryClient.setQueryData([...ALL_KEY], [mockService, otherService]);
}

/**
 * Service 409 tree (§4.4 matrix): activities BLOCK (allowed_actions: []);
 * tariffs, service_tags and service_materials cascade; photos nullify.
 * Every node is auto/blocked and carries NO items (items exist only on
 * client record/visitor nodes) → expected {} from the full tree.
 */
const SERVICE_DEPS: DependencyNode[] = [
  {
    entity: 'activities', auto: false, relation: 'Активность',
    count: 3, allowed_actions: [], message: 'Удалите активности вручную или архивируйте',
  },
  { entity: 'tariffs', auto: true, relation: 'Тариф', count: 2, allowed_actions: ['cascade'], message: null },
  { entity: 'photos', auto: true, relation: 'Фото', count: 4, allowed_actions: ['nullify'], message: null },
  { entity: 'service_tags', auto: true, relation: 'Тег', count: 1, allowed_actions: ['cascade'], message: null },
  { entity: 'service_materials', auto: true, relation: 'Материал', count: 2, allowed_actions: ['cascade'], message: null },
];

/** All-auto tree (§4.4): no blocked node, no items anywhere → Mode A with
 *  information lines only; confirm → commit {resolutions: {}, expected: {}}. */
const SERVICE_DEPS_AUTO: DependencyNode[] = SERVICE_DEPS.slice(1);

function lastEnqueuedAction(): PendingAction {
  const calls = mockEnqueuePendingAction.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as PendingAction;
}

describe('useDeleteService (deferred #345)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDryRun.mockResolvedValue(undefined);
    mockResolveDeleteService.mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('removeService — clean deferred path', () => {
    it('409 + tree → ApiError propagates upward; enqueue NOT called; caches untouched', async () => {
      mockDryRun.mockRejectedValue(
        new ApiError(409, 'has_dependencies', undefined, SERVICE_DEPS),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteService(), { wrapper });

      await act(async () => {
        await expect(result.current.removeService(mockService)).rejects.toThrow(ApiError);
      });

      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(mockResolveDeleteService).not.toHaveBeenCalled();
      // Dry-run is a pure preview — the caches still hold the row
      const envelope = queryClient.getQueryData<PaginatedResponse<ServiceResponse>>([...PAGE_KEY]);
      expect(envelope?.items.find((s) => s.id === serviceId)).toBe(mockService);
      expect(queryClient.getQueryData<ServiceResponse[]>([...ALL_KEY])).toContain(mockService);
    });

    it('204 → enqueue(delete-service-id, «Удалено. Отменить», 5s) with NO server calls before commit', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteService(), { wrapper });

      await act(async () => {
        await result.current.removeService(mockService);
      });

      expect(mockDryRun).toHaveBeenCalledWith(serviceId);
      expect(mockResolveDeleteService).not.toHaveBeenCalled();
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);

      const action = lastEnqueuedAction();
      expect(action.id).toBe(`delete-service-${serviceId}`);
      expect(action.kind).toBe('delete');
      expect(action.message).toBe('Удалено. Отменить');
      expect(action.delayMs).toBe(5000);
    });

    it('204 → optimistic row removal from the captured caches only (total invariant)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteService(), { wrapper });

      await act(async () => {
        await result.current.removeService(mockService);
      });

      const envelope = queryClient.getQueryData<PaginatedResponse<ServiceResponse>>([...PAGE_KEY]);
      expect(envelope?.items.map((s) => s.id)).toEqual(['svc-2']);
      expect(envelope?.total).toBe(2); // mapRowListCache invariant
      expect(queryClient.getQueryData<ServiceResponse[]>([...ALL_KEY])).toEqual([otherService]);
    });

    it('commit → resolveDeleteService({expected: {}}), then reconcile removal + invalidate the services family map', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteService(), { wrapper });

      await act(async () => {
        await result.current.removeService(mockService);
      });
      const { commit } = lastEnqueuedAction();

      // Simulate a mid-window refetch bringing the row back — commit must
      // reconcile it away again (resolve → remove → invalidate, in order).
      queryClient.setQueryData([...ALL_KEY], [mockService, otherService]);
      await act(async () => {
        await commit();
      });

      expect(mockResolveDeleteService).toHaveBeenCalledTimes(1);
      expect(mockResolveDeleteService).toHaveBeenCalledWith(serviceId, { expected: {} });
      expect(queryClient.getQueryData<ServiceResponse[]>([...ALL_KEY])).toEqual([otherService]);

      // Invalidation union (#239 map): ['services'] + ['materials'] + ['records'].
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['services'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['materials'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
      // Family invalidation runs AFTER the server call (order contract).
      expect(mockResolveDeleteService.mock.invocationCallOrder[0]).toBeLessThan(
        invalidateSpy.mock.invocationCallOrder[0],
      );
    });

    it('commit failure → the throw is NOT caught in the hook (onError owns the surface)', async () => {
      mockResolveDeleteService.mockRejectedValue(
        new ApiError(500, 'Internal error', 'INTERNAL'),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteService(), { wrapper });

      await act(async () => {
        await result.current.removeService(mockService);
      });
      const { commit } = lastEnqueuedAction();

      await act(async () => {
        await expect(commit()).rejects.toThrow(ApiError);
      });
    });

    it('undo → rows restored into THEIR OWN caches, both shapes preserved, no server calls', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteService(), { wrapper });

      await act(async () => {
        await result.current.removeService(mockService);
      });
      expect(mockDryRun).toHaveBeenCalledTimes(1); // baseline before undo

      const { undo } = lastEnqueuedAction();
      act(() => {
        undo();
      });

      const envelope = queryClient.getQueryData<PaginatedResponse<ServiceResponse>>([...PAGE_KEY]);
      expect(envelope?.items.find((s) => s.id === serviceId)).toBe(mockService);
      expect(envelope?.total).toBe(2);
      expect(envelope?.page).toBe(1);
      expect(envelope?.per_page).toBe(10);
      expect(queryClient.getQueryData<ServiceResponse[]>([...ALL_KEY])).toEqual([
        otherService,
        mockService,
      ]);
      // Undo performs NO server calls (spec §5.2)
      expect(mockDryRun).toHaveBeenCalledTimes(1);
      expect(mockResolveDeleteService).not.toHaveBeenCalled();
    });
  });

  describe('removeServiceResolved — cascade path from DeleteDialog', () => {
    const resolvedService: ServiceResponse = { ...mockService, id: 'svc-cascade' };

    it('confirm → enqueue {resolutions, expected} — service tree (all-auto, no items) → expected {}', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...ALL_KEY], [resolvedService, otherService]);
      const { result } = renderHook(() => useDeleteService(), { wrapper });

      await act(async () => {
        await result.current.removeServiceResolved(resolvedService, {}, SERVICE_DEPS_AUTO);
      });

      // The dialog path already owns the dependency tree — no second dry-run
      expect(mockDryRun).not.toHaveBeenCalled();

      const action = lastEnqueuedAction();
      expect(action.id).toBe(`delete-service-${resolvedService.id}`);
      await act(async () => {
        await action.commit();
      });

      expect(mockResolveDeleteService).toHaveBeenCalledWith(resolvedService.id, {
        resolutions: {},
        expected: {},
      });
    });

    it('optimistic removal happens at enqueue time (dialog closes immediately)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...ALL_KEY], [resolvedService, otherService]);
      const { result } = renderHook(() => useDeleteService(), { wrapper });

      await act(async () => {
        await result.current.removeServiceResolved(resolvedService, {}, SERVICE_DEPS_AUTO);
      });

      expect(queryClient.getQueryData<ServiceResponse[]>([...ALL_KEY])).toEqual([otherService]);
      // enqueue is synchronous — dialog closes without awaiting the commit
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);
      expect(mockResolveDeleteService).not.toHaveBeenCalled();
    });

    it('commit failure → NOT caught in the hook (same surface as the clean path)', async () => {
      mockResolveDeleteService.mockRejectedValue(
        new ApiError(409, 'stale_dependencies', undefined, SERVICE_DEPS_AUTO),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...ALL_KEY], [resolvedService, otherService]);
      const { result } = renderHook(() => useDeleteService(), { wrapper });

      await act(async () => {
        await result.current.removeServiceResolved(resolvedService, {}, SERVICE_DEPS_AUTO);
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
      const { result } = renderHook(() => useDeleteService(), { wrapper });

      expect(result.current.isPending).toBe(false);
      let first!: Promise<void>;
      act(() => {
        first = result.current.removeService(mockService);
      });
      // The spinner state landed (§5.3: button disabled while preview runs).
      expect(result.current.isPending).toBe(true);

      // Second click while the dry-run is in flight — the guard skips it.
      const second = result.current.removeService(mockService);
      await act(async () => {
        resolveFirst();
        await Promise.allSettled([first, second]);
      });

      expect(mockDryRun).toHaveBeenCalledTimes(1);
      expect(result.current.isPending).toBe(false);
    });

    it('404 on dry-run → quiet family invalidation; dialog NOT opened; no toast; caches stay', async () => {
      mockDryRun.mockRejectedValue(new ApiError(404, 'Service not found', 'SERVICE_NOT_FOUND'));
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteService(), { wrapper });

      // Swallowed by the hook (§5.3): the row leaves on refetch — the call
      // site must NOT surface an error toast, so removeService resolves.
      await act(async () => {
        await expect(result.current.removeService(mockService)).resolves.toBeUndefined();
      });

      // Silent family invalidation (#239 map: services + materials + records)
      // — the row leaves on refetch; no dialog (no enqueue), no toast.
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['services'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['materials'] });
      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(mockShowToast).not.toHaveBeenCalled();
      const all = queryClient.getQueryData<ServiceResponse[]>([...ALL_KEY]);
      expect(all).toContain(mockService);
    });

    it('network/5xx on dry-run → error toast «Не удалось проверить зависимости»; state unchanged', async () => {
      mockDryRun.mockRejectedValue(new ApiError(500, 'Internal error', 'INTERNAL'));
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteService(), { wrapper });

      await act(async () => {
        await expect(result.current.removeService(mockService)).resolves.toBeUndefined();
      });

      expect(mockShowToast).toHaveBeenCalledTimes(1);
      expect(mockShowToast).toHaveBeenCalledWith('Не удалось проверить зависимости', 'error');
      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(invalidateSpy).not.toHaveBeenCalled();
      expect(queryClient.getQueryData<ServiceResponse[]>([...ALL_KEY])).toContain(mockService);
    });

    it('non-ApiError (network) on dry-run → same «Не удалось проверить зависимости» toast', async () => {
      mockDryRun.mockRejectedValue(new TypeError('Failed to fetch'));
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteService(), { wrapper });

      await act(async () => {
        await expect(result.current.removeService(mockService)).resolves.toBeUndefined();
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
      const envelope = queryClient.getQueryData<PaginatedResponse<ServiceResponse>>([...PAGE_KEY]);
      expect(envelope?.items.find((s) => s.id === serviceId)).toBe(mockService);
      expect(queryClient.getQueryData<ServiceResponse[]>([...ALL_KEY])).toContain(mockService);
    }

    it('commit throw 409 + dependencies → onError: undo restores rows + stale toast with «Обновить» action', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteService(), { wrapper });

      await act(async () => {
        await result.current.removeService(mockService);
      });
      const { onError } = lastEnqueuedAction();
      expect(onError).toBeDefined();

      // The PendingActions pipeline routes every non-404 commit error into
      // onError — invoke it as the pipeline would.
      await act(async () => {
        onError!(new ApiError(409, 'stale_dependencies', undefined, SERVICE_DEPS));
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

      // The «Обновить» action invalidates the services family map.
      const action = mockShowToast.mock.calls[0][4] as {
        label: string;
        onAction: () => void;
      };
      expect(action.label).toBe('Обновить');
      act(() => {
        action.onAction();
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['services'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['materials'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
    });

    it('422 commit error → undo + error toast (blocked body unreachable from UI)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteService(), { wrapper });

      await act(async () => {
        await result.current.removeService(mockService);
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
      const { result } = renderHook(() => useDeleteService(), { wrapper });

      await act(async () => {
        await result.current.removeService(mockService);
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
      const { result } = renderHook(() => useDeleteService(), { wrapper });

      await act(async () => {
        await result.current.removeService(mockService);
      });
      const { onError } = lastEnqueuedAction();

      await act(async () => {
        onError!(new ApiError(404, 'Service not found', 'SERVICE_NOT_FOUND'));
      });

      // Quiet success: a competitor already deleted the service — nothing to
      // announce, nothing to roll back; the optimistic removal stands.
      expect(mockShowToast).not.toHaveBeenCalled();
      const envelope = queryClient.getQueryData<PaginatedResponse<ServiceResponse>>([...PAGE_KEY]);
      expect(envelope?.items.find((s) => s.id === serviceId)).toBeUndefined();
      expect(queryClient.getQueryData<ServiceResponse[]>([...ALL_KEY])).toEqual([otherService]);
    });
  });
});
