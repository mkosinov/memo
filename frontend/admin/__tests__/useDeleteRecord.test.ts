/**
 * Deferred record delete (#285, spec §3 D2/D3/D5) — useDeleteRecord rewrite.
 *
 * Flow under test (both entry points):
 *   1. capture item-level snapshots of every ['records', ...] cache holding
 *      the row (read-only),
 *   2. clean path: dry-run DELETE ?dry_run=true — 409 (deps) REJECTS upward
 *      untouched (the call site opens DeleteDialog); 204 → continue,
 *   3. optimistic row removal from the captured keys only,
 *   4. enqueuePendingAction (5s window): undo restores snapshots by key,
 *      commit = resolveDeleteRecord({expected, resolutions?}) + removal
 *      reconcile + NON-FATAL invalidations.
 *
 * No server calls until commit — except the dry-run (D2). PendingActions is
 * mocked; the real ApiError class stays (importOriginal) because the 409
 * rejection surface is part of the contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    dryRunDeleteRecord: vi.fn(),
    resolveDeleteRecord: vi.fn(),
  };
});

// Mock the PendingActions provider so the hook's enqueue call is controlled
// by tests (same approach as useRecordMutations.test.ts).
const mockEnqueuePendingAction = vi.fn();
vi.mock('@/contexts/PendingActionsContext', () => ({
  usePendingActions: () => ({ enqueuePendingAction: mockEnqueuePendingAction }),
}));

// The stale-aware onError (D4 rev8, plan Task 5 (ж)) calls showToast directly
// from the hook — mock the UI context to assert the honest-error surface.
const mockShowToast = vi.fn();
vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({ showToast: mockShowToast }),
}));

import {
  dryRunDeleteRecord,
  resolveDeleteRecord,
  ApiError,
} from '@memo/api-client';
import type {
  DependencyNode,
  PaginatedResponse,
  RecordResponse,
  RecordView,
} from '@memo/api-client';
import type { PendingAction } from '@/contexts/PendingActionsContext';
import { useDeleteRecord } from '../hooks/useDeleteRecord';

const mockDryRun = vi.mocked(dryRunDeleteRecord);
const mockResolveDeleteRecord = vi.mocked(resolveDeleteRecord);

const recordId = 'r1';

/** RecordView row (GH #213 shape) — the paged main list holds these. */
const mockRecordView: RecordView = {
  id: recordId,
  activity_id: 'ev_1',
  client_id: 'c1',
  status: 'confirmed',
  seats: 1,
  comment: null,
  custom_price: null,
  created_at: '2026-06-10T10:00:00',
  updated_at: '2026-06-10T10:00:00',
  visits: [],
  client_name: 'Клиент Тестов',
  activity_start: '2026-06-10T10:00:00',
  service_title: 'МК Гончарное дело',
  master_name: 'Мастер А',
  location_name: 'Локация 1',
  master_color: '#004D56',
  is_private: false,
  paid: 0,
};

const otherRow: RecordResponse = {
  id: 'r2',
  activity_id: 'ev_1',
  client_id: 'c1',
  status: 'confirmed',
  seats: 1,
  comment: null,
  custom_price: null,
  created_at: '',
  updated_at: '',
  visits: [],
};

const DATE_KEY = ['records', '2026-06-10', '2026-06-10'] as const;
const CLIENT_KEY = ['records', 'client', 'c1'] as const;

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
  queryClient.setQueryData([...DATE_KEY], {
    items: [mockRecordView, otherRow],
    total: 2,
    page: 1,
    per_page: 10,
  });
  queryClient.setQueryData([...CLIENT_KEY], [mockRecordView, otherRow]);
}

/** A 409 dry-run tree: items carry ids for `expected`; auto nodes have none. */
const RECORD_DEPS: DependencyNode[] = [
  {
    entity: 'visits',
    relation: 'Посещение',
    count: 2,
    allowed_actions: ['cascade'],
    items: [
      { id: '11111111-1111-1111-1111-111111111111', label: 'Гончарное дело, 10:00' },
      { id: '22222222-2222-2222-2222-222222222222', label: 'Лепка, 11:00' },
    ],
  },
  {
    entity: 'payments',
    relation: 'Платёж',
    count: 1,
    allowed_actions: ['cascade'],
    items: [{ id: '33333333-3333-3333-3333-333333333333', label: '3500, card' }],
  },
  { entity: 'record_tags', relation: 'Тег', count: 3, allowed_actions: ['cascade'] },
];

const RESOLUTIONS: Record<string, string> = { visits: 'cascade', payments: 'cascade' };

function lastEnqueuedAction(): PendingAction {
  const calls = mockEnqueuePendingAction.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as PendingAction;
}

describe('useDeleteRecord (deferred #285)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDryRun.mockResolvedValue(undefined);
    mockResolveDeleteRecord.mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('removeRecord — clean deferred path', () => {
    it('409 → ApiError propagates upward; enqueue NOT called; caches untouched', async () => {
      mockDryRun.mockRejectedValue(
        new ApiError(409, 'has_dependencies', undefined, RECORD_DEPS),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteRecord(), { wrapper });

      await act(async () => {
        await expect(
          result.current.removeRecord(mockRecordView),
        ).rejects.toThrow(ApiError);
      });

      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(mockResolveDeleteRecord).not.toHaveBeenCalled();
      // Dry-run is a pure preview — the captured snapshots are not applied
      const envelope = queryClient.getQueryData<PaginatedResponse<RecordResponse>>([
        ...DATE_KEY,
      ]);
      expect(envelope?.items.find((r) => r.id === recordId)).toBe(mockRecordView);
      expect(
        queryClient.getQueryData<RecordResponse[]>([...CLIENT_KEY]),
      ).toContain(mockRecordView);
    });

    it('non-409 dry-run error (404) propagates upward too — no interception in the hook', async () => {
      mockDryRun.mockRejectedValue(new ApiError(404, 'Record not found', 'RECORD_NOT_FOUND'));
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteRecord(), { wrapper });

      await act(async () => {
        await expect(
          result.current.removeRecord(mockRecordView),
        ).rejects.toThrow(ApiError);
      });

      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      // Snapshots are read-only — the cache still holds the row
      expect(
        queryClient.getQueryData<RecordResponse[]>([...CLIENT_KEY]),
      ).toContain(mockRecordView);
    });

    it('204 → enqueue(id, «Удалено. Отменить», 5s) with NO server calls before commit', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteRecord(), { wrapper });

      await act(async () => {
        await result.current.removeRecord(mockRecordView);
      });

      expect(mockDryRun).toHaveBeenCalledWith(recordId);
      expect(mockResolveDeleteRecord).not.toHaveBeenCalled();
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);

      const action = lastEnqueuedAction();
      expect(action.id).toBe(`delete-record-${recordId}`);
      expect(action.kind).toBe('delete');
      expect(action.message).toBe('Удалено. Отменить');
      expect(action.delayMs).toBe(5000);
    });

    it('204 → optimistic row removal from the captured caches only (total invariant)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteRecord(), { wrapper });

      await act(async () => {
        await result.current.removeRecord(mockRecordView);
      });

      const envelope = queryClient.getQueryData<PaginatedResponse<RecordResponse>>([
        ...DATE_KEY,
      ]);
      expect(envelope?.items.map((r) => r.id)).toEqual(['r2']);
      expect(envelope?.total).toBe(2); // mapRecordsListCache invariant
      expect(queryClient.getQueryData<RecordResponse[]>([...CLIENT_KEY])).toEqual([
        otherRow,
      ]);
    });

    it('commit → resolveDeleteRecord({expected: {}}), then reconcile removal + invalidate', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteRecord(), { wrapper });

      await act(async () => {
        await result.current.removeRecord(mockRecordView);
      });
      const { commit } = lastEnqueuedAction();

      // Simulate a mid-window refetch bringing the row back — commit must
      // reconcile it away again (resolve → remove → invalidate, in order).
      queryClient.setQueryData([...CLIENT_KEY], [mockRecordView, otherRow]);
      await act(async () => {
        await commit();
      });

      expect(mockResolveDeleteRecord).toHaveBeenCalledTimes(1);
      expect(mockResolveDeleteRecord).toHaveBeenCalledWith(recordId, { expected: {} });
      expect(queryClient.getQueryData<RecordResponse[]>([...CLIENT_KEY])).toEqual([
        otherRow,
      ]);

      const invalidateCalls = invalidateSpy.mock.invocationCallOrder;
      expect(invalidateCalls.length).toBeGreaterThan(0);
      expect(mockResolveDeleteRecord.mock.invocationCallOrder[0]).toBeLessThan(
        invalidateCalls[0],
      );
      // Invalidation union (#127/#239): ['records'] + ['visitors'] + point key
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['record', recordId] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['visitors'] });
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['clients'] });
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['activities'] });
    });

    it('commit failure → the throw is NOT caught in the hook (onError lands in Task 6)', async () => {
      mockResolveDeleteRecord.mockRejectedValue(
        new ApiError(500, 'Internal error', 'INTERNAL'),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteRecord(), { wrapper });

      await act(async () => {
        await result.current.removeRecord(mockRecordView);
      });
      const { commit } = lastEnqueuedAction();

      await act(async () => {
        await expect(commit()).rejects.toThrow(ApiError);
      });
    });

    it('undo → rows restored into THEIR OWN caches, both shapes preserved, no server calls', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteRecord(), { wrapper });

      await act(async () => {
        await result.current.removeRecord(mockRecordView);
      });
      expect(mockDryRun).toHaveBeenCalledTimes(1); // baseline before undo

      const { undo } = lastEnqueuedAction();
      act(() => {
        undo();
      });

      const envelope = queryClient.getQueryData<PaginatedResponse<RecordResponse>>([
        ...DATE_KEY,
      ]);
      expect(envelope?.items.find((r) => r.id === recordId)).toBe(mockRecordView);
      expect(envelope?.total).toBe(2);
      expect(envelope?.page).toBe(1);
      expect(envelope?.per_page).toBe(10);
      expect(queryClient.getQueryData<RecordResponse[]>([...CLIENT_KEY])).toEqual([
        otherRow,
        mockRecordView,
      ]);
      // Undo performs NO server calls (spec D5)
      expect(mockDryRun).toHaveBeenCalledTimes(1);
      expect(mockResolveDeleteRecord).not.toHaveBeenCalled();
    });
  });

  describe('removeRecordResolved — cascade path from DeleteDialog', () => {
    const resolvedRecord: RecordView = {
      ...mockRecordView,
      id: 'r-cascade',
    };

    it('builds expected from dependency items (ids), skips auto nodes without items', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const cascadeDateKey = ['records', '2026-06-10', '2026-06-10'] as const;
      queryClient.setQueryData([...cascadeDateKey], {
        items: [resolvedRecord, otherRow],
        total: 2,
        page: 1,
        per_page: 10,
      });
      const { result } = renderHook(() => useDeleteRecord(), { wrapper });

      await act(async () => {
        await result.current.removeRecordResolved(
          resolvedRecord,
          RESOLUTIONS,
          RECORD_DEPS,
        );
      });

      // The dialog path already owns the dependency tree — no second dry-run
      expect(mockDryRun).not.toHaveBeenCalled();

      const action = lastEnqueuedAction();
      expect(action.id).toBe(`delete-record-${resolvedRecord.id}`);
      await act(async () => {
        await action.commit();
      });

      expect(mockResolveDeleteRecord).toHaveBeenCalledWith(resolvedRecord.id, {
        resolutions: RESOLUTIONS,
        expected: {
          visits: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
          payments: ['33333333-3333-3333-3333-333333333333'],
        },
      });
    });

    it('optimistic removal happens at enqueue time (dialog closes immediately, D3)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const cascadeClientKey = ['records', 'client', 'c1'] as const;
      queryClient.setQueryData([...cascadeClientKey], [resolvedRecord, otherRow]);
      const { result } = renderHook(() => useDeleteRecord(), { wrapper });

      await act(async () => {
        await result.current.removeRecordResolved(
          resolvedRecord,
          RESOLUTIONS,
          RECORD_DEPS,
        );
      });

      expect(queryClient.getQueryData<RecordResponse[]>([...cascadeClientKey])).toEqual([
        otherRow,
      ]);
      // enqueue is synchronous — dialog closes without awaiting the commit
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);
      expect(mockResolveDeleteRecord).not.toHaveBeenCalled();
    });

    it('empty dependencies → expected {} (pure resolved path)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...CLIENT_KEY], [resolvedRecord, otherRow]);
      const { result } = renderHook(() => useDeleteRecord(), { wrapper });

      await act(async () => {
        await result.current.removeRecordResolved(resolvedRecord, {}, []);
      });
      const { commit } = lastEnqueuedAction();

      await act(async () => {
        await commit();
      });

      expect(mockResolveDeleteRecord).toHaveBeenCalledWith(resolvedRecord.id, {
        resolutions: {},
        expected: {},
      });
    });

    it('commit failure → NOT caught in the hook (same surface as the clean path)', async () => {
      mockResolveDeleteRecord.mockRejectedValue(
        new ApiError(409, 'stale_dependencies', undefined, RECORD_DEPS),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...CLIENT_KEY], [resolvedRecord, otherRow]);
      const { result } = renderHook(() => useDeleteRecord(), { wrapper });

      await act(async () => {
        await result.current.removeRecordResolved(
          resolvedRecord,
          RESOLUTIONS,
          RECORD_DEPS,
        );
      });
      const { commit } = lastEnqueuedAction();

      await act(async () => {
        await expect(commit()).rejects.toThrow(ApiError);
      });
    });
  });

  // ── staleAwareOnError — D4 rev8 honest-error branch (plan Task 5 (ж)) ─────

  describe('staleAwareOnError — commit 409 stale_dependencies (D4 rev8)', () => {
    /** Re-grab the row into a cache after the optimistic removal — simulates
     *  the state onError receives (undo must restore from snapshots). */
    function expectRowRestored(queryClient: QueryClient) {
      const envelope = queryClient.getQueryData<PaginatedResponse<RecordResponse>>([
        ...DATE_KEY,
      ]);
      expect(envelope?.items.find((r) => r.id === recordId)).toBe(mockRecordView);
      expect(
        queryClient.getQueryData<RecordResponse[]>([...CLIENT_KEY]),
      ).toContain(mockRecordView);
    }

    it('commit throw 409 + dependencies → onError: undo restores rows + stale toast with «Обновить» action', async () => {
      mockResolveDeleteRecord.mockRejectedValue(
        new ApiError(409, 'stale_dependencies', undefined, RECORD_DEPS),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteRecord(), { wrapper });

      await act(async () => {
        await result.current.removeRecord(mockRecordView);
      });
      const { onError } = lastEnqueuedAction();
      expect(onError).toBeDefined();

      // The PendingActions pipeline routes every non-404 commit error into
      // onError — invoke it as the pipeline would.
      await act(async () => {
        onError!(new ApiError(409, 'stale_dependencies', undefined, RECORD_DEPS));
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

      // The «Обновить» action invalidates the ['records']-family (the shared
      // map routes ['records'] → ['records'] + ['visitors']).
      const action = mockShowToast.mock.calls[0][4] as {
        label: string;
        onAction: () => void;
      };
      expect(action.label).toBe('Обновить');
      act(() => {
        action.onAction();
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['visitors'] });
    });

    it('non-409 commit error → context-default surface: undo + default toast, no action slot', async () => {
      mockResolveDeleteRecord.mockRejectedValue(
        new ApiError(500, 'Internal error', 'INTERNAL'),
      );
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCaches(queryClient);
      const { result } = renderHook(() => useDeleteRecord(), { wrapper });

      await act(async () => {
        await result.current.removeRecord(mockRecordView);
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
      mockResolveDeleteRecord.mockRejectedValue(
        new ApiError(409, 'stale_dependencies', undefined, RECORD_DEPS),
      );
      const resolvedRecord: RecordView = { ...mockRecordView, id: 'r-cascade' };
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData([...CLIENT_KEY], [resolvedRecord, otherRow]);
      const { result } = renderHook(() => useDeleteRecord(), { wrapper });

      await act(async () => {
        await result.current.removeRecordResolved(
          resolvedRecord,
          RESOLUTIONS,
          RECORD_DEPS,
        );
      });
      const { onError } = lastEnqueuedAction();

      await act(async () => {
        onError!(new ApiError(409, 'stale_dependencies', undefined, RECORD_DEPS));
      });

      expect(mockShowToast).toHaveBeenCalledWith(
        'Не удалось удалить: данные изменились',
        'error',
        undefined,
        undefined,
        { label: 'Обновить', onAction: expect.any(Function) },
      );
      // The undo restored the cascade row into ITS captured cache.
      expect(
        queryClient.getQueryData<RecordResponse[]>([...CLIENT_KEY]),
      ).toContain(resolvedRecord);
    });
  });
});
