import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@memo/api-client', () => ({
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  deleteLocation: vi.fn(),
}));

import {
  useCreateLocation,
  useUpdateLocation,
  useDeleteLocation,
} from '../hooks/useLocationsMutations';
import {
  createLocation,
  updateLocation,
  deleteLocation,
} from '@memo/api-client';
import type { LocationCreate, LocationUpdate } from '@memo/api-client';

const mockCreateLocation = vi.mocked(createLocation);
const mockUpdateLocation = vi.mocked(updateLocation);
const mockDeleteLocation = vi.mocked(deleteLocation);

const locationCreatePayload: LocationCreate = {
  name: 'Studio', short_title: 'Studio', capacity: 10, address: '', description: '',
  yandex_map_url: '', review_url: '', record_info: '', image_url: '',
  location_hint: '', tag_ids: [],
};

const locationResponse = {
  id: 'loc-1', name: 'Studio', address: 'Main St', description: null,
  capacity: 10, yandex_map_url: null, review_url: null, record_info: null,
  image_url: null, is_active: true, created_at: '', updated_at: '',
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

describe('useLocationsMutations', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('useCreateLocation', () => {
    it('calls createLocation with the provided data', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockCreateLocation.mockResolvedValue(locationResponse);

      const { result } = renderHook(() => useCreateLocation(), { wrapper });

      const payload = locationCreatePayload;

      await act(async () => {
        await result.current.mutateAsync(payload);
      });

      expect(mockCreateLocation).toHaveBeenCalledWith(payload);
    });

    it('invalidates the locations query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockCreateLocation.mockResolvedValue(locationResponse);

      const { result } = renderHook(() => useCreateLocation(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync(locationCreatePayload);
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['locations'] });
    });
  });

  describe('useUpdateLocation', () => {
    it('calls updateLocation with id and data', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockUpdateLocation.mockResolvedValue({ ...locationResponse, name: 'Updated' });

      const { result } = renderHook(() => useUpdateLocation(), { wrapper });

      const payload: { id: string; data: LocationUpdate } = {
        id: 'loc-1',
        data: { name: 'Updated' },
      };

      await act(async () => {
        await result.current.mutateAsync(payload);
      });

      expect(mockUpdateLocation).toHaveBeenCalledWith('loc-1', { name: 'Updated' });
    });

    it('invalidates the locations query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockUpdateLocation.mockResolvedValue({ ...locationResponse, name: 'Updated' });

      const { result } = renderHook(() => useUpdateLocation(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'loc-1', data: { name: 'Updated' } });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['locations'] });
    });
  });

  describe('useDeleteLocation', () => {
    it('calls deleteLocation with the provided id', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockDeleteLocation.mockResolvedValue(undefined as never);

      const { result } = renderHook(() => useDeleteLocation(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('loc-1');
      });

      expect(mockDeleteLocation).toHaveBeenCalledWith('loc-1');
    });

    it('invalidates the locations query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockDeleteLocation.mockResolvedValue(undefined as never);

      const { result } = renderHook(() => useDeleteLocation(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('loc-1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['locations'] });
    });
  });
});
