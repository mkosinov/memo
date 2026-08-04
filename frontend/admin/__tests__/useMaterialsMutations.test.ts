import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@memo/api-client', () => ({
  createMaterial: vi.fn(),
  updateMaterial: vi.fn(),
  patchMaterial: vi.fn(),
  deleteMaterial: vi.fn(),
}));

import {
  useCreateMaterial,
  useUpdateMaterial,
  usePatchMaterial,
  useDeleteMaterial,
} from '../hooks/useMaterialsMutations';
import {
  createMaterial,
  updateMaterial,
  patchMaterial,
  deleteMaterial,
} from '@memo/api-client';
import type { MaterialCreate, MaterialUpdate } from '@memo/api-client';

const mockCreateMaterial = vi.mocked(createMaterial);
const mockUpdateMaterial = vi.mocked(updateMaterial);
const mockPatchMaterial = vi.mocked(patchMaterial);
const mockDeleteMaterial = vi.mocked(deleteMaterial);

const materialResponse = {
  id: 'mat-1', title: 'Глина', description: '', is_active: true,
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
      const payload: MaterialUpdate = {
        title: 'Глина 2',
        description: '',
        is_active: true,
      };

      await act(async () => {
        await result.current.mutateAsync({ id: 'mat-1', data: payload });
      });

      expect(mockUpdateMaterial).toHaveBeenCalledWith('mat-1', payload);
    });
  });

  describe('usePatchMaterial', () => {
    it('calls patchMaterial with id and partial data (archive toggle)', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockPatchMaterial.mockResolvedValue({ ...materialResponse, is_active: false });

      const { result } = renderHook(() => usePatchMaterial(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'mat-1', data: { is_active: false } });
      });

      expect(mockPatchMaterial).toHaveBeenCalledWith('mat-1', { is_active: false });
      expect(mockUpdateMaterial).not.toHaveBeenCalled();
    });

    it('invalidates the materials query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockPatchMaterial.mockResolvedValue({ ...materialResponse, is_active: false });

      const { result } = renderHook(() => usePatchMaterial(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'mat-1', data: { is_active: false } });
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
  });
});
