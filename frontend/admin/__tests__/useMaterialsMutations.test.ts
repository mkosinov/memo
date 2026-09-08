import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    createMaterial: vi.fn(),
    updateMaterial: vi.fn(),
    patchMaterial: vi.fn(),
    deleteMaterial: vi.fn(),
    archiveMaterial: vi.fn(),
    restoreMaterial: vi.fn(),
  };
});

import {
  useCreateMaterial,
  useUpdateMaterial,
  usePatchMaterial,
  useDeleteMaterial,
  useArchiveMaterial,
  useRestoreMaterial,
} from '../hooks/useMaterialsMutations';
import {
  createMaterial,
  updateMaterial,
  patchMaterial,
  deleteMaterial,
  archiveMaterial,
  restoreMaterial,
  ApiError,
} from '@memo/api-client';
import type { MaterialCreate, MaterialUpdate, DependencyNode } from '@memo/api-client';

const mockCreateMaterial = vi.mocked(createMaterial);
const mockUpdateMaterial = vi.mocked(updateMaterial);
const mockPatchMaterial = vi.mocked(patchMaterial);
const mockDeleteMaterial = vi.mocked(deleteMaterial);
const mockArchiveMaterial = vi.mocked(archiveMaterial);
const mockRestoreMaterial = vi.mocked(restoreMaterial);

const materialResponse = {
  id: 'mat-1', title: 'Глина', description: '', archived: false,
  used_in_services_count: 0,
  created_at: '', updated_at: '',
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

describe('useMaterialsMutations', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  describe('useCreateMaterial', () => {
    it('calls createMaterial with the provided data', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockCreateMaterial.mockResolvedValue(materialResponse);

      const { result } = renderHook(() => useCreateMaterial(), { wrapper });

      const payload: MaterialCreate = { title: 'Глина', description: '' };

      await act(async () => {
        await result.current.mutateAsync(payload);
      });

      expect(mockCreateMaterial).toHaveBeenCalledWith(payload);
    });

    it('invalidates the materials query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockCreateMaterial.mockResolvedValue(materialResponse);

      const { result } = renderHook(() => useCreateMaterial(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ title: 'Глина', description: '' });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['materials'] });
    });
  });

  describe('useUpdateMaterial', () => {
    it('calls updateMaterial with id and data', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockUpdateMaterial.mockResolvedValue({ ...materialResponse, title: 'Глина 2' });

      const { result } = renderHook(() => useUpdateMaterial(), { wrapper });

      // Canonical PUT (GH #178): full typed MaterialUpdate — every field listed.
      // is_active is gone from Update (#207): archive/restore is via POST endpoints.
      const payload: MaterialUpdate = {
        title: 'Глина 2',
        description: '',
      };

      await act(async () => {
        await result.current.mutateAsync({ id: 'mat-1', data: payload });
      });

      expect(mockUpdateMaterial).toHaveBeenCalledWith('mat-1', payload);
    });
  });

  describe('usePatchMaterial', () => {
    it('calls patchMaterial with id and partial data', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockPatchMaterial.mockResolvedValue({ ...materialResponse, title: 'Patched' });

      const { result } = renderHook(() => usePatchMaterial(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'mat-1', data: { title: 'Patched' } });
      });

      expect(mockPatchMaterial).toHaveBeenCalledWith('mat-1', { title: 'Patched' });
      expect(mockUpdateMaterial).not.toHaveBeenCalled();
    });

    it('invalidates the materials query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockPatchMaterial.mockResolvedValue({ ...materialResponse, title: 'Patched' });

      const { result } = renderHook(() => usePatchMaterial(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'mat-1', data: { title: 'Patched' } });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['materials'] });
    });
  });

  describe('useDeleteMaterial', () => {
    it('calls deleteMaterial with the provided id', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockDeleteMaterial.mockResolvedValue(undefined);

      const { result } = renderHook(() => useDeleteMaterial(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('mat-1');
      });

      expect(mockDeleteMaterial).toHaveBeenCalledWith('mat-1');
    });

    it('invalidates the materials query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockDeleteMaterial.mockResolvedValue(undefined);

      const { result } = renderHook(() => useDeleteMaterial(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('mat-1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['materials'] });
    });

    it('exposes the dependency tree if the dry-run DELETE ever fails with 409', async () => {
      // Material has zero FK deps (§4 matrix) so 409 cannot happen today —
      // the hook still keeps the uniform 409-aware shape for all entities.
      const { wrapper } = createQueryClientWrapper();
      const deps: DependencyNode[] = [];
      mockDeleteMaterial.mockRejectedValue(new ApiError(409, 'has_dependencies', undefined, deps));

      const { result } = renderHook(() => useDeleteMaterial(), { wrapper });

      await act(async () => {
        await expect(result.current.mutateAsync('mat-1')).rejects.toThrow(ApiError);
      });

      expect(result.current.dependencies).toEqual(deps);
    });
  });

  describe('useArchiveMaterial', () => {
    it('calls archiveMaterial with the provided id', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockArchiveMaterial.mockResolvedValue({ ...materialResponse, archived: true });

      const { result } = renderHook(() => useArchiveMaterial(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('mat-1');
      });

      expect(mockArchiveMaterial).toHaveBeenCalledWith('mat-1');
    });

    it('invalidates the materials query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockArchiveMaterial.mockResolvedValue({ ...materialResponse, archived: true });

      const { result } = renderHook(() => useArchiveMaterial(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('mat-1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['materials'] });
    });
  });

  describe('useRestoreMaterial', () => {
    it('calls restoreMaterial with the provided id', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockRestoreMaterial.mockResolvedValue({ ...materialResponse, archived: false });

      const { result } = renderHook(() => useRestoreMaterial(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('mat-1');
      });

      expect(mockRestoreMaterial).toHaveBeenCalledWith('mat-1');
    });

    it('invalidates the materials query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockRestoreMaterial.mockResolvedValue({ ...materialResponse, archived: false });

      const { result } = renderHook(() => useRestoreMaterial(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('mat-1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['materials'] });
    });
  });
});
