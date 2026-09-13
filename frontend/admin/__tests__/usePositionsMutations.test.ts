import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { mockPositionSmm } from './helpers/mockData';
import type { PositionCreate, PositionUpdate } from '@memo/api-client';

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    createPosition: vi.fn(),
    updatePosition: vi.fn(),
    deletePosition: vi.fn(),
  };
});

import {
  useCreatePosition,
  useUpdatePosition,
  useDeletePosition,
} from '../hooks/usePositionsMutations';
import { createPosition, updatePosition, deletePosition } from '@memo/api-client';

const mockCreatePosition = vi.mocked(createPosition);
const mockUpdatePosition = vi.mocked(updatePosition);
const mockDeletePosition = vi.mocked(deletePosition);

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

/**
 * GH #266 D4 — positions dictionary mutations.
 *
 * `positions` is deliberately NOT in lib/invalidate.ts INVALIDATION_MAP (the
 * backend emits the entity, but the frontend SSE mirror skips it — spec
 * «SSE-сущности»). Own mutations therefore invalidate the ['positions']
 * PREFIX directly, which covers BOTH cache granularities: the /all lookup
 * (usePositions → StaffModal checkboxes) and the paged table key
 * (['positions', page, perPage, sortBy, sortOrder] — PositionsContext).
 */
describe('usePositionsMutations', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  describe('useCreatePosition', () => {
    it('calls createPosition with the provided title', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockCreatePosition.mockResolvedValue(mockPositionSmm);

      const { result } = renderHook(() => useCreatePosition(), { wrapper });
      const payload: PositionCreate = { title: 'СММ' };

      await act(async () => {
        await result.current.mutateAsync(payload);
      });

      expect(mockCreatePosition).toHaveBeenCalledWith(payload);
    });

    it('invalidates the positions prefix on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockCreatePosition.mockResolvedValue(mockPositionSmm);

      const { result } = renderHook(() => useCreatePosition(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ title: 'СММ' });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['positions'] });
    });
  });

  describe('useUpdatePosition', () => {
    it('calls updatePosition with id and the title payload (PUT, D4)', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockUpdatePosition.mockResolvedValue({ ...mockPositionSmm, title: 'SMM-менеджер' });

      const { result } = renderHook(() => useUpdatePosition(), { wrapper });
      const payload: { id: string; data: PositionUpdate } = {
        id: 'master',
        data: { title: 'Ведущий мастер' },
      };

      await act(async () => {
        await result.current.mutateAsync(payload);
      });

      expect(mockUpdatePosition).toHaveBeenCalledWith('master', payload.data);
    });

    it('invalidates the positions prefix on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockUpdatePosition.mockResolvedValue(mockPositionSmm);

      const { result } = renderHook(() => useUpdatePosition(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'smm', data: { title: 'СММ' } });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['positions'] });
    });
  });

  describe('useDeletePosition', () => {
    it('calls deletePosition with the id', async () => {
      const { wrapper } = createQueryClientWrapper();
      mockDeletePosition.mockResolvedValue(undefined);

      const { result } = renderHook(() => useDeletePosition(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('smm');
      });

      expect(mockDeletePosition).toHaveBeenCalledWith('smm');
    });

    it('invalidates the positions prefix on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockDeletePosition.mockResolvedValue(undefined);

      const { result } = renderHook(() => useDeletePosition(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('smm');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['positions'] });
    });

    it('rejects (and does not invalidate) when the backend refuses a built-in', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockDeletePosition.mockRejectedValue(
        new Error('Встроенная должность не удаляется'),
      );

      const { result } = renderHook(() => useDeletePosition(), { wrapper });

      await expect(
        act(async () => {
          await result.current.mutateAsync('master');
        }),
      ).rejects.toThrow('Встроенная должность не удаляется');
      expect(invalidateSpy).not.toHaveBeenCalled();
    });
  });
});
