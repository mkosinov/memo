import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@memo/api-client', () => ({
  createMaster: vi.fn(),
  updateMaster: vi.fn(),
  patchMaster: vi.fn(),
  deleteMaster: vi.fn(),
}));

import {
  useCreateMaster,
  useUpdateMaster,
  usePatchMaster,
  useDeleteMaster,
} from '../hooks/useMastersMutations';
import {
  createMaster,
  updateMaster,
  patchMaster,
  deleteMaster,
} from '@memo/api-client';
import type { MasterCreate, MasterUpdate } from '@memo/api-client';

const mockCreateMaster = vi.mocked(createMaster);
const mockUpdateMaster = vi.mocked(updateMaster);
const mockPatchMaster = vi.mocked(patchMaster);
const mockDeleteMaster = vi.mocked(deleteMaster);

const masterResponse = {
  id: 'm-1', first_name: 'Иван', last_name: 'Иванов', color: '#004D56',
  position: 'мастер', specialty: 'живопись', avatar_url: null,
  is_active: true, created_at: '', updated_at: '',
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
      const payload: MasterUpdate = {
        first_name: 'Пётр',
        last_name: 'Иванов',
        color: '#AABBCC',
        position: 'мастер',
        specialty: 'живопись',
        avatar_url: '',
        is_active: true,
      };

      await act(async () => {
        await result.current.mutateAsync({ id: 'm-1', data: payload });
      });

      expect(mockUpdateMaster).toHaveBeenCalledWith('m-1', payload);
    });
  });

  describe('usePatchMaster', () => {
    it('calls patchMaster with id and partial data (archive toggle)', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockPatchMaster.mockResolvedValue({ ...masterResponse, is_active: false });

      const { result } = renderHook(() => usePatchMaster(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'm-1', data: { is_active: false } });
      });

      expect(mockPatchMaster).toHaveBeenCalledWith('m-1', { is_active: false });
      expect(mockUpdateMaster).not.toHaveBeenCalled();
    });

    it('invalidates the masters query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockPatchMaster.mockResolvedValue({ ...masterResponse, is_active: false });

      const { result } = renderHook(() => usePatchMaster(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'm-1', data: { is_active: false } });
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
  });
});
