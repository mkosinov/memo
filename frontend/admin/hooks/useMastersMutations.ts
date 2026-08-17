'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  createMaster,
  updateMaster,
  patchMaster,
  deleteMaster,
  archiveMaster,
  restoreMaster,
  ApiError,
} from '@memo/api-client';
import type { MasterCreate, MasterUpdate, DependencyNode } from '@memo/api-client';

export function useCreateMaster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: MasterCreate) => createMaster(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['masters'] }),
  });
}

export function useUpdateMaster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: MasterUpdate }) => updateMaster(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['masters'] }),
  });
}

export function usePatchMaster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<MasterUpdate> }) =>
      patchMaster(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['masters'] }),
  });
}

/**
 * Dry-run hard delete (GH #207 §7.3): no-body DELETE → 204 (no deps) or
 * 409 + dependency tree. On 409 the tree is exposed via `dependencies` so
 * the DeleteDialog (Task 18/19) can render Mode A/B; the mutation still
 * rejects so callers control the flow.
 */
export function useDeleteMaster() {
  const queryClient = useQueryClient();
  const [dependencies, setDependencies] = useState<DependencyNode[] | null>(null);

  const mutation = useMutation({
    mutationFn: (id: string) => deleteMaster(id),
    onMutate: () => setDependencies(null), // clear stale tree from a prior attempt
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masters'] });
      // Cross-invalidation (cache hygiene): a hard-deleted master may have
      // been referenced by records-derived views that key on ['masters']
      // (useRecordData.ts) and by records lists themselves.
      queryClient.invalidateQueries({ queryKey: ['records'] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409 && err.dependencies) {
        setDependencies(err.dependencies);
      }
    },
  });

  return { ...mutation, dependencies };
}

/** Archive a master (#207). Backend also flips the linked user's is_active
 *  (§4.2 cascade) — transparent to the frontend. */
export function useArchiveMaster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => archiveMaster(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['masters'] }),
  });
}

/** Restore an archived master (#207). */
export function useRestoreMaster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => restoreMaster(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['masters'] }),
  });
}
