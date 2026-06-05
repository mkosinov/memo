import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@memo/api-client', () => ({
  createService: vi.fn(),
  updateService: vi.fn(),
  deleteService: vi.fn(),
}));

import {
  useCreateService,
  useUpdateService,
  useDeleteService,
} from '../hooks/useServicesMutations';
import {
  createService,
  updateService,
  deleteService,
} from '@memo/api-client';
import type { ServiceCreate, ServiceUpdate } from '@memo/api-client';

const mockCreateService = vi.mocked(createService);
const mockUpdateService = vi.mocked(updateService);
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

      const payload: { id: string; data: ServiceUpdate } = {
        id: 's1',
        data: { title: 'Updated' },
      };

      await act(async () => {
        await result.current.mutateAsync(payload);
      });

      expect(mockUpdateService).toHaveBeenCalledWith('s1', { title: 'Updated' });
    });

    it('invalidates the services query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockUpdateService.mockResolvedValue({ id: 's1', title: 'Updated', description: '', image_url: '', specialty: '', min_age: 0, max_age: 18, duration: 180, record_info: '', tariffs: [], tags: [], is_active: true, created_at: '', updated_at: '' });

      const { result } = renderHook(() => useUpdateService(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 's1', data: { title: 'Updated' } });
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
