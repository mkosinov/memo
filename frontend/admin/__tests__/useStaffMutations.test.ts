/**
 * useStaffMutations — GH #266 staff directory mutation family + GH #345
 * Task 6 deferred delete.
 *
 * Every create/update/patch/archive/restore mutation calls its api-client
 * endpoint and invalidates the ['staff'] family, which (via
 * INVALIDATION_MAP) also refreshes ['masters'] (the read-only view is
 * staff ⨝ masters) and ['records'] (master_name/master_color come from
 * the join). Archive carries the D6 dismissal checkboxes in the body.
 *
 * The deferred-delete conveyor (dry-run → dialog → optimistic + enqueue →
 * commit; PendingActions, 5s ring, undo) is covered by the dedicated
 * `useDeleteStaff.test.ts` — here only the hook-surface contract is
 * asserted (return shape + preview-phase guard).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    createStaff: vi.fn(),
    updateStaff: vi.fn(),
    patchStaff: vi.fn(),
    dryRunDeleteStaff: vi.fn(),
    resolveDeleteStaff: vi.fn(),
    archiveStaff: vi.fn(),
    restoreStaff: vi.fn(),
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
  useCreateStaff,
  useUpdateStaff,
  usePatchStaff,
  useDeleteStaff,
  useArchiveStaff,
  useRestoreStaff,
} from '../hooks/useStaffMutations';
import {
  createStaff,
  updateStaff,
  patchStaff,
  dryRunDeleteStaff,
  resolveDeleteStaff,
  archiveStaff,
  restoreStaff,
  ApiError,
} from '@memo/api-client';
import type { StaffCreate, StaffUpdate, DependencyNode } from '@memo/api-client';

const mockCreateStaff = vi.mocked(createStaff);
const mockUpdateStaff = vi.mocked(updateStaff);
const mockPatchStaff = vi.mocked(patchStaff);
const mockDryRun = vi.mocked(dryRunDeleteStaff);
const mockResolveDeleteStaff = vi.mocked(resolveDeleteStaff);
const mockArchiveStaff = vi.mocked(archiveStaff);
const mockRestoreStaff = vi.mocked(restoreStaff);

const staffResponse = {
  id: 's-1', first_name: 'Иван', last_name: 'Иванов', avatar_url: null,
  sort_order: 0, master: null, position_ids: [], has_user: false,
  archived: false, created_at: '', updated_at: '',
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

describe('useStaffMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDryRun.mockResolvedValue(undefined);
    mockResolveDeleteStaff.mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  describe('useCreateStaff', () => {
    it('calls createStaff with the provided data', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockCreateStaff.mockResolvedValue(staffResponse);

      const { result } = renderHook(() => useCreateStaff(), { wrapper });

      const payload: StaffCreate = {
        first_name: 'Иван', last_name: 'Иванов', avatar_url: '',
        sort_order: 0, master: null, position_ids: [], create_user: false,
      };

      await act(async () => {
        await result.current.mutateAsync(payload);
      });

      expect(mockCreateStaff).toHaveBeenCalledWith(payload);
    });

    it('invalidates the staff family on success (→ masters + records via the map)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockCreateStaff.mockResolvedValue(staffResponse);

      const { result } = renderHook(() => useCreateStaff(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({
          first_name: 'Иван', last_name: 'Иванов', avatar_url: '',
          sort_order: 0, master: null, position_ids: [], create_user: false,
        });
      });

      // qk.staff prefix — covers the StaffContext paged list AND the bare
      // lookup key (same ['staff'] prefix).
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['staff'] });
      // The family map fans out: masters view rows change on staff writes.
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['masters'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
    });
  });

  describe('useUpdateStaff', () => {
    it('calls updateStaff with id and data', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockUpdateStaff.mockResolvedValue({ ...staffResponse, first_name: 'Пётр' });

      const { result } = renderHook(() => useUpdateStaff(), { wrapper });

      const payload: StaffUpdate = {
        first_name: 'Пётр',
        last_name: 'Иванов',
        avatar_url: '',
        sort_order: 0,
        master: { specialty: 'живопись', color: '#AABBCC' },
        position_ids: ['master'],
      };

      await act(async () => {
        await result.current.mutateAsync({ id: 's-1', data: payload });
      });

      expect(mockUpdateStaff).toHaveBeenCalledWith('s-1', payload);
    });
  });

  describe('usePatchStaff', () => {
    it('calls patchStaff with id and partial data', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockPatchStaff.mockResolvedValue(staffResponse);

      const { result } = renderHook(() => usePatchStaff(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 's-1', data: { first_name: 'Пётр' } });
      });

      expect(mockPatchStaff).toHaveBeenCalledWith('s-1', { first_name: 'Пётр' });
      expect(mockUpdateStaff).not.toHaveBeenCalled();
    });

    it('invalidates the staff family on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockPatchStaff.mockResolvedValue(staffResponse);

      const { result } = renderHook(() => usePatchStaff(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 's-1', data: { first_name: 'Пётр' } });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['staff'] });
    });
  });

  describe('useDeleteStaff — hook surface (deferred conveyor)', () => {
    it('removeStaff always dry-runs first; 204 → optimistic + enqueue (surface)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData(['staff'], [staffResponse]);
      const { result } = renderHook(() => useDeleteStaff(), { wrapper });

      expect(result.current.removeStaff).toBeTypeOf('function');
      expect(result.current.removeStaffResolved).toBeTypeOf('function');
      expect(result.current.isPending).toBe(false);

      await act(async () => {
        await result.current.removeStaff(staffResponse);
      });

      expect(mockDryRun).toHaveBeenCalledWith('s-1');
      expect(mockResolveDeleteStaff).not.toHaveBeenCalled();
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);
    });

    it('409 + dependency tree rejects upward so the call site opens the dialog', async () => {
      const deps: DependencyNode[] = [
        { entity: 'users', auto: true, relation: 'Пользователь', count: 1, allowed_actions: ['cascade'] },
        { entity: 'masters', auto: true, relation: 'Мастер', count: 1, allowed_actions: ['cascade'] },
      ];
      mockDryRun.mockRejectedValue(new ApiError(409, 'has_dependencies', undefined, deps));

      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useDeleteStaff(), { wrapper });

      await act(async () => {
        await expect(result.current.removeStaff(staffResponse)).rejects.toThrow(ApiError);
      });

      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(mockResolveDeleteStaff).not.toHaveBeenCalled();
    });
  });

  describe('useArchiveStaff', () => {
    it('calls archiveStaff with id and the D6 checkbox body', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockArchiveStaff.mockResolvedValue({ ...staffResponse, archived: true });

      const { result } = renderHook(() => useArchiveStaff(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 's-1', archive_master: false, archive_user: true });
      });

      expect(mockArchiveStaff).toHaveBeenCalledWith('s-1', { archive_master: false, archive_user: true });
    });

    it('invalidates the staff family on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockArchiveStaff.mockResolvedValue({ ...staffResponse, archived: true });

      const { result } = renderHook(() => useArchiveStaff(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 's-1', archive_master: true, archive_user: true });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['staff'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['masters'] });
    });
  });

  describe('useRestoreStaff', () => {
    it('calls restoreStaff with the provided id', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockRestoreStaff.mockResolvedValue({ ...staffResponse, archived: false });

      const { result } = renderHook(() => useRestoreStaff(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('s-1');
      });

      expect(mockRestoreStaff).toHaveBeenCalledWith('s-1');
    });

    it('invalidates the staff family on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockRestoreStaff.mockResolvedValue({ ...staffResponse, archived: false });

      const { result } = renderHook(() => useRestoreStaff(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('s-1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['staff'] });
    });
  });
});
