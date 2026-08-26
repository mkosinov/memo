'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getClientsWithStats,
  createClient as apiCreateClient,
  updateClient as apiUpdateClient,
  patchClient as apiPatchClient,
  deleteClient as apiDeleteClient,
  archiveClient as apiArchiveClient,
  restoreClient as apiRestoreClient,
  resolveDeleteClient as apiResolveDeleteClient,
  ApiError,
} from '@memo/api-client';
import type {
  ClientWithStats,
  ClientResponse,
  ClientUpdate,
  DependencyNode,
  PaginatedResponse,
} from '@memo/api-client';

export interface ClientFilters {
  search: string;
  status: 'active' | 'all' | 'archived';
  created_from: string;
  created_to: string;
  updated_from: string;
  updated_to: string;
  min_records: number | null;
  max_records: number | null;
  min_paid: number | null;
  max_paid: number | null;
  missed_from: number | null;
  missed_to: number | null;
}

const defaultFilters: ClientFilters = {
  search: '',
  status: 'active',
  created_from: '',
  created_to: '',
  updated_from: '',
  updated_to: '',
  min_records: null,
  max_records: null,
  min_paid: null,
  max_paid: null,
  missed_from: null,
  missed_to: null,
};

export interface ClientsContextType {
  /** Server-page items — PagedListState.items contract (spec §6.4, #139 T6). */
  items: ClientWithStats[];
  /** Kept alongside `items` for backwards compat with non-table consumers. */
  clients: ClientWithStats[];
  total: number;
  page: number;
  perPage: number;
  filters: ClientFilters;
  /** `string` is assignable to `string | null`; initial 'name' preserved (B2 cat 15 guard). */
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  isLoading: boolean;
  /** Spec §6.4 — pass-through from React Query. */
  isPending: boolean;
  /** Spec §6.4 — pass-through from React Query. */
  isFetching: boolean;
  /** Spec §6.4 — align to `Error | null` (replaces the legacy stringified error). */
  error: Error | null;
  refetch: () => void;
  setPage: (page: number) => void;
  setPerPage: (perPage: number) => void;
  setFilters: (filters: Partial<ClientFilters>) => void;
  setSort: (field: string, order: 'asc' | 'desc') => void;
  resetFilters: () => void;
  createClient: (data: ClientCreateData) => Promise<ClientResponse>;
  updateClient: (id: string, data: ClientUpdate) => Promise<void>;
  patchClient: (id: string, data: Record<string, unknown>) => Promise<void>;
  deleteClient: (id: string) => Promise<void>;
  /** Archive (#207, #198 parity) — POST /clients/{id}/archive. */
  archiveClient: (id: string) => Promise<ClientResponse>;
  /** Restore (#207, #198 parity) — POST /clients/{id}/restore. */
  restoreClient: (id: string) => Promise<ClientResponse>;
  /** Execute a hard delete with user resolutions (§6) — DELETE /clients/{id} with body. */
  resolveDeleteClient: (id: string, resolutions: Record<string, string>) => Promise<void>;
  /**
   * Dependency tree from the dry-run DELETE 409 (§5/§7.3), or null.
   * deleteClient (no body) rejects on 409 and exposes the tree here so the
   * DeleteDialog (Task 18/19) can render Mode A/B.
   */
  dependencies: DependencyNode[] | null;
}

const ClientsContext = createContext<ClientsContextType | null>(null);

type ClientCreateData = { name: string; phone?: string; email?: string; channel?: string };

export function ClientsProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [filters, setFiltersState] = useState<ClientFilters>(defaultFilters);
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  // §5: dependency tree from the dry-run DELETE 409 — consumed by the
  // DeleteDialog (Task 18/19). Null when no dry-run conflict is pending.
  const [dependencies, setDependencies] = useState<DependencyNode[] | null>(null);

  const { data, isLoading, isPending, isFetching, error, refetch } = useQuery<PaginatedResponse<ClientWithStats>>({
    queryKey: ['clients', page, perPage, filters, sortBy, sortOrder],
    queryFn: () =>
      getClientsWithStats({
        page,
        per_page: perPage,
        sort_by: sortBy,
        sort_order: sortOrder,
        ...filters,
      }),
  });

  const setFilters = useCallback((newFilters: Partial<ClientFilters>) => {
    setFiltersState(prev => ({ ...prev, ...newFilters }));
    setPage(1);
  }, []);

  // Spec §6.10.2 — sort change resets page to 1 (drift fix; the pre-#139
  // hand-rolled context skipped this — DataTable and the factory contexts do
  // it; Clients now aligns).
  const setSort = useCallback((field: string, order: 'asc' | 'desc') => {
    setSortBy(field);
    setSortOrder(order);
    setPage(1);
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState(defaultFilters);
    setPage(1);
  }, []);

  const invalidateClients = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['clients'] });
    queryClient.invalidateQueries({ queryKey: ['records'] });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: (data: ClientCreateData) => apiCreateClient(data),
    onSuccess: invalidateClients,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ClientUpdate }) => apiUpdateClient(id, data),
    onSuccess: invalidateClients,
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiPatchClient(id, data),
    onSuccess: invalidateClients,
  });

  const deleteMutation = useMutation({
    // No-body DELETE = dry-run (§7.3): 204 when the client had no deps,
    // 409 + dependency tree otherwise. On 409 the tree is parked in
    // `dependencies` for the dialog; the mutation still rejects so the
    // caller can branch on it.
    mutationFn: (id: string) => apiDeleteClient(id),
    onMutate: () => setDependencies(null), // clear stale tree from a prior attempt
    onSuccess: invalidateClients,
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409 && err.dependencies) {
        setDependencies(err.dependencies);
      }
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => apiArchiveClient(id),
    onSuccess: invalidateClients,
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => apiRestoreClient(id),
    onSuccess: invalidateClients,
  });

  const resolveDeleteMutation = useMutation({
    // DELETE with body (§6): executes nullify → cascade → hard delete.
    mutationFn: ({ id, resolutions }: { id: string; resolutions: Record<string, string> }) =>
      apiResolveDeleteClient(id, resolutions),
    onSuccess: invalidateClients,
  });

  const createClient = useCallback(
    async (data: ClientCreateData) => {
      return await createMutation.mutateAsync(data);
    },
    [createMutation],
  );

  const updateClient = useCallback(
    async (id: string, data: ClientUpdate) => {
      await updateMutation.mutateAsync({ id, data });
    },
    [updateMutation],
  );

  const patchClient = useCallback(
    async (id: string, data: Record<string, unknown>) => {
      await patchMutation.mutateAsync({ id, data });
    },
    [patchMutation],
  );

  const deleteClient = useCallback(
    async (id: string) => {
      await deleteMutation.mutateAsync(id);
    },
    [deleteMutation],
  );

  const archiveClient = useCallback(
    async (id: string) => {
      return await archiveMutation.mutateAsync(id);
    },
    [archiveMutation],
  );

  const restoreClient = useCallback(
    async (id: string) => {
      return await restoreMutation.mutateAsync(id);
    },
    [restoreMutation],
  );

  const resolveDeleteClient = useCallback(
    async (id: string, resolutions: Record<string, string>) => {
      await resolveDeleteMutation.mutateAsync({ id, resolutions });
    },
    [resolveDeleteMutation],
  );

  const value = useMemo(
    () => ({
      items: data?.items || [],
      clients: data?.items || [],
      total: data?.total || 0,
      page,
      perPage,
      filters,
      sortBy,
      sortOrder,
      isLoading,
      isPending,
      isFetching,
      error: (error as Error) ?? null,
      refetch,
      setPage,
      setPerPage,
      setFilters,
      setSort,
      resetFilters,
      createClient,
      updateClient,
      patchClient,
      deleteClient,
      archiveClient,
      restoreClient,
      resolveDeleteClient,
      dependencies,
    }),
    [
      data,
      page,
      perPage,
      filters,
      sortBy,
      sortOrder,
      isLoading,
      isPending,
      isFetching,
      error,
      refetch,
      createClient,
      updateClient,
      patchClient,
      deleteClient,
      archiveClient,
      restoreClient,
      resolveDeleteClient,
      dependencies,
    ],
  );

  // Spec §6.7 page clamp — after a SETTLED fetch returns an empty non-first
  // page (e.g. last row of page N deleted), step back. `!isFetching` guards
  // against mid-refetch races with keepPreviousData.
  useEffect(() => {
    const items = data?.items || [];
    if (!isPending && !isFetching && items.length === 0 && page > 1) {
      setPage(page - 1);
    }
  }, [isPending, isFetching, data, page]);

  return <ClientsContext.Provider value={value}>{children}</ClientsContext.Provider>;
}

export function useClients(): ClientsContextType {
  const context = useContext(ClientsContext);
  if (!context) throw new Error('useClients must be used within ClientsProvider');
  return context;
}
