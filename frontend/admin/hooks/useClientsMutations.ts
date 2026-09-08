'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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
import type { ClientCreate, ClientUpdate, DependencyNode } from '@memo/api-client';
import { invalidateEntitiesAsync } from '@/lib/invalidate';

/**
 * Shared success handler (GH #140): every client mutation invalidates BOTH
 * lists — the clients table AND the records prefix, because records rows are
 * composite view rows carrying denormalized client name/phone (spec §6.3).
 * Awaiting is the pre-existing #140 contract: mutateAsync().then() must
 * resolve only after the refetches land. Routed through the shared
 * invalidation map's awaitable variant (#239) — same family pair.
 */
const useInvalidateClients = () => {
  const queryClient = useQueryClient();
  return async () => {
    await invalidateEntitiesAsync(queryClient, ['clients']);
  };
};

export function useCreateClient() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (data: ClientCreate) => createClient(data),
    onSuccess: invalidate,
  });
}

export function useUpdateClient() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ClientUpdate }) => updateClient(id, data),
    onSuccess: invalidate,
  });
}

export function usePatchClient() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ClientUpdate> }) =>
      patchClient(id, data),
    onSuccess: invalidate,
  });
}

/**
 * Dry-run hard delete (GH #207 §7.3): no-body DELETE → 204 (no deps) or
 * 409 + dependency tree. On 409 the tree is exposed via `dependencies` so
 * the DeleteDialog can render Mode A/B; the mutation still rejects so
 * callers control the flow. Each consumer owns its hook instance
 * (LocationsTable precedent) — the parked tree is local to the dialog.
 */
export function useDeleteClient() {
  const invalidate = useInvalidateClients();
  const [dependencies, setDependencies] = useState<DependencyNode[] | null>(null);

  const mutation = useMutation({
    mutationFn: (id: string) => deleteClient(id),
    onMutate: () => setDependencies(null), // clear stale tree from a prior attempt
    onSuccess: invalidate,
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409 && err.dependencies) {
        setDependencies(err.dependencies);
      }
    },
  });

  return { ...mutation, dependencies };
}

/** Archive a client (#207). */
export function useArchiveClient() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (id: string) => archiveClient(id),
    onSuccess: invalidate,
  });
}

/** Restore an archived client (#207). */
export function useRestoreClient() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (id: string) => restoreClient(id),
    onSuccess: invalidate,
  });
}

/** Execute a hard delete with user resolutions (GH #207 §6) — DELETE with body. */
export function useResolveDeleteClient() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: ({ id, resolutions }: { id: string; resolutions: Record<string, string> }) =>
      resolveDeleteClient(id, resolutions),
    onSuccess: invalidate,
  });
}
