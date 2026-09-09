'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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
import { invalidateEntities } from '@/lib/invalidate';

export function useCreateLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: LocationCreate) => createLocation(data),
    onSuccess: () => invalidateEntities(queryClient, ['locations']),
  });
}

export function useUpdateLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: LocationUpdate }) => updateLocation(id, data),
    onSuccess: () => invalidateEntities(queryClient, ['locations']),
  });
}

export function usePatchLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<LocationUpdate> }) =>
      patchLocation(id, data),
    onSuccess: () => invalidateEntities(queryClient, ['locations']),
  });
}

/**
 * Dry-run hard delete (GH #207 §7.3): no-body DELETE → 204 (no deps) or
 * 409 + dependency tree. On 409 the tree is exposed via `dependencies` so
 * the DeleteDialog (Task 18/19) can render Mode A/B; the mutation still
 * rejects so callers control the flow.
 */
export function useDeleteLocation() {
  const queryClient = useQueryClient();
  const [dependencies, setDependencies] = useState<DependencyNode[] | null>(null);

  const mutation = useMutation({
    mutationFn: (id: string) => deleteLocation(id),
    onMutate: () => setDependencies(null), // clear stale tree from a prior attempt
    onSuccess: () => {
      // Family rules via the shared map (#239): ['locations'] + ['records']
      // (a hard-deleted location may be referenced by records-derived views
      // keyed on ['locations'] — useRecordData.ts).
      invalidateEntities(queryClient, ['locations']);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409 && err.dependencies) {
        setDependencies(err.dependencies);
      }
    },
  });

  return { ...mutation, dependencies };
}

/** Archive a location (#207). */
export function useArchiveLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => archiveLocation(id),
    onSuccess: () => invalidateEntities(queryClient, ['locations']),
  });
}

/** Restore an archived location (#207). */
export function useRestoreLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => restoreLocation(id),
    onSuccess: () => invalidateEntities(queryClient, ['locations']),
  });
}
