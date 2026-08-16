import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    createLocation: vi.fn(),
    updateLocation: vi.fn(),
    patchLocation: vi.fn(),
    deleteLocation: vi.fn(),
    archiveLocation: vi.fn(),
    restoreLocation: vi.fn(),
  };
});

import {
  useCreateLocation,
  useUpdateLocation,
  usePatchLocation,
  useDeleteLocation,
  useArchiveLocation,
  useRestoreLocation,
} from '../hooks/useLocationsMutations';
import {
  createLocation,
  updateLocation,
  patchLocation,
  deleteLocation,
  archiveLocation,
  restoreLocation,
  ApiError,
} from '@memo/api-client';
import type { LocationCreate, LocationUpdate, DependencyNode } from '@memo/api-client';

const mockCreateLocation = vi.mocked(createLocation);
const mockUpdateLocation = vi.mocked(updateLocation);
const mockPatchLocation = vi.mocked(patchLocation);
const mockDeleteLocation = vi.mocked(deleteLocation);
const mockArchiveLocation = vi.mocked(archiveLocation);
const mockRestoreLocation = vi.mocked(restoreLocation);

const locationCreatePayload: LocationCreate = {
  name: 'Studio', short_title: 'Studio', capacity: 10, address: '', description: '',
  yandex_map_url: '', review_url: '', record_info: '', image_url: '',
  location_hint: '', tag_ids: [],
};

const locationResponse = {
  id: 'loc-1', name: 'Studio', address: 'Main St', description: null,
  capacity: 10, yandex_map_url: null, review_url: null, record_info: null,
  image_url: null, archived: false, created_at: '', updated_at: '',
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
  beforeEach(() => vi.clearAllMocks());
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

      // Canonical PUT (GH #178): full typed LocationUpdate — every field listed.
      // is_active is gone from Update (#207): archive/restore is via POST endpoints.
      const payload: { id: string; data: LocationUpdate } = {
        id: 'loc-1',
        data: {
          name: 'Updated',
          short_title: '',
          address: '',
          description: '',
          capacity: 10,
          yandex_map_url: '',
          review_url: '',
          record_info: '',
          image_url: '',
          location_hint: '',
          tag_ids: [],
        },
      };

      await act(async () => {
        await result.current.mutateAsync(payload);
      });

      expect(mockUpdateLocation).toHaveBeenCalledWith('loc-1', payload.data);
    });

    it('invalidates the locations query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockUpdateLocation.mockResolvedValue({ ...locationResponse, name: 'Updated' });

      const { result } = renderHook(() => useUpdateLocation(), { wrapper });

      const payload: LocationUpdate = {
        name: 'Updated',
        short_title: '',
        address: '',
        description: '',
        capacity: 10,
        yandex_map_url: '',
        review_url: '',
        record_info: '',
        image_url: '',
        location_hint: '',
        tag_ids: [],
      };

      await act(async () => {
        await result.current.mutateAsync({ id: 'loc-1', data: payload });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['locations'] });
    });
  });

  describe('usePatchLocation', () => {
    it('calls patchLocation with id and partial data', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockPatchLocation.mockResolvedValue({ ...locationResponse, name: 'Patched' });

      const { result } = renderHook(() => usePatchLocation(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'loc-1', data: { name: 'Patched' } });
      });

      expect(mockPatchLocation).toHaveBeenCalledWith('loc-1', { name: 'Patched' });
      expect(mockUpdateLocation).not.toHaveBeenCalled();
    });

    it('invalidates the locations query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockPatchLocation.mockResolvedValue({ ...locationResponse, name: 'Patched' });

      const { result } = renderHook(() => usePatchLocation(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'loc-1', data: { name: 'Patched' } });
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

    it('invalidates locations AND records caches on success (cross-invalidation)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockDeleteLocation.mockResolvedValue(undefined as never);

      const { result } = renderHook(() => useDeleteLocation(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('loc-1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['locations'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
    });

    it('exposes the dependency tree when the dry-run DELETE fails with 409', async () => {
      const { wrapper } = createQueryClientWrapper();
      const deps: DependencyNode[] = [
        { entity: 'activities', relation: 'Активность', count: 3, allowed_actions: [], message: 'Удалите активности вручную или архивируйте' },
        { entity: 'location_tags', relation: 'Тег', count: 2, allowed_actions: ['cascade'] },
      ];
      mockDeleteLocation.mockRejectedValue(new ApiError(409, 'has_dependencies', undefined, deps));

      const { result } = renderHook(() => useDeleteLocation(), { wrapper });

      await act(async () => {
        await expect(result.current.mutateAsync('loc-1')).rejects.toThrow(ApiError);
      });

      expect(result.current.dependencies).toEqual(deps);
    });

    it('keeps dependencies null for non-409 errors', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockDeleteLocation.mockRejectedValue(new ApiError(404, 'Location not found', 'LOCATION_NOT_FOUND'));

      const { result } = renderHook(() => useDeleteLocation(), { wrapper });

      await act(async () => {
        await expect(result.current.mutateAsync('loc-1')).rejects.toThrow(ApiError);
      });

      expect(result.current.dependencies).toBeNull();
    });
  });

  describe('useArchiveLocation', () => {
    it('calls archiveLocation with the provided id', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockArchiveLocation.mockResolvedValue({ ...locationResponse, archived: true });

      const { result } = renderHook(() => useArchiveLocation(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('loc-1');
      });

      expect(mockArchiveLocation).toHaveBeenCalledWith('loc-1');
    });

    it('invalidates the locations query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockArchiveLocation.mockResolvedValue({ ...locationResponse, archived: true });

      const { result } = renderHook(() => useArchiveLocation(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('loc-1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['locations'] });
    });
  });

  describe('useRestoreLocation', () => {
    it('calls restoreLocation with the provided id', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockRestoreLocation.mockResolvedValue({ ...locationResponse, archived: false });

      const { result } = renderHook(() => useRestoreLocation(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('loc-1');
      });

      expect(mockRestoreLocation).toHaveBeenCalledWith('loc-1');
    });

    it('invalidates the locations query cache on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockRestoreLocation.mockResolvedValue({ ...locationResponse, archived: false });

      const { result } = renderHook(() => useRestoreLocation(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('loc-1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['locations'] });
    });
  });
});
