import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getClientsWithStats } from '@memo/api-client';
import { ClientsProvider, useClients } from '../contexts/ClientsContext';

vi.mock('@memo/api-client', () => ({
  getClientsWithStats: vi.fn(),
  createClient: vi.fn(),
  updateClient: vi.fn(),
  patchClient: vi.fn(),
  deleteClient: vi.fn(),
}));

const mockGetClientsWithStats = vi.mocked(getClientsWithStats);

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
});
