import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    createService: vi.fn(),
    updateService: vi.fn(),
    patchService: vi.fn(),
    deleteService: vi.fn(),
    archiveService: vi.fn(),
    restoreService: vi.fn(),
  };
});

import {
  useCreateService,
  useUpdateService,
  usePatchService,
  useDeleteService,
  useArchiveService,
  useRestoreService,
} from '../hooks/useServicesMutations';
import {
  createService,
  updateService,
  patchService,
  deleteService,
  archiveService,
  restoreService,
  ApiError,
} from '@memo/api-client';
import type { ServiceCreate, ServiceUpdate, DependencyNode } from '@memo/api-client';

const mockCreateService = vi.mocked(createService);
const mockUpdateService = vi.mocked(updateService);
const mockPatchService = vi.mocked(patchService);
const mockDeleteService = vi.mocked(deleteService);
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
  beforeEach(() => vi.clearAllMocks());
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

  describe('usePatchService', () => {
    it('calls patchService with id and partial data', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockPatchService.mockResolvedValue({ ...serviceResponse, title: 'Patched' });

      const { result } = renderHook(() => usePatchService(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 's1', data: { title: 'Patched' } });
      });

      expect(mockPatchService).toHaveBeenCalledWith('s1', { title: 'Patched' });
      expect(mockUpdateService).not.toHaveBeenCalled();
    });

    it('invalidates the services query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockPatchService.mockResolvedValue({ ...serviceResponse, title: 'Patched' });

      const { result } = renderHook(() => usePatchService(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 's1', data: { title: 'Patched' } });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['services'] });
    });
  });

  describe('useDeleteService', () => {
    it('calls deleteService with the provided id', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockDeleteService.mockResolvedValue(undefined as never);

      const { result } = renderHook(() => useDeleteService(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('s1');
      });

      expect(mockDeleteService).toHaveBeenCalledWith('s1');
    });

    it('invalidates services AND records caches on success (cross-invalidation)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockDeleteService.mockResolvedValue(undefined as never);

      const { result } = renderHook(() => useDeleteService(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('s1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['services'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
    });

    it('exposes the dependency tree when the dry-run DELETE fails with 409', async () => {
      const { wrapper } = createQueryClientWrapper();
      const deps: DependencyNode[] = [
        { entity: 'tariffs', relation: 'Тариф', count: 3, allowed_actions: ['cascade'] },
        { entity: 'photos', relation: 'Фото', count: 12, allowed_actions: ['nullify'] },
        { entity: 'service_tags', relation: 'Тег', count: 5, allowed_actions: ['cascade'] },
      ];
      mockDeleteService.mockRejectedValue(new ApiError(409, 'has_dependencies', undefined, deps));

      const { result } = renderHook(() => useDeleteService(), { wrapper });

      await act(async () => {
        await expect(result.current.mutateAsync('s1')).rejects.toThrow(ApiError);
      });

      expect(result.current.dependencies).toEqual(deps);
    });

    it('keeps dependencies null for non-409 errors', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockDeleteService.mockRejectedValue(new ApiError(404, 'Service not found', 'SERVICE_NOT_FOUND'));

      const { result } = renderHook(() => useDeleteService(), { wrapper });

      await act(async () => {
        await expect(result.current.mutateAsync('s1')).rejects.toThrow(ApiError);
      });

      expect(result.current.dependencies).toBeNull();
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
