/**
 * useDeleteClient — GH #345 Task 6: deferred client delete, the conveyor
 * template of useDeleteTag (#318) / useDeleteRecord (#285).
 *
 * Client is the only entity with a resolvable commit (§4.4): records
 * (nullify) + visitors (cascade) — both nodes carry `items`, so the confirm
 * payload's `expected` is built from the FULL tree (render caps at 10 +
 * «и ещё N» — the payload carries every id).
 *
 * Extra vs staff: the commit invalidation adds the client modal's POINT key
 * ['client', id] (ClientCardModal's own query, not prefix-covered by the
 * family map — spec §4.1 point-key-on-top rule).
 *
 * Mirrors useDeleteStaff.test.ts (mocked PendingActions + UI contexts, real
 * ApiError class kept via importOriginal).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    dryRunDeleteClient: vi.fn(),
    resolveDeleteClient: vi.fn(),
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

import { dryRunDeleteClient, resolveDeleteClient, ApiError } from '@memo/api-client';
import type {
  ClientWithStats,
  DependencyNode,
  PaginatedResponse,
} from '@memo/api-client';
import type { PendingAction } from '@/contexts/PendingActionsContext';
import { useDeleteClient } from '../hooks/useClientsMutations';

const mockDryRun = vi.mocked(dryRunDeleteClient);
const mockResolveDeleteClient = vi.mocked(resolveDeleteClient);

const clientId = 'c1';

const mockClient: ClientWithStats = {
  id: clientId, name: 'Анна Иванова', phone: '+7 (900) 123-45-67', email: null,
  channel: 'telegram', created_at: '', updated_at: '', archived: false,
  records_count: 2, last_record: null, total_paid: 0, missed_records: 0,
};
const otherClient: ClientWithStats = { ...mockClient, id: 'c2', name: 'Борис Петров' };

// Two ['clients', ...] cache shapes: the paged envelope (ClientsContext
// factory key ['clients', page, perPage, filters]) and the point key of the
// client modal (['client', id] — NOT under the family prefix).
const PAGE_KEY = ['clients', 1, 20, {}] as const;
const POINT_KEY = ['client', clientId] as const;

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

/** Seed the table envelope + the modal's point cache. */
function seedCaches(queryClient: QueryClient) {
  queryClient.setQueryData([...PAGE_KEY], {
    items: [mockClient, otherClient],
    total: 2,
    page: 1,
    per_page: 20,
  });
  queryClient.setQueryData([...POINT_KEY], { ...mockClient, records_count: 0 });
}

/**
 * Client 409 tree (§4.4): records (nullify) + visitors (cascade) carry
 * items; client_tags auto-cascades. The visitors node also carries
 * cascade_preview (visits counter) — inert for `expected`.
 */
const CLIENT_DEPS: DependencyNode[] = [
  {
    entity: 'records', auto: false, relation: 'Запись',
    count: 12, allowed_actions: ['nullify'],
    items: Array.from({ length: 12 }, (_, i) => ({
      id: `rec-${i + 1}`,
      label: `Запись ${i + 1}`,
    })),
  },
  {
    entity: 'visitors', auto: false, relation: 'Посетитель',
    count: 2, allowed_actions: ['cascade'],
    cascade_preview: { visits: 45 },
    items: [
      { id: 'vis-1', label: 'Анна' },
      { id: 'vis-2', label: 'Борис' },
    ],
  },
  { entity: 'client_tags', auto: true, relation: 'Тег', count: 5, allowed_actions: ['cascade'], message: null },
];

const RESOLUTIONS: Record<string, string> = { records: 'nullify', visitors: 'cascade' };

function lastEnqueuedAction(): PendingAction {
  const calls = mockEnqueuePendingAction.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as PendingAction;
}

describe('useDeleteClient (deferred #345)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDryRun.mockResolvedValue(undefined);
    mockResolveDeleteClient.mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('removeClient — clean deferred path', () => {
    it('409 + tree → ApiError propagates upward; enqueue NOT called; caches untouched', async () => {
      mockDryRun.mockRejectedValue(
        new ApiError(409, 'has_dependencies', undefined, CLIENT_DEPS),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteClient(), { wrapper });

      await act(async () => {
        await expect(result.current.removeClient(mockClient)).rejects.toThrow(ApiError);
      });

      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(mockResolveDeleteClient).not.toHaveBeenCalled();
      // Dry-run is a pure preview — the caches still hold the row
      const envelope = queryClient.getQueryData<PaginatedResponse<ClientWithStats>>([...PAGE_KEY]);
      expect(envelope?.items.find((c) => c.id === clientId)).toBe(mockClient);
      expect(queryClient.getQueryData([...POINT_KEY])).toBeDefined();
    });

    it('204 → enqueue(delete-client-id, «Удалено. Отменить», 5s) with NO server calls before commit', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteClient(), { wrapper });

      await act(async () => {
        await result.current.removeClient(mockClient);
      });

      expect(mockDryRun).toHaveBeenCalledWith(clientId);
      expect(mockResolveDeleteClient).not.toHaveBeenCalled();
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);

      const action = lastEnqueuedAction();
      expect(action.id).toBe(`delete-client-${clientId}`);
      expect(action.kind).toBe('delete');
      expect(action.message).toBe('Удалено. Отменить');
      expect(action.delayMs).toBe(5000);
    });

    it('204 → optimistic row removal from the captured caches (envelope; total invariant)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteClient(), { wrapper });

      await act(async () => {
        await result.current.removeClient(mockClient);
      });

      const envelope = queryClient.getQueryData<PaginatedResponse<ClientWithStats>>([...PAGE_KEY]);
      expect(envelope?.items.map((c) => c.id)).toEqual(['c2']);
      expect(envelope?.total).toBe(2); // mapRowListCache invariant
      // The point cache is NOT part of the family prefix — the optimistic
      // removal doesn't touch it; the commit invalidation converges it.
      expect(queryClient.getQueryData([...POINT_KEY])).toBeDefined();
    });

    it('commit → resolveDeleteClient({expected: {}}), reconcile + invalidate the clients family AND the modal point key', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteClient(), { wrapper });

      await act(async () => {
        await result.current.removeClient(mockClient);
      });
      const { commit } = lastEnqueuedAction();

      // Simulate a mid-window refetch bringing the row back — commit must
      // reconcile it away again.
      queryClient.setQueryData([...PAGE_KEY], {
        items: [mockClient, otherClient],
        total: 2,
        page: 1,
        per_page: 20,
      });
      await act(async () => {
        await commit();
      });

      expect(mockResolveDeleteClient).toHaveBeenCalledTimes(1);
      expect(mockResolveDeleteClient).toHaveBeenCalledWith(clientId, { expected: {} });
      const envelope = queryClient.getQueryData<PaginatedResponse<ClientWithStats>>([...PAGE_KEY]);
      expect(envelope?.items.map((c) => c.id)).toEqual(['c2']);

      // Invalidation union: family map (#239: clients + records) + the
      // modal's point key layered ON TOP (§4.1 id → hook rule).
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clients'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['client', clientId] });
      // Family + point invalidation runs AFTER the server call (order).
      expect(mockResolveDeleteClient.mock.invocationCallOrder[0]).toBeLessThan(
        invalidateSpy.mock.invocationCallOrder[0],
      );
    });

    it('commit failure → the throw is NOT caught in the hook (onError owns the surface)', async () => {
      mockResolveDeleteClient.mockRejectedValue(
        new ApiError(500, 'Internal error', 'INTERNAL'),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteClient(), { wrapper });

      await act(async () => {
        await result.current.removeClient(mockClient);
      });
      const { commit } = lastEnqueuedAction();

      await act(async () => {
        await expect(commit()).rejects.toThrow(ApiError);
      });
    });

    it('undo → rows restored into THEIR OWN caches, no server calls', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteClient(), { wrapper });

      await act(async () => {
        await result.current.removeClient(mockClient);
      });
      expect(mockDryRun).toHaveBeenCalledTimes(1); // baseline before undo

      const { undo } = lastEnqueuedAction();
      act(() => {
        undo();
      });

      const envelope = queryClient.getQueryData<PaginatedResponse<ClientWithStats>>([...PAGE_KEY]);
      expect(envelope?.items.find((c) => c.id === clientId)).toBe(mockClient);
      expect(envelope?.total).toBe(2);
      expect(envelope?.page).toBe(1);
      expect(envelope?.per_page).toBe(20);
      // Undo performs NO server calls (spec §5.2)
      expect(mockDryRun).toHaveBeenCalledTimes(1);
      expect(mockResolveDeleteClient).not.toHaveBeenCalled();
    });
  });

  describe('removeClientResolved — cascade path from DeleteDialog', () => {
    const resolvedClient: ClientWithStats = { ...mockClient, id: 'c-cascade' };

    it('confirm → commit {resolutions, expected} — expected carries EVERY id of the FULL tree (12 records, not 10)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData(['clients', 'page-1'], [resolvedClient, otherClient]);
      const { result } = renderHook(() => useDeleteClient(), { wrapper });

      await act(async () => {
        await result.current.removeClientResolved(resolvedClient, RESOLUTIONS, CLIENT_DEPS);
      });

      // The dialog path already owns the dependency tree — no second dry-run
      expect(mockDryRun).not.toHaveBeenCalled();

      const action = lastEnqueuedAction();
      expect(action.id).toBe(`delete-client-${resolvedClient.id}`);
      await act(async () => {
        await action.commit();
      });

      expect(mockResolveDeleteClient).toHaveBeenCalledWith(resolvedClient.id, {
        resolutions: RESOLUTIONS,
        expected: {
          records: Array.from({ length: 12 }, (_, i) => `rec-${i + 1}`),
          visitors: ['vis-1', 'vis-2'],
        },
      });
    });

    it('optimistic removal happens at enqueue time (dialog closes immediately)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData(['clients', 'page-1'], [resolvedClient, otherClient]);
      const { result } = renderHook(() => useDeleteClient(), { wrapper });

      await act(async () => {
        await result.current.removeClientResolved(resolvedClient, RESOLUTIONS, CLIENT_DEPS);
      });

      expect(queryClient.getQueryData(['clients', 'page-1'])).toEqual([otherClient]);
      // enqueue is synchronous — dialog closes without awaiting the commit
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);
      expect(mockResolveDeleteClient).not.toHaveBeenCalled();
    });

    it('commit invalidates the family map + the resolved client\'s modal point key', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      queryClient.setQueryData(['clients', 'page-1'], [resolvedClient, otherClient]);
      const { result } = renderHook(() => useDeleteClient(), { wrapper });

      await act(async () => {
        await result.current.removeClientResolved(resolvedClient, RESOLUTIONS, CLIENT_DEPS);
      });
      const { commit } = lastEnqueuedAction();

      await act(async () => {
        await commit();
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clients'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['client', 'c-cascade'] });
    });

    it('commit failure → NOT caught in the hook (same surface as the clean path)', async () => {
      mockResolveDeleteClient.mockRejectedValue(
        new ApiError(409, 'stale_dependencies', undefined, CLIENT_DEPS),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData(['clients', 'page-1'], [resolvedClient, otherClient]);
      const { result } = renderHook(() => useDeleteClient(), { wrapper });

      await act(async () => {
        await result.current.removeClientResolved(resolvedClient, RESOLUTIONS, CLIENT_DEPS);
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
      const { result } = renderHook(() => useDeleteClient(), { wrapper });

      expect(result.current.isPending).toBe(false);
      let first!: Promise<void>;
      act(() => {
        first = result.current.removeClient(mockClient);
      });
      // The spinner state landed (§5.3: button disabled while preview runs).
      expect(result.current.isPending).toBe(true);

      // Second click while the dry-run is in flight — the guard skips it.
      const second = result.current.removeClient(mockClient);
      await act(async () => {
        resolveFirst();
        await Promise.allSettled([first, second]);
      });

      expect(mockDryRun).toHaveBeenCalledTimes(1);
      expect(result.current.isPending).toBe(false);
    });

    it('404 on dry-run → quiet family invalidation; dialog NOT opened; no toast; caches stay', async () => {
      mockDryRun.mockRejectedValue(new ApiError(404, 'Client not found', 'CLIENT_NOT_FOUND'));
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteClient(), { wrapper });

      // Swallowed by the hook (§5.3): the row leaves on refetch — the call
      // site must NOT surface an error toast, so removeClient resolves.
      await act(async () => {
        await expect(result.current.removeClient(mockClient)).resolves.toBeUndefined();
      });

      // Silent family invalidation (clients + records via the map).
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clients'] });
      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(mockShowToast).not.toHaveBeenCalled();
      const envelope = queryClient.getQueryData<PaginatedResponse<ClientWithStats>>([...PAGE_KEY]);
      expect(envelope?.items.find((c) => c.id === clientId)).toBe(mockClient);
    });

    it('network/5xx on dry-run → error toast «Не удалось проверить зависимости»; state unchanged', async () => {
      mockDryRun.mockRejectedValue(new ApiError(500, 'Internal error', 'INTERNAL'));
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteClient(), { wrapper });

      await act(async () => {
        await expect(result.current.removeClient(mockClient)).resolves.toBeUndefined();
      });

      expect(mockShowToast).toHaveBeenCalledTimes(1);
      expect(mockShowToast).toHaveBeenCalledWith('Не удалось проверить зависимости', 'error');
      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(invalidateSpy).not.toHaveBeenCalled();
      const envelope = queryClient.getQueryData<PaginatedResponse<ClientWithStats>>([...PAGE_KEY]);
      expect(envelope?.items.find((c) => c.id === clientId)).toBe(mockClient);
    });

    it('non-ApiError (network) on dry-run → same «Не удалось проверить зависимости» toast', async () => {
      mockDryRun.mockRejectedValue(new TypeError('Failed to fetch'));
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteClient(), { wrapper });

      await act(async () => {
        await expect(result.current.removeClient(mockClient)).resolves.toBeUndefined();
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
      const envelope = queryClient.getQueryData<PaginatedResponse<ClientWithStats>>([...PAGE_KEY]);
      expect(envelope?.items.find((c) => c.id === clientId)).toBe(mockClient);
    }

    it('commit throw 409 + dependencies → onError: undo restores rows + stale toast with «Обновить» action', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteClient(), { wrapper });

      await act(async () => {
        await result.current.removeClient(mockClient);
      });
      const { onError } = lastEnqueuedAction();
      expect(onError).toBeDefined();

      // The PendingActions pipeline routes every non-404 commit error into
      // onError — invoke it as the pipeline would.
      await act(async () => {
        onError!(new ApiError(409, 'stale_dependencies', undefined, CLIENT_DEPS));
      });

      // undo ran — the captured cache holds the row again.
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

      // The «Обновить» action invalidates the clients family.
      const action = mockShowToast.mock.calls[0][4] as {
        label: string;
        onAction: () => void;
      };
      expect(action.label).toBe('Обновить');
      act(() => {
        action.onAction();
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clients'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
    });

    it('422 commit error → undo + error toast', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteClient(), { wrapper });

      await act(async () => {
        await result.current.removeClient(mockClient);
      });
      const { onError } = lastEnqueuedAction();

      await act(async () => {
        onError!(new ApiError(422, 'resolution_not_allowed', 'RESOLUTION_NOT_ALLOWED'));
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
      const { result } = renderHook(() => useDeleteClient(), { wrapper });

      await act(async () => {
        await result.current.removeClient(mockClient);
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
      const { result } = renderHook(() => useDeleteClient(), { wrapper });

      await act(async () => {
        await result.current.removeClient(mockClient);
      });
      const { onError } = lastEnqueuedAction();

      await act(async () => {
        onError!(new ApiError(404, 'Client not found', 'CLIENT_NOT_FOUND'));
      });

      // Quiet success: a competitor already deleted the client — nothing to
      // announce, nothing to roll back; the optimistic removal stands.
      expect(mockShowToast).not.toHaveBeenCalled();
      const envelope = queryClient.getQueryData<PaginatedResponse<ClientWithStats>>([...PAGE_KEY]);
      expect(envelope?.items.find((c) => c.id === clientId)).toBeUndefined();
    });
  });
});
