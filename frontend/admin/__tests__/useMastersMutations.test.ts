import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    createMaster: vi.fn(),
    updateMaster: vi.fn(),
    patchMaster: vi.fn(),
    deleteMaster: vi.fn(),
    archiveMaster: vi.fn(),
    restoreMaster: vi.fn(),
  };
});

import {
  useCreateMaster,
  useUpdateMaster,
  usePatchMaster,
  useDeleteMaster,
  useArchiveMaster,
  useRestoreMaster,
} from '../hooks/useMastersMutations';
import {
  createMaster,
  updateMaster,
  patchMaster,
  deleteMaster,
  archiveMaster,
  restoreMaster,
  ApiError,
} from '@memo/api-client';
import type { MasterCreate, MasterUpdate, DependencyNode } from '@memo/api-client';

const mockCreateMaster = vi.mocked(createMaster);
const mockUpdateMaster = vi.mocked(updateMaster);
const mockPatchMaster = vi.mocked(patchMaster);
const mockDeleteMaster = vi.mocked(deleteMaster);
const mockArchiveMaster = vi.mocked(archiveMaster);
const mockRestoreMaster = vi.mocked(restoreMaster);

const masterResponse = {
  id: 'm-1', first_name: 'Иван', last_name: 'Иванов', color: '#004D56',
  position: 'мастер', specialty: 'живопись', avatar_url: null,
  archived: false, created_at: '', updated_at: '',
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

describe('useMastersMutations', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  describe('useCreateMaster', () => {
    it('calls createMaster with the provided data', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockCreateMaster.mockResolvedValue(masterResponse);

      const { result } = renderHook(() => useCreateMaster(), { wrapper });

      const payload: MasterCreate = {
        first_name: 'Иван', last_name: 'Иванов', color: '#004D56',
        position: 'мастер', specialty: 'живопись', avatar_url: '',
      };

      await act(async () => {
        await result.current.mutateAsync(payload);
      });

      expect(mockCreateMaster).toHaveBeenCalledWith(payload);
    });

    it('invalidates the masters query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockCreateMaster.mockResolvedValue(masterResponse);

      const { result } = renderHook(() => useCreateMaster(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({
          first_name: 'Иван', last_name: 'Иванов', color: '#004D56',
          position: 'мастер', specialty: 'живопись', avatar_url: '',
        });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['masters'] });
    });
  });

  describe('useUpdateMaster', () => {
    it('calls updateMaster with id and data', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockUpdateMaster.mockResolvedValue({ ...masterResponse, first_name: 'Пётр' });

      const { result } = renderHook(() => useUpdateMaster(), { wrapper });

      // Canonical PUT (GH #178): full typed MasterUpdate — every field listed.
      // is_active is gone from Update (#207): archive/restore is via POST endpoints.
      const payload: MasterUpdate = {
        first_name: 'Пётр',
        last_name: 'Иванов',
        color: '#AABBCC',
        position: 'мастер',
        specialty: 'живопись',
        avatar_url: '',
      };

      await act(async () => {
        await result.current.mutateAsync({ id: 'm-1', data: payload });
      });

      expect(mockUpdateMaster).toHaveBeenCalledWith('m-1', payload);
    });
  });

  describe('usePatchMaster', () => {
    it('calls patchMaster with id and partial data', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockPatchMaster.mockResolvedValue({ ...masterResponse, specialty: 'керамика' });

      const { result } = renderHook(() => usePatchMaster(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'm-1', data: { specialty: 'керамика' } });
      });

      expect(mockPatchMaster).toHaveBeenCalledWith('m-1', { specialty: 'керамика' });
      expect(mockUpdateMaster).not.toHaveBeenCalled();
    });

    it('invalidates the masters query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockPatchMaster.mockResolvedValue({ ...masterResponse, specialty: 'керамика' });

      const { result } = renderHook(() => usePatchMaster(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'm-1', data: { specialty: 'керамика' } });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['masters'] });
    });
  });

  describe('useDeleteMaster', () => {
    it('calls deleteMaster with the provided id', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockDeleteMaster.mockResolvedValue(undefined);

      const { result } = renderHook(() => useDeleteMaster(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('m-1');
      });

      expect(mockDeleteMaster).toHaveBeenCalledWith('m-1');
    });

    it('invalidates masters AND records caches on success (cross-invalidation)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockDeleteMaster.mockResolvedValue(undefined);

      const { result } = renderHook(() => useDeleteMaster(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('m-1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['masters'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
    });

    it('exposes the dependency tree when the dry-run DELETE fails with 409', async () => {
      const { wrapper } = createQueryClientWrapper();
      const deps: DependencyNode[] = [
        { entity: 'users', relation: 'Пользователь', count: 1, allowed_actions: ['cascade'] },
        { entity: 'master_tags', relation: 'Тег', count: 3, allowed_actions: ['cascade'] },
      ];
      mockDeleteMaster.mockRejectedValue(new ApiError(409, 'has_dependencies', undefined, deps));

      const { result } = renderHook(() => useDeleteMaster(), { wrapper });

      await act(async () => {
        await expect(result.current.mutateAsync('m-1')).rejects.toThrow(ApiError);
      });

      expect(result.current.dependencies).toEqual(deps);
    });

    it('keeps dependencies null for non-409 errors', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockDeleteMaster.mockRejectedValue(new ApiError(404, 'Master not found', 'MASTER_NOT_FOUND'));

      const { result } = renderHook(() => useDeleteMaster(), { wrapper });

      await act(async () => {
        await expect(result.current.mutateAsync('m-1')).rejects.toThrow(ApiError);
      });

      expect(result.current.dependencies).toBeNull();
    });
  });

  describe('useArchiveMaster', () => {
    it('calls archiveMaster with the provided id', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockArchiveMaster.mockResolvedValue({ ...masterResponse, archived: true });

      const { result } = renderHook(() => useArchiveMaster(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('m-1');
      });

      expect(mockArchiveMaster).toHaveBeenCalledWith('m-1');
    });

    it('invalidates the masters query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockArchiveMaster.mockResolvedValue({ ...masterResponse, archived: true });

      const { result } = renderHook(() => useArchiveMaster(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('m-1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['masters'] });
    });
  });

  describe('useRestoreMaster', () => {
    it('calls restoreMaster with the provided id', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockRestoreMaster.mockResolvedValue({ ...masterResponse, archived: false });

      const { result } = renderHook(() => useRestoreMaster(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('m-1');
      });

      expect(mockRestoreMaster).toHaveBeenCalledWith('m-1');
    });

    it('invalidates the masters query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockRestoreMaster.mockResolvedValue({ ...masterResponse, archived: false });

      const { result } = renderHook(() => useRestoreMaster(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('m-1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['masters'] });
    });
  });
});
