import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@memo/api-client', () => ({
  createService: vi.fn(),
  updateService: vi.fn(),
  patchService: vi.fn(),
  deleteService: vi.fn(),
}));

import {
  useCreateService,
  useUpdateService,
  usePatchService,
  useDeleteService,
} from '../hooks/useServicesMutations';
import {
  createService,
  updateService,
  patchService,
  deleteService,
} from '@memo/api-client';
import type { ServiceCreate, ServiceUpdate } from '@memo/api-client';

const mockCreateService = vi.mocked(createService);
const mockUpdateService = vi.mocked(updateService);
const mockPatchService = vi.mocked(patchService);
const mockDeleteService = vi.mocked(deleteService);

const serviceResponse = {
  id: 's1', title: 'Test', description: '', image_url: '', specialty: '',
  min_age: 0, max_age: 18, duration: 180, record_info: '',
  tariffs: [], tags: [], is_active: true, created_at: '', updated_at: '',
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
      mockCreateService.mockResolvedValue({ id: 'new-1', title: 'Test', description: '', image_url: '', specialty: '', min_age: 0, max_age: 18, duration: 180, record_info: '', tariffs: [], tags: [], is_active: true, created_at: '', updated_at: '' });

      const { result } = renderHook(() => useCreateService(), { wrapper });

      const payload: ServiceCreate = {
        title: 'Test', duration: 180, description: '', image_url: '',
        specialty: '', min_age: 0, max_age: 18, record_info: '',
        material_hint: '', tariffs: [], tag_ids: [],
      };

      await act(async () => {
        await result.current.mutateAsync(payload);
      });

      expect(mockCreateService).toHaveBeenCalledWith(payload);
    });

    it('invalidates the services query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockCreateService.mockResolvedValue({ id: 'new-1', title: 'Test', description: '', image_url: '', specialty: '', min_age: 0, max_age: 18, duration: 180, record_info: '', tariffs: [], tags: [], is_active: true, created_at: '', updated_at: '' });

      const { result } = renderHook(() => useCreateService(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({
          title: 'Test', duration: 180, description: '', image_url: '',
          specialty: '', min_age: 0, max_age: 18, record_info: '',
          material_hint: '', tariffs: [], tag_ids: [],
        });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['services'] });
    });
  });

  describe('useUpdateService', () => {
    it('calls updateService with id and data', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockUpdateService.mockResolvedValue({ id: 's1', title: 'Updated', description: '', image_url: '', specialty: '', min_age: 0, max_age: 18, duration: 180, record_info: '', tariffs: [], tags: [], is_active: true, created_at: '', updated_at: '' });

      const { result } = renderHook(() => useUpdateService(), { wrapper });

      // Canonical PUT (GH #178): full typed ServiceUpdate — every field listed.
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
          material_hint: '',
          tariffs: [],
          tag_ids: [],
          is_active: true,
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
      mockUpdateService.mockResolvedValue({ id: 's1', title: 'Updated', description: '', image_url: '', specialty: '', min_age: 0, max_age: 18, duration: 180, record_info: '', tariffs: [], tags: [], is_active: true, created_at: '', updated_at: '' });

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
        material_hint: '',
        tariffs: [],
        tag_ids: [],
        is_active: true,
      };

      await act(async () => {
        await result.current.mutateAsync({ id: 's1', data: payload });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['services'] });
    });
  });

  describe('usePatchService', () => {
    it('calls patchService with id and partial data (archive toggle)', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockPatchService.mockResolvedValue({ ...serviceResponse, is_active: false });

      const { result } = renderHook(() => usePatchService(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 's1', data: { is_active: false } });
      });

      expect(mockPatchService).toHaveBeenCalledWith('s1', { is_active: false });
      expect(mockUpdateService).not.toHaveBeenCalled();
    });

    it('invalidates the services query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockPatchService.mockResolvedValue({ ...serviceResponse, is_active: false });

      const { result } = renderHook(() => usePatchService(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 's1', data: { is_active: false } });
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

    it('invalidates the services query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockDeleteService.mockResolvedValue(undefined as never);

      const { result } = renderHook(() => useDeleteService(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('s1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['services'] });
    });
  });
});
