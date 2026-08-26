import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

// api-client mock — only the functions used by useDeleteRecord. The real
// ApiError shape comes from importOriginal so 409 `dependencies` parking is
// tested against the actual class (same approach as useMastersMutations).
vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    deleteRecord: vi.fn(),
    resolveDeleteRecord: vi.fn(),
  };
});

const mockShowToast = vi.fn();
vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({
    deleteMode: false,
    toggleDeleteMode: vi.fn(),
    toasts: [],
    showToast: mockShowToast,
    hideToast: vi.fn(),
    sidebarCollapsed: false,
    toggleSidebar: vi.fn(),
    rightPanelCollapsed: true,
    toggleRightPanel: vi.fn(),
    theme: 'light' as const,
    toggleTheme: vi.fn(),
  }),
}));

import { deleteRecord, resolveDeleteRecord, ApiError } from '@memo/api-client';
import type { DependencyNode, PaginatedResponse, RecordResponse } from '@memo/api-client';
import { useDeleteRecord } from '../hooks/useDeleteRecord';

const mockDeleteRecord = vi.mocked(deleteRecord);
const mockResolveDeleteRecord = vi.mocked(resolveDeleteRecord);

const recordId = 'r1';

const mockRecordResponse = {
  id: recordId,
  activity_id: 'ev_1',
  client_id: 'c1',
  status: 'confirmed',
  seats: 1,
  anonym_visits: 0,
  comment: null,
  custom_price: null,
  created_at: '',
  updated_at: '',
  visits: [],
};

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

const RECORD_DEPS: DependencyNode[] = [
  { entity: 'visits', relation: 'Посещение', count: 2, allowed_actions: ['cascade'] },
  { entity: 'payments', relation: 'Платёж', count: 1, allowed_actions: ['cascade'] },
  { entity: 'record_tags', relation: 'Тег', count: 3, allowed_actions: ['cascade'] },
];

describe('useDeleteRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShowToast.mockReset();
    mockDeleteRecord.mockResolvedValue(undefined);
    mockResolveDeleteRecord.mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('dry-run (no-body DELETE)', () => {
    it('calls deleteRecord API with the record id', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useDeleteRecord(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync(recordId);
      });

      expect(mockDeleteRecord).toHaveBeenCalledWith(recordId);
    });

    it('204 → toast «Запись удалена» and invalidates the union: records prefix + record id + visitors', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useDeleteRecord(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync(recordId);
      });

      expect(mockShowToast).toHaveBeenCalledWith('Запись удалена');
      // List readers: ScheduleActivityCard ['records',df,dt], ClientQuickCard
      // ['records','client',id], RecordsTable envelope ['records',page,...]
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
      // Reader: RecordModal canonical ['record', id]
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['record', recordId] });
      // Visits cascade — the client's visitors list counts shrink
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['visitors'] });
      // Narrow invalidation only (#127) — no 5-key blanket
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['activities'] });
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['clients'] });
    });

    it('204 → optimistic prefix-removal from every records cache', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const otherRecord = { ...mockRecordResponse, id: 'r2', visits: [] };
      queryClient.setQueryData(['records', '2026-06-10', '2026-06-10'], {
        items: [mockRecordResponse, otherRecord],
        total: 2,
        page: 1,
        per_page: 10,
      });
      queryClient.setQueryData(['records', 'client', 'c1'], [mockRecordResponse, otherRecord]);

      const { result } = renderHook(() => useDeleteRecord(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync(recordId);
      });

      const dateListAfter = queryClient.getQueryData<PaginatedResponse<RecordResponse>>([
        'records',
        '2026-06-10',
        '2026-06-10',
      ]);
      const clientListAfter = queryClient.getQueryData<RecordResponse[]>([
        'records',
        'client',
        'c1',
      ]);
      expect(dateListAfter?.items.find((r) => r.id === recordId)).toBeUndefined();
      expect(clientListAfter?.find((r) => r.id === recordId)).toBeUndefined();
    });

    it('409 → exposes the dependency tree and does NOT toast', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockDeleteRecord.mockRejectedValue(new ApiError(409, 'has_dependencies', undefined, RECORD_DEPS));

      const { result } = renderHook(() => useDeleteRecord(), { wrapper });

      await act(async () => {
        await expect(result.current.mutateAsync(recordId)).rejects.toThrow(ApiError);
      });

      expect(result.current.dependencies).toEqual(RECORD_DEPS);
      expect(mockShowToast).not.toHaveBeenCalled();
    });

    it('keeps dependencies null and does not toast for non-409 errors', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockDeleteRecord.mockRejectedValue(new ApiError(404, 'Record not found', 'RECORD_NOT_FOUND'));

      const { result } = renderHook(() => useDeleteRecord(), { wrapper });

      await act(async () => {
        await expect(result.current.mutateAsync(recordId)).rejects.toThrow(ApiError);
      });

      expect(result.current.dependencies).toBeNull();
      expect(mockShowToast).not.toHaveBeenCalled();
    });
  });

  describe('resolveDelete (explicit-confirmation cascade)', () => {
    it('calls resolveDeleteRecord with id + resolutions', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useDeleteRecord(), { wrapper });

      await act(async () => {
        await result.current.resolveDelete.mutateAsync({
          id: recordId,
          resolutions: { visits: 'cascade', payments: 'cascade' },
        });
      });

      expect(mockResolveDeleteRecord).toHaveBeenCalledWith(recordId, {
        visits: 'cascade',
        payments: 'cascade',
      });
    });

    it('success → toast + same union invalidations as the dry-run path', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useDeleteRecord(), { wrapper });

      await act(async () => {
        await result.current.resolveDelete.mutateAsync({ id: recordId, resolutions: { visits: 'cascade' } });
      });

      expect(mockShowToast).toHaveBeenCalledWith('Запись удалена');
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['record', recordId] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['visitors'] });
    });

    it('success → optimistic prefix-removal from every records cache', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData(['records', 'client', 'c1'], [mockRecordResponse]);

      const { result } = renderHook(() => useDeleteRecord(), { wrapper });

      await act(async () => {
        await result.current.resolveDelete.mutateAsync({ id: recordId, resolutions: {} });
      });

      const after = queryClient.getQueryData<RecordResponse[]>(['records', 'client', 'c1']);
      expect(after).toEqual([]);
    });
  });
});
