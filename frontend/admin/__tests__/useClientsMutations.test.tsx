import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    createClient: vi.fn(),
    updateClient: vi.fn(),
    patchClient: vi.fn(),
    deleteClient: vi.fn(),
    archiveClient: vi.fn(),
    restoreClient: vi.fn(),
    resolveDeleteClient: vi.fn(),
  };
});

import {
  useCreateClient,
  useUpdateClient,
  usePatchClient,
  useDeleteClient,
  useArchiveClient,
  useRestoreClient,
  useResolveDeleteClient,
} from '../hooks/useClientsMutations';
import {
  createClient,
  updateClient,
  patchClient,
  deleteClient,
  archiveClient,
  restoreClient,
  resolveDeleteClient,
  ApiError,
} from '@memo/api-client';
import type { ClientUpdate, DependencyNode } from '@memo/api-client';

const mockCreateClient = vi.mocked(createClient);
const mockUpdateClient = vi.mocked(updateClient);
const mockPatchClient = vi.mocked(patchClient);
const mockDeleteClient = vi.mocked(deleteClient);
const mockArchiveClient = vi.mocked(archiveClient);
const mockRestoreClient = vi.mocked(restoreClient);
const mockResolveDeleteClient = vi.mocked(resolveDeleteClient);

const clientResponse = {
  id: 'c1', name: 'Анна Иванова', phone: '+7 (900) 123-45-67', email: null,
  channel: 'telegram', created_at: '', updated_at: '', archived: false,
};

const updatePayload: ClientUpdate = {
  name: 'Анна Иванова', phone: '+7 (900) 123-45-67', email: null, channel: 'telegram',
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

describe('useClientsMutations', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  describe('useCreateClient', () => {
    it('calls createClient with the provided data', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockCreateClient.mockResolvedValue(clientResponse);

      const { result } = renderHook(() => useCreateClient(), { wrapper });
      const payload = { name: 'Анна Иванова', phone: '+7 (900) 123-45-67' };

      await act(async () => {
        await result.current.mutateAsync(payload);
      });

      expect(mockCreateClient).toHaveBeenCalledWith(payload);
    });

    it('invalidates BOTH clients AND records caches on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockCreateClient.mockResolvedValue(clientResponse);

      const { result } = renderHook(() => useCreateClient(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ name: 'Анна Иванова' });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clients'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
    });
  });

  describe('useUpdateClient', () => {
    it('calls updateClient with id and data', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockUpdateClient.mockResolvedValue(clientResponse);

      const { result } = renderHook(() => useUpdateClient(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'c1', data: updatePayload });
      });

      expect(mockUpdateClient).toHaveBeenCalledWith('c1', updatePayload);
    });

    it('invalidates BOTH clients AND records caches on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockUpdateClient.mockResolvedValue(clientResponse);

      const { result } = renderHook(() => useUpdateClient(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'c1', data: updatePayload });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clients'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
    });
  });

  describe('usePatchClient', () => {
    it('calls patchClient with id and partial data', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockPatchClient.mockResolvedValue({ ...clientResponse, name: 'Patched' });

      const { result } = renderHook(() => usePatchClient(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'c1', data: { name: 'Patched' } });
      });

      expect(mockPatchClient).toHaveBeenCalledWith('c1', { name: 'Patched' });
      expect(mockUpdateClient).not.toHaveBeenCalled();
    });

    it('invalidates BOTH clients AND records caches on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockPatchClient.mockResolvedValue({ ...clientResponse, name: 'Patched' });

      const { result } = renderHook(() => usePatchClient(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'c1', data: { name: 'Patched' } });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clients'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
    });
  });

  describe('useDeleteClient', () => {
    it('calls deleteClient with the provided id', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockDeleteClient.mockResolvedValue(undefined as never);

      const { result } = renderHook(() => useDeleteClient(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('c1');
      });

      expect(mockDeleteClient).toHaveBeenCalledWith('c1');
    });

    it('invalidates BOTH clients AND records caches on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockDeleteClient.mockResolvedValue(undefined as never);

      const { result } = renderHook(() => useDeleteClient(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('c1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clients'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
    });

    it('exposes the dependency tree when the dry-run DELETE fails with 409', async () => {
      const { wrapper } = createQueryClientWrapper();
      const deps: DependencyNode[] = [
        { entity: 'records', relation: 'Запись', count: 47, allowed_actions: ['nullify'], message: null },
      ];
      mockDeleteClient.mockRejectedValue(new ApiError(409, 'has_dependencies', undefined, deps));

      const { result } = renderHook(() => useDeleteClient(), { wrapper });

      await act(async () => {
        await expect(result.current.mutateAsync('c1')).rejects.toThrow(ApiError);
      });

      expect(result.current.dependencies).toEqual(deps);
    });

    it('clears a prior dependency tree on the next attempt (onMutate)', async () => {
      const { wrapper } = createQueryClientWrapper();
      const deps: DependencyNode[] = [
        { entity: 'records', relation: 'Запись', count: 47, allowed_actions: ['nullify'], message: null },
      ];
      // First attempt: 409 parks the tree.
      mockDeleteClient.mockRejectedValueOnce(new ApiError(409, 'has_dependencies', undefined, deps));

      const { result } = renderHook(() => useDeleteClient(), { wrapper });

      await act(async () => {
        await expect(result.current.mutateAsync('c1')).rejects.toThrow(ApiError);
      });
      expect(result.current.dependencies).toEqual(deps);

      // Second attempt: a non-409 rejection must clear the stale tree.
      mockDeleteClient.mockRejectedValueOnce(new ApiError(404, 'Client not found', 'NOT_FOUND'));
      await act(async () => {
        await expect(result.current.mutateAsync('c1')).rejects.toThrow(ApiError);
      });
      expect(result.current.dependencies).toBeNull();
    });

    it('keeps dependencies null for non-409 errors', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockDeleteClient.mockRejectedValue(new ApiError(404, 'Client not found', 'NOT_FOUND'));

      const { result } = renderHook(() => useDeleteClient(), { wrapper });

      await act(async () => {
        await expect(result.current.mutateAsync('c1')).rejects.toThrow(ApiError);
      });

      expect(result.current.dependencies).toBeNull();
    });
  });

  describe('useArchiveClient', () => {
    it('calls archiveClient with the provided id', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockArchiveClient.mockResolvedValue({ ...clientResponse, archived: true });

      const { result } = renderHook(() => useArchiveClient(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('c1');
      });

      expect(mockArchiveClient).toHaveBeenCalledWith('c1');
    });

    it('invalidates BOTH clients AND records caches on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockArchiveClient.mockResolvedValue({ ...clientResponse, archived: true });

      const { result } = renderHook(() => useArchiveClient(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('c1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clients'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
    });
  });

  describe('useRestoreClient', () => {
    it('calls restoreClient with the provided id', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockRestoreClient.mockResolvedValue({ ...clientResponse, archived: false });

      const { result } = renderHook(() => useRestoreClient(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('c1');
      });

      expect(mockRestoreClient).toHaveBeenCalledWith('c1');
    });

    it('invalidates BOTH clients AND records caches on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockRestoreClient.mockResolvedValue({ ...clientResponse, archived: false });

      const { result } = renderHook(() => useRestoreClient(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('c1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clients'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
    });
  });

  describe('useResolveDeleteClient', () => {
    it('calls resolveDeleteClient with id and resolutions', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockResolveDeleteClient.mockResolvedValue(undefined);

      const { result } = renderHook(() => useResolveDeleteClient(), { wrapper });
      const resolutions = { records: 'nullify', visitors: 'cascade' };

      await act(async () => {
        await result.current.mutateAsync({ id: 'c1', resolutions });
      });

      expect(mockResolveDeleteClient).toHaveBeenCalledWith('c1', resolutions);
    });

    it('invalidates BOTH clients AND records caches on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockResolveDeleteClient.mockResolvedValue(undefined);

      const { result } = renderHook(() => useResolveDeleteClient(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'c1', resolutions: {} });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clients'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
    });
  });
});
