/**
 * useDeleteLocation — GH #345 Task 7: deferred location delete, the conveyor
 * template of useDeleteTag (#318) / useDeleteRecord (#285) / useDeleteStaff
 * (Task 6).
 *
 * Flow under test (both entry points):
 *   1. capture item-level snapshots of every ['locations', ...] cache holding
 *      the row (read-only),
 *   2. ALWAYS dryRunDeleteLocation first — 409 (deps) REJECTS upward untouched
 *      (the call site parks the tree + opens DeleteDialog); 204 → continue,
 *   3. optimistic row removal from the captured keys only,
 *   4. enqueuePendingAction (5s window): undo restores snapshots by key,
 *      commit = resolveDeleteLocation({expected, resolutions?}) + removal
 *      reconcile + NON-FATAL invalidation of the ['locations'] family
 *      (INVALIDATION_MAP: ['locations'] + ['records']).
 *
 * Location matrix (§4.4): activities BLOCK (Mode B «Архивировать вместо» —
 * unchanged, delete branch unreachable from UI); location_tags cascade and
 * photos nullify — the all-auto dialog commits `{resolutions: {},
 * expected: {}}`.
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
    dryRunDeleteLocation: vi.fn(),
    resolveDeleteLocation: vi.fn(),
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

import { dryRunDeleteLocation, resolveDeleteLocation, ApiError } from '@memo/api-client';
import type { DependencyNode, PaginatedResponse, LocationResponse } from '@memo/api-client';
import type { PendingAction } from '@/contexts/PendingActionsContext';
import { useDeleteLocation } from '../hooks/useLocationsMutations';

const mockDryRun = vi.mocked(dryRunDeleteLocation);
const mockResolveDeleteLocation = vi.mocked(resolveDeleteLocation);

const locationId = 'loc-1';

const mockLocation: LocationResponse = {
  id: locationId, title: 'Студия на Невском', address: 'Невский пр. 28', description: null,
  capacity: 10, yandex_map_url: null, review_url: null, record_info: null, image_url: null,
  location_hint: null, sort_order: 0, archived: false, created_at: '', updated_at: '',
};
const otherLocation: LocationResponse = { ...mockLocation, id: 'loc-2', title: 'Гранд Отель Поляна' };

// Two ['locations', ...] cache shapes: the paged envelope (LocationsContext
// factory key ['locations', page, perPage, status, ...]) and the bare lookup
// array (useLocations).
const PAGE_KEY = ['locations', 1, 10, 'active'] as const;
const ALL_KEY = ['locations'] as const;

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
    items: [mockLocation, otherLocation],
    total: 2,
    page: 1,
    per_page: 10,
  });
  queryClient.setQueryData([...ALL_KEY], [mockLocation, otherLocation]);
}

/**
 * Location 409 tree (§4.4 matrix): activities BLOCK (allowed_actions: []);
 * location_tags cascade and photos nullify (auto). Every node is auto or
 * blocked and carries NO items (items exist only on client record/visitor
 * nodes) → expected {} from the full tree.
 */
const LOCATION_DEPS: DependencyNode[] = [
  {
    entity: 'activities', auto: false, relation: 'Активность',
    count: 3, allowed_actions: [], message: 'Удалите активности вручную или архивируйте',
  },
  { entity: 'location_tags', auto: true, relation: 'Тег', count: 2, allowed_actions: ['cascade'], message: null },
  { entity: 'photos', auto: true, relation: 'Фото', count: 4, allowed_actions: ['nullify'], message: null },
];

/** All-auto tree (§4.4): no blocked node, no items anywhere → Mode A with
 *  information lines only; confirm → commit {resolutions: {}, expected: {}}. */
const LOCATION_DEPS_AUTO: DependencyNode[] = LOCATION_DEPS.slice(1);

function lastEnqueuedAction(): PendingAction {
  const calls = mockEnqueuePendingAction.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as PendingAction;
}

describe('useDeleteLocation (deferred #345)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDryRun.mockResolvedValue(undefined);
    mockResolveDeleteLocation.mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('removeLocation — clean deferred path', () => {
    it('409 + tree → ApiError propagates upward; enqueue NOT called; caches untouched', async () => {
      mockDryRun.mockRejectedValue(
        new ApiError(409, 'has_dependencies', undefined, LOCATION_DEPS),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteLocation(), { wrapper });

      await act(async () => {
        await expect(result.current.removeLocation(mockLocation)).rejects.toThrow(ApiError);
      });

      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(mockResolveDeleteLocation).not.toHaveBeenCalled();
      // Dry-run is a pure preview — the caches still hold the row
      const envelope = queryClient.getQueryData<PaginatedResponse<LocationResponse>>([...PAGE_KEY]);
      expect(envelope?.items.find((l) => l.id === locationId)).toBe(mockLocation);
      expect(queryClient.getQueryData<LocationResponse[]>([...ALL_KEY])).toContain(mockLocation);
    });

    it('204 → enqueue(delete-location-id, «Удалено. Отменить», 5s) with NO server calls before commit', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteLocation(), { wrapper });

      await act(async () => {
        await result.current.removeLocation(mockLocation);
      });

      expect(mockDryRun).toHaveBeenCalledWith(locationId);
      expect(mockResolveDeleteLocation).not.toHaveBeenCalled();
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);

      const action = lastEnqueuedAction();
      expect(action.id).toBe(`delete-location-${locationId}`);
      expect(action.kind).toBe('delete');
      expect(action.message).toBe('Удалено. Отменить');
      expect(action.delayMs).toBe(5000);
    });

    it('204 → optimistic row removal from the captured caches only (total invariant)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteLocation(), { wrapper });

      await act(async () => {
        await result.current.removeLocation(mockLocation);
      });

      const envelope = queryClient.getQueryData<PaginatedResponse<LocationResponse>>([...PAGE_KEY]);
      expect(envelope?.items.map((l) => l.id)).toEqual(['loc-2']);
      expect(envelope?.total).toBe(2); // mapRowListCache invariant
      expect(queryClient.getQueryData<LocationResponse[]>([...ALL_KEY])).toEqual([otherLocation]);
    });

    it('commit → resolveDeleteLocation({expected: {}}), then reconcile removal + invalidate the locations family map', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteLocation(), { wrapper });

      await act(async () => {
        await result.current.removeLocation(mockLocation);
      });
      const { commit } = lastEnqueuedAction();

      // Simulate a mid-window refetch bringing the row back — commit must
      // reconcile it away again (resolve → remove → invalidate, in order).
      queryClient.setQueryData([...ALL_KEY], [mockLocation, otherLocation]);
      await act(async () => {
        await commit();
      });

      expect(mockResolveDeleteLocation).toHaveBeenCalledTimes(1);
      expect(mockResolveDeleteLocation).toHaveBeenCalledWith(locationId, { expected: {} });
      expect(queryClient.getQueryData<LocationResponse[]>([...ALL_KEY])).toEqual([otherLocation]);

      // Invalidation union (#239 map): ['locations'] + ['records'].
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['locations'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
      // Family invalidation runs AFTER the server call (order contract).
      expect(mockResolveDeleteLocation.mock.invocationCallOrder[0]).toBeLessThan(
        invalidateSpy.mock.invocationCallOrder[0],
      );
    });

    it('commit failure → the throw is NOT caught in the hook (onError owns the surface)', async () => {
      mockResolveDeleteLocation.mockRejectedValue(
        new ApiError(500, 'Internal error', 'INTERNAL'),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteLocation(), { wrapper });

      await act(async () => {
        await result.current.removeLocation(mockLocation);
      });
      const { commit } = lastEnqueuedAction();

      await act(async () => {
        await expect(commit()).rejects.toThrow(ApiError);
      });
    });

    it('undo → rows restored into THEIR OWN caches, both shapes preserved, no server calls', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteLocation(), { wrapper });

      await act(async () => {
        await result.current.removeLocation(mockLocation);
      });
      expect(mockDryRun).toHaveBeenCalledTimes(1); // baseline before undo

      const { undo } = lastEnqueuedAction();
      act(() => {
        undo();
      });

      const envelope = queryClient.getQueryData<PaginatedResponse<LocationResponse>>([...PAGE_KEY]);
      expect(envelope?.items.find((l) => l.id === locationId)).toBe(mockLocation);
      expect(envelope?.total).toBe(2);
      expect(envelope?.page).toBe(1);
      expect(envelope?.per_page).toBe(10);
      expect(queryClient.getQueryData<LocationResponse[]>([...ALL_KEY])).toEqual([
        otherLocation,
        mockLocation,
      ]);
      // Undo performs NO server calls (spec §5.2)
      expect(mockDryRun).toHaveBeenCalledTimes(1);
      expect(mockResolveDeleteLocation).not.toHaveBeenCalled();
    });
  });

  describe('removeLocationResolved — cascade path from DeleteDialog', () => {
    const resolvedLocation: LocationResponse = { ...mockLocation, id: 'loc-cascade' };

    it('confirm → enqueue {resolutions, expected} — location tree (all-auto, no items) → expected {}', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...ALL_KEY], [resolvedLocation, otherLocation]);
      const { result } = renderHook(() => useDeleteLocation(), { wrapper });

      await act(async () => {
        await result.current.removeLocationResolved(resolvedLocation, {}, LOCATION_DEPS_AUTO);
      });

      // The dialog path already owns the dependency tree — no second dry-run
      expect(mockDryRun).not.toHaveBeenCalled();

      const action = lastEnqueuedAction();
      expect(action.id).toBe(`delete-location-${resolvedLocation.id}`);
      await act(async () => {
        await action.commit();
      });

      expect(mockResolveDeleteLocation).toHaveBeenCalledWith(resolvedLocation.id, {
        resolutions: {},
        expected: {},
      });
    });

    it('optimistic removal happens at enqueue time (dialog closes immediately)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...ALL_KEY], [resolvedLocation, otherLocation]);
      const { result } = renderHook(() => useDeleteLocation(), { wrapper });

      await act(async () => {
        await result.current.removeLocationResolved(resolvedLocation, {}, LOCATION_DEPS_AUTO);
      });

      expect(queryClient.getQueryData<LocationResponse[]>([...ALL_KEY])).toEqual([otherLocation]);
      // enqueue is synchronous — dialog closes without awaiting the commit
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);
      expect(mockResolveDeleteLocation).not.toHaveBeenCalled();
    });

    it('commit failure → NOT caught in the hook (same surface as the clean path)', async () => {
      mockResolveDeleteLocation.mockRejectedValue(
        new ApiError(409, 'stale_dependencies', undefined, LOCATION_DEPS_AUTO),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...ALL_KEY], [resolvedLocation, otherLocation]);
      const { result } = renderHook(() => useDeleteLocation(), { wrapper });

      await act(async () => {
        await result.current.removeLocationResolved(resolvedLocation, {}, LOCATION_DEPS_AUTO);
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
      const { result } = renderHook(() => useDeleteLocation(), { wrapper });

      expect(result.current.isPending).toBe(false);
      let first!: Promise<void>;
      act(() => {
        first = result.current.removeLocation(mockLocation);
      });
      // The spinner state landed (§5.3: button disabled while preview runs).
      expect(result.current.isPending).toBe(true);

      // Second click while the dry-run is in flight — the guard skips it.
      const second = result.current.removeLocation(mockLocation);
      await act(async () => {
        resolveFirst();
        await Promise.allSettled([first, second]);
      });

      expect(mockDryRun).toHaveBeenCalledTimes(1);
      expect(result.current.isPending).toBe(false);
    });

    it('404 on dry-run → quiet family invalidation; dialog NOT opened; no toast; caches stay', async () => {
      mockDryRun.mockRejectedValue(new ApiError(404, 'Location not found', 'LOCATION_NOT_FOUND'));
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteLocation(), { wrapper });

      // Swallowed by the hook (§5.3): the row leaves on refetch — the call
      // site must NOT surface an error toast, so removeLocation resolves.
      await act(async () => {
        await expect(result.current.removeLocation(mockLocation)).resolves.toBeUndefined();
      });

      // Silent family invalidation (#239 map: locations + records) — the row
      // leaves on refetch; no dialog (no enqueue), no toast.
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['locations'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(mockShowToast).not.toHaveBeenCalled();
      const all = queryClient.getQueryData<LocationResponse[]>([...ALL_KEY]);
      expect(all).toContain(mockLocation);
    });

    it('network/5xx on dry-run → error toast «Не удалось проверить зависимости»; state unchanged', async () => {
      mockDryRun.mockRejectedValue(new ApiError(500, 'Internal error', 'INTERNAL'));
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteLocation(), { wrapper });

      await act(async () => {
        await expect(result.current.removeLocation(mockLocation)).resolves.toBeUndefined();
      });

      expect(mockShowToast).toHaveBeenCalledTimes(1);
      expect(mockShowToast).toHaveBeenCalledWith('Не удалось проверить зависимости', 'error');
      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(invalidateSpy).not.toHaveBeenCalled();
      expect(queryClient.getQueryData<LocationResponse[]>([...ALL_KEY])).toContain(mockLocation);
    });

    it('non-ApiError (network) on dry-run → same «Не удалось проверить зависимости» toast', async () => {
      mockDryRun.mockRejectedValue(new TypeError('Failed to fetch'));
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteLocation(), { wrapper });

      await act(async () => {
        await expect(result.current.removeLocation(mockLocation)).resolves.toBeUndefined();
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
      const envelope = queryClient.getQueryData<PaginatedResponse<LocationResponse>>([...PAGE_KEY]);
      expect(envelope?.items.find((l) => l.id === locationId)).toBe(mockLocation);
      expect(queryClient.getQueryData<LocationResponse[]>([...ALL_KEY])).toContain(mockLocation);
    }

    it('commit throw 409 + dependencies → onError: undo restores rows + stale toast with «Обновить» action', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteLocation(), { wrapper });

      await act(async () => {
        await result.current.removeLocation(mockLocation);
      });
      const { onError } = lastEnqueuedAction();
      expect(onError).toBeDefined();

      // The PendingActions pipeline routes every non-404 commit error into
      // onError — invoke it as the pipeline would.
      await act(async () => {
        onError!(new ApiError(409, 'stale_dependencies', undefined, LOCATION_DEPS));
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

      // The «Обновить» action invalidates the locations family map.
      const action = mockShowToast.mock.calls[0][4] as {
        label: string;
        onAction: () => void;
      };
      expect(action.label).toBe('Обновить');
      act(() => {
        action.onAction();
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['locations'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
    });

    it('422 commit error → undo + error toast (blocked body unreachable from UI)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteLocation(), { wrapper });

      await act(async () => {
        await result.current.removeLocation(mockLocation);
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
      const { result } = renderHook(() => useDeleteLocation(), { wrapper });

      await act(async () => {
        await result.current.removeLocation(mockLocation);
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
      const { result } = renderHook(() => useDeleteLocation(), { wrapper });

      await act(async () => {
        await result.current.removeLocation(mockLocation);
      });
      const { onError } = lastEnqueuedAction();

      await act(async () => {
        onError!(new ApiError(404, 'Location not found', 'LOCATION_NOT_FOUND'));
      });

      // Quiet success: a competitor already deleted the location — nothing
      // to announce, nothing to roll back; the optimistic removal stands.
      expect(mockShowToast).not.toHaveBeenCalled();
      const envelope = queryClient.getQueryData<PaginatedResponse<LocationResponse>>([...PAGE_KEY]);
      expect(envelope?.items.find((l) => l.id === locationId)).toBeUndefined();
      expect(queryClient.getQueryData<LocationResponse[]>([...ALL_KEY])).toEqual([otherLocation]);
    });
  });
});
