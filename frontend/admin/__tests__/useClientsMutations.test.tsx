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
    dryRunDeleteClient: vi.fn(),
    resolveDeleteClient: vi.fn(),
    archiveClient: vi.fn(),
    restoreClient: vi.fn(),
  };
});

const mockEnqueuePendingAction = vi.fn();
vi.mock('@/contexts/PendingActionsContext', () => ({
  usePendingActions: () => ({ enqueuePendingAction: mockEnqueuePendingAction }),
}));

const mockShowToast = vi.fn();
vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({ showToast: mockShowToast }),
}));

import {
  useCreateClient,
  useUpdateClient,
  useDeleteClient,
  useArchiveClient,
  useRestoreClient,
} from '../hooks/useClientsMutations';
import {
  createClient,
  updateClient,
  patchClient,
  dryRunDeleteClient,
  resolveDeleteClient,
  archiveClient,
  restoreClient,
  ApiError,
} from '@memo/api-client';
import type { ClientUpdate, DependencyNode } from '@memo/api-client';

const mockCreateClient = vi.mocked(createClient);
const mockUpdateClient = vi.mocked(updateClient);
const mockPatchClient = vi.mocked(patchClient);
const mockDryRun = vi.mocked(dryRunDeleteClient);
const mockResolveDeleteClient = vi.mocked(resolveDeleteClient);
const mockArchiveClient = vi.mocked(archiveClient);
const mockRestoreClient = vi.mocked(restoreClient);

const clientResponse = {
  id: 'c1', name: 'Анна Иванова', phone: '+7 (900) 123-45-67', email: null,
  channel: 'telegram', created_at: '', updated_at: '', archived: false,
};

const clientWithStats = {
  ...clientResponse,
  records_count: 5, last_record: null, total_paid: 17500, missed_records: 1,
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
  beforeEach(() => {
    vi.clearAllMocks();
    mockDryRun.mockResolvedValue(undefined);
    mockResolveDeleteClient.mockResolvedValue(undefined);
  });
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


  describe('useDeleteClient — hook surface (deferred conveyor)', () => {
    it('removeClient always dry-runs first; 204 → optimistic + enqueue (surface)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData(['clients'], [clientWithStats]);
      const { result } = renderHook(() => useDeleteClient(), { wrapper });

      expect(result.current.removeClient).toBeTypeOf('function');
      expect(result.current.removeClientResolved).toBeTypeOf('function');
      expect(result.current.isPending).toBe(false);

      await act(async () => {
        await result.current.removeClient(clientWithStats);
      });

      expect(mockDryRun).toHaveBeenCalledWith('c1');
      expect(mockResolveDeleteClient).not.toHaveBeenCalled();
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);
    });

    it('409 + dependency tree rejects upward so the call site opens the dialog', async () => {
      const deps: DependencyNode[] = [
        { entity: 'records', auto: false, relation: 'Запись', count: 47, allowed_actions: ['nullify'], message: null },
      ];
      mockDryRun.mockRejectedValue(new ApiError(409, 'has_dependencies', undefined, deps));

      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useDeleteClient(), { wrapper });

      await act(async () => {
        await expect(result.current.removeClient(clientWithStats)).rejects.toThrow(ApiError);
      });

      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(mockResolveDeleteClient).not.toHaveBeenCalled();
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
});
