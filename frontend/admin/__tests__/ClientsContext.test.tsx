import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  getClientsWithStats,
  archiveClient,
  restoreClient,
  deleteClient,
  resolveDeleteClient,
  ApiError,
} from '@memo/api-client';
import type { DependencyNode } from '@memo/api-client';
import { ClientsProvider, useClients } from '../contexts/ClientsContext';

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    getClientsWithStats: vi.fn(),
    createClient: vi.fn(),
    updateClient: vi.fn(),
    patchClient: vi.fn(),
    deleteClient: vi.fn(),
    archiveClient: vi.fn(),
    restoreClient: vi.fn(),
    resolveDeleteClient: vi.fn(),
  };
});

const mockGetClientsWithStats = vi.mocked(getClientsWithStats);
const mockArchiveClient = vi.mocked(archiveClient);
const mockRestoreClient = vi.mocked(restoreClient);
const mockDeleteClient = vi.mocked(deleteClient);
const mockResolveDeleteClient = vi.mocked(resolveDeleteClient);

const clientResponse = {
  id: 'c-1', name: 'Иванов', phone: null, email: null, channel: null,
  archived: false, created_at: '', updated_at: '',
};

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function createWrapper() {
  const queryClient = createTestQueryClient();
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ClientsProvider>{children}</ClientsProvider>
      </QueryClientProvider>
    );
  }
  return { Wrapper, queryClient };
}

describe('ClientsContext', () => {
  beforeEach(() => {
    mockGetClientsWithStats.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      per_page: 20,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('useClients', () => {
    it('throws when used outside ClientsProvider', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      function BrokenConsumer() {
        useClients();
        return null;
      }
      expect(() => render(<BrokenConsumer />)).toThrow(
        'useClients must be used within ClientsProvider'
      );
      spy.mockRestore();
    });
  });

  describe('ClientsProvider', () => {
    it('initializes with default filter values', () => {
      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useClients(), { wrapper: Wrapper });

      expect(result.current.page).toBe(1);
      expect(result.current.perPage).toBe(20);
      expect(result.current.sortBy).toBe('name');
      expect(result.current.sortOrder).toBe('asc');
      expect(result.current.filters.search).toBe('');
      expect(result.current.filters.status).toBe('active');
    });

    it('fetches clients on mount', async () => {
      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useClients(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockGetClientsWithStats).toHaveBeenCalled();
      expect(result.current.clients).toEqual([]);
      expect(result.current.total).toBe(0);
    });

    it('setPage updates page', async () => {
      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useClients(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.setPage(3);
      });

      expect(result.current.page).toBe(3);
    });

    it('setPerPage updates perPage', async () => {
      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useClients(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.setPerPage(50);
      });

      expect(result.current.perPage).toBe(50);
    });

    it('setFilters merges filters and resets page to 1', async () => {
      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useClients(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.setPage(5);
      });

      act(() => {
        result.current.setFilters({ search: 'Иванов' });
      });

      expect(result.current.filters.search).toBe('Иванов');
      expect(result.current.page).toBe(1);
    });

    it('maps filters.search to the q wire param, not search (GH #212)', async () => {
      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useClients(), { wrapper: Wrapper });

      act(() => {
        result.current.setFilters({ search: 'Иванов' });
      });

      // The refetch carries q; the legacy `search` key is explicitly killed.
      await waitFor(() => {
        expect(mockGetClientsWithStats).toHaveBeenLastCalledWith(
          expect.objectContaining({ q: 'Иванов', search: undefined }),
        );
      });
    });

    it('clamps 1-char search to no q param (server min_length=2, GH #212)', async () => {
      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useClients(), { wrapper: Wrapper });

      act(() => {
        result.current.setFilters({ search: 'И' });
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
      const call = mockGetClientsWithStats.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(call.q).toBeUndefined();
      // The legacy search key must not reach the wire either (renamed to q).
      expect(call.search).toBeUndefined();
    });

    it('setSort updates sort fields', async () => {
      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useClients(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.setSort('total_paid', 'desc');
      });

      expect(result.current.sortBy).toBe('total_paid');
      expect(result.current.sortOrder).toBe('desc');
    });

    it('setSort resets page to 1 (§6.10.2 drift fix)', async () => {
      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useClients(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.setPage(5);
      });
      expect(result.current.page).toBe(5);

      act(() => {
        result.current.setSort('total_paid', 'desc');
      });
      expect(result.current.page).toBe(1);
    });

    it('exposes items alias of clients (§6.4 PagedListState alignment)', async () => {
      mockGetClientsWithStats.mockResolvedValue({
        items: [{ ...clientResponse, id: 'c-9', name: 'Тест', records_count: 0, last_record: null, total_paid: 0, missed_records: 0 }],
        total: 1,
        page: 1,
        per_page: 20,
      });
      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useClients(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.items).toEqual(result.current.clients);
      expect(result.current.items[0].id).toBe('c-9');
    });

    it('exposes isFetching and isPending pass-throughs from useQuery (§6.4)', async () => {
      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useClients(), { wrapper: Wrapper });

      // Initial render — query is pending (no data yet).
      expect(result.current.isPending).toBe(true);
      // isFetching may be true or false on initial render depending on React Query internals.
      expect(typeof result.current.isFetching).toBe('boolean');

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // After fetch settles, isPending=false.
      expect(result.current.isPending).toBe(false);
      expect(result.current.isFetching).toBe(false);
    });

    it('error is exposed as Error | null (§6.4 alignment)', async () => {
      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useClients(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
      expect(result.current.error).toBeNull();
    });

    it('resetFilters restores default filters and resets page', async () => {
      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useClients(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.setFilters({ search: 'test', status: 'archived' });
        result.current.setPage(5);
      });

      act(() => {
        result.current.resetFilters();
      });

      expect(result.current.filters.search).toBe('');
      expect(result.current.filters.status).toBe('active');
      expect(result.current.page).toBe(1);
    });
  });

  describe('archive / restore / 409-aware delete (#207)', () => {
    it('archiveClient calls archiveClient and invalidates clients + records', async () => {
      const { Wrapper, queryClient } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockArchiveClient.mockResolvedValue({ ...clientResponse, archived: true });

      const { result } = renderHook(() => useClients(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.archiveClient('c-1');
      });

      expect(mockArchiveClient).toHaveBeenCalledWith('c-1');
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clients'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
    });

    it('restoreClient calls restoreClient and invalidates clients + records', async () => {
      const { Wrapper, queryClient } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockRestoreClient.mockResolvedValue({ ...clientResponse, archived: false });

      const { result } = renderHook(() => useClients(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.restoreClient('c-1');
      });

      expect(mockRestoreClient).toHaveBeenCalledWith('c-1');
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clients'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
    });

    it('deleteClient performs the no-body dry-run DELETE', async () => {
      const { Wrapper } = createWrapper();
      mockDeleteClient.mockResolvedValue(undefined);

      const { result } = renderHook(() => useClients(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.deleteClient('c-1');
      });

      expect(mockDeleteClient).toHaveBeenCalledWith('c-1');
    });

    it('deleteClient rejects with dependencies exposed on 409', async () => {
      const { Wrapper } = createWrapper();
      const deps: DependencyNode[] = [
        { entity: 'records', relation: 'Запись', count: 47, allowed_actions: ['nullify'] },
        {
          entity: 'visitors', relation: 'Посетитель', count: 12,
          allowed_actions: ['cascade'], cascade_preview: { visits: 45 },
        },
        { entity: 'client_tags', relation: 'Тег', count: 5, allowed_actions: ['cascade'] },
      ];
      mockDeleteClient.mockRejectedValue(new ApiError(409, 'has_dependencies', undefined, deps));

      const { result } = renderHook(() => useClients(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await expect(result.current.deleteClient('c-1')).rejects.toThrow(ApiError);
      });

      expect(result.current.dependencies).toEqual(deps);
    });

    it('keep dependencies null for non-409 delete errors', async () => {
      const { Wrapper } = createWrapper();
      mockDeleteClient.mockRejectedValue(new ApiError(404, 'Client not found', 'CLIENT_NOT_FOUND'));

      const { result } = renderHook(() => useClients(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await expect(result.current.deleteClient('c-1')).rejects.toThrow(ApiError);
      });

      expect(result.current.dependencies).toBeNull();
    });

    it('resolveDeleteClient sends DELETE with resolutions body', async () => {
      const { Wrapper, queryClient } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      mockResolveDeleteClient.mockResolvedValue(undefined);

      const { result } = renderHook(() => useClients(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.resolveDeleteClient('c-1', {
          records: 'nullify',
          visitors: 'cascade',
        });
      });

      expect(mockResolveDeleteClient).toHaveBeenCalledWith('c-1', {
        records: 'nullify',
        visitors: 'cascade',
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clients'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
    });
  });
});
