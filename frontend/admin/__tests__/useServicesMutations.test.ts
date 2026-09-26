import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

/**
 * useServicesMutations — mutation family + GH #345 Task 7 deferred delete.
 *
 * Every create/update/patch/archive/restore mutation calls its api-client
 * endpoint and invalidates the ['services'] family, which (via
 * INVALIDATION_MAP) also refreshes ['materials'] (#223: «Где используется»
 * counters) and ['records'].
 *
 * The deferred-delete conveyor (dry-run → dialog → optimistic + enqueue →
 * commit; PendingActions, 5s ring, undo) is covered by the dedicated
 * `useDeleteService.test.ts` — here only the hook-surface contract is
 * asserted (return shape + preview-phase guard).
 */

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    createService: vi.fn(),
    updateService: vi.fn(),
    patchService: vi.fn(),
    dryRunDeleteService: vi.fn(),
    resolveDeleteService: vi.fn(),
    archiveService: vi.fn(),
    restoreService: vi.fn(),
  };
});

// The deferred-delete conveyor needs the PendingActions + UI contexts —
// surface tests mock them (full branch matrix lives in
// useDeleteService.test.ts).
const mockEnqueuePendingAction = vi.fn();
vi.mock('@/contexts/PendingActionsContext', () => ({
  usePendingActions: () => ({ enqueuePendingAction: mockEnqueuePendingAction }),
}));

const mockShowToast = vi.fn();
vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({ showToast: mockShowToast }),
}));

import {
  useCreateService,
  useUpdateService,
  useDeleteService,
  useArchiveService,
  useRestoreService,
} from '../hooks/useServicesMutations';
import {
  createService,
  updateService,
  patchService,
  dryRunDeleteService,
  resolveDeleteService,
  archiveService,
  restoreService,
  ApiError,
} from '@memo/api-client';
import type { ServiceCreate, ServiceUpdate, DependencyNode } from '@memo/api-client';

const mockCreateService = vi.mocked(createService);
const mockUpdateService = vi.mocked(updateService);
const mockPatchService = vi.mocked(patchService);
const mockDryRun = vi.mocked(dryRunDeleteService);
const mockResolveDeleteService = vi.mocked(resolveDeleteService);
const mockArchiveService = vi.mocked(archiveService);
const mockRestoreService = vi.mocked(restoreService);

const serviceResponse = {
  id: 's1', title: 'Test', description: '', image_url: '', specialty: '',
  min_age: 0, max_age: 18, duration: 180, record_info: '',
  tariffs: [], tags: [], materials: [], archived: false, created_at: '', updated_at: '',
};

function createQueryClientWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  };
}

describe('useServicesMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDryRun.mockResolvedValue(undefined);
    mockResolveDeleteService.mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  describe('useCreateService', () => {
    it('calls createService with the provided data', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockCreateService.mockResolvedValue({ id: 'new-1', title: 'Test', description: '', image_url: '', specialty: '', min_age: 0, max_age: 18, duration: 180, record_info: '', tariffs: [], tags: [], materials: [], archived: false, created_at: '', updated_at: '' });

      const { result } = renderHook(() => useCreateService(), { wrapper });

      const payload: ServiceCreate = {
        title: 'Test', duration: 180, description: '', image_url: '',
        specialty: '', min_age: 0, max_age: 18, record_info: '',
        tariffs: [], tag_ids: [], materials: [],
      };

      await act(async () => {
        await result.current.mutateAsync(payload);
      });

      expect(mockCreateService).toHaveBeenCalledWith(payload);
    });

    it('invalidates the services query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockCreateService.mockResolvedValue({ id: 'new-1', title: 'Test', description: '', image_url: '', specialty: '', min_age: 0, max_age: 18, duration: 180, record_info: '', tariffs: [], tags: [], materials: [], archived: false, created_at: '', updated_at: '' });

      const { result } = renderHook(() => useCreateService(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({
          title: 'Test', duration: 180, description: '', image_url: '',
          specialty: '', min_age: 0, max_age: 18, record_info: '',
          tariffs: [], tag_ids: [], materials: [],
        });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['services'] });
    });
  });

  describe('useUpdateService', () => {
    it('calls updateService with id and data', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockUpdateService.mockResolvedValue({ id: 's1', title: 'Updated', description: '', image_url: '', specialty: '', min_age: 0, max_age: 18, duration: 180, record_info: '', tariffs: [], tags: [], materials: [], archived: false, created_at: '', updated_at: '' });

      const { result } = renderHook(() => useUpdateService(), { wrapper });

      // Canonical PUT (GH #178): full typed ServiceUpdate — every field listed.
      // is_active is gone from Update (#207): archive/restore is via POST endpoints.
      const payload: { id: string; data: ServiceUpdate } = {
        id: 's1',
        data: {
          title: 'Updated',
          description: '',
          image_url: '',
          specialty: '',
          min_age: 0,
          max_age: 18,
          duration: 180,
          record_info: '',
          tariffs: [],
          tag_ids: [],
          materials: [],
        },
      };

      await act(async () => {
        await result.current.mutateAsync(payload);
      });

      expect(mockUpdateService).toHaveBeenCalledWith('s1', payload.data);
    });

    it('invalidates the services query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockUpdateService.mockResolvedValue({ id: 's1', title: 'Updated', description: '', image_url: '', specialty: '', min_age: 0, max_age: 18, duration: 180, record_info: '', tariffs: [], tags: [], materials: [], archived: false, created_at: '', updated_at: '' });

      const { result } = renderHook(() => useUpdateService(), { wrapper });

      const payload: ServiceUpdate = {
        title: 'Updated',
        description: '',
        image_url: '',
        specialty: '',
        min_age: 0,
        max_age: 18,
        duration: 180,
        record_info: '',
        tariffs: [],
        tag_ids: [],
        materials: [],
      };

      await act(async () => {
        await result.current.mutateAsync({ id: 's1', data: payload });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['services'] });
    });
  });


  describe('useDeleteService — hook surface (deferred conveyor)', () => {
    it('removeService always dry-runs first; 204 → optimistic + enqueue (surface)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData(['services'], [serviceResponse]);
      const { result } = renderHook(() => useDeleteService(), { wrapper });

      expect(result.current.removeService).toBeTypeOf('function');
      expect(result.current.removeServiceResolved).toBeTypeOf('function');
      expect(result.current.isPending).toBe(false);

      await act(async () => {
        await result.current.removeService(serviceResponse);
      });

      expect(mockDryRun).toHaveBeenCalledWith('s1');
      expect(mockResolveDeleteService).not.toHaveBeenCalled();
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);
    });

    it('409 + dependency tree rejects upward so the call site opens the dialog', async () => {
      const deps: DependencyNode[] = [
        { entity: 'tariffs', auto: true, relation: 'Тариф', count: 3, allowed_actions: ['cascade'] },
        { entity: 'photos', auto: true, relation: 'Фото', count: 12, allowed_actions: ['nullify'] },
      ];
      mockDryRun.mockRejectedValue(new ApiError(409, 'has_dependencies', undefined, deps));

      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useDeleteService(), { wrapper });

      await act(async () => {
        await expect(result.current.removeService(serviceResponse)).rejects.toThrow(ApiError);
      });

      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(mockResolveDeleteService).not.toHaveBeenCalled();
    });
  });

  describe('useArchiveService', () => {
    it('calls archiveService with the provided id', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockArchiveService.mockResolvedValue({ ...serviceResponse, archived: true });

      const { result } = renderHook(() => useArchiveService(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('s1');
      });

      expect(mockArchiveService).toHaveBeenCalledWith('s1');
    });

    it('invalidates the services query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockArchiveService.mockResolvedValue({ ...serviceResponse, archived: true });

      const { result } = renderHook(() => useArchiveService(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('s1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['services'] });
    });
  });

  describe('useRestoreService', () => {
    it('calls restoreService with the provided id', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockRestoreService.mockResolvedValue({ ...serviceResponse, archived: false });

      const { result } = renderHook(() => useRestoreService(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('s1');
      });

      expect(mockRestoreService).toHaveBeenCalledWith('s1');
    });

    it('invalidates the services query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockRestoreService.mockResolvedValue({ ...serviceResponse, archived: false });

      const { result } = renderHook(() => useRestoreService(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('s1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['services'] });
    });
  });
});
