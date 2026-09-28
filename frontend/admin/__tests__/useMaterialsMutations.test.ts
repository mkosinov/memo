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
    dryRunDeleteMaterial: vi.fn(),
    resolveDeleteMaterial: vi.fn(),
    archiveMaterial: vi.fn(),
    restoreMaterial: vi.fn(),
  };
});

// The deferred-delete conveyor needs the PendingActions + UI contexts —
// surface tests mock them (full branch matrix lives in
// useDeleteMaterial.test.ts).
const mockEnqueuePendingAction = vi.fn();
vi.mock('@/contexts/PendingActionsContext', () => ({
  usePendingActions: () => ({ enqueuePendingAction: mockEnqueuePendingAction }),
}));

const mockShowToast = vi.fn();
vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({ showToast: mockShowToast }),
}));

import {
  useCreateMaterial,
  useUpdateMaterial,
  useDeleteMaterial,
  useArchiveMaterial,
  useRestoreMaterial,
} from '../hooks/useMaterialsMutations';
import {
  createMaterial,
  updateMaterial,
  patchMaterial,
  dryRunDeleteMaterial,
  resolveDeleteMaterial,
  archiveMaterial,
  restoreMaterial,
  ApiError,
} from '@memo/api-client';
import type { MaterialCreate, MaterialUpdate, DependencyNode } from '@memo/api-client';

const mockCreateMaterial = vi.mocked(createMaterial);
const mockUpdateMaterial = vi.mocked(updateMaterial);
const mockPatchMaterial = vi.mocked(patchMaterial);
const mockDryRun = vi.mocked(dryRunDeleteMaterial);
const mockResolveDeleteMaterial = vi.mocked(resolveDeleteMaterial);
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
  beforeEach(() => {
    vi.clearAllMocks();
    mockDryRun.mockResolvedValue(undefined);
    mockResolveDeleteMaterial.mockResolvedValue(undefined);
  });
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


  describe('useDeleteMaterial — hook surface (deferred conveyor)', () => {
    it('removeMaterial always dry-runs first; 204 → optimistic + enqueue (surface)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData(['materials'], [materialResponse]);
      const { result } = renderHook(() => useDeleteMaterial(), { wrapper });

      expect(result.current.removeMaterial).toBeTypeOf('function');
      expect(result.current.removeMaterialResolved).toBeTypeOf('function');
      expect(result.current.isPending).toBe(false);

      await act(async () => {
        await result.current.removeMaterial(materialResponse);
      });

      expect(mockDryRun).toHaveBeenCalledWith('mat-1');
      expect(mockResolveDeleteMaterial).not.toHaveBeenCalled();
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);
    });

    it('409 + dependency tree rejects upward so the call site opens the dialog', async () => {
      // Linked material (GH #223): the single auto service_materials node.
      const deps: DependencyNode[] = [
        { entity: 'service_materials', auto: true, relation: 'Услуга', count: 1, allowed_actions: ['cascade'] },
      ];
      mockDryRun.mockRejectedValue(new ApiError(409, 'has_dependencies', undefined, deps));

      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useDeleteMaterial(), { wrapper });

      await act(async () => {
        await expect(result.current.removeMaterial(materialResponse)).rejects.toThrow(ApiError);
      });

      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(mockResolveDeleteMaterial).not.toHaveBeenCalled();
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
