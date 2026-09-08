'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  createService,
  updateService,
  patchService,
  deleteService,
  archiveService,
  restoreService,
  ApiError,
} from '@memo/api-client';
import type { ServiceCreate, ServiceUpdate, DependencyNode } from '@memo/api-client';
import { invalidateEntities } from '@/lib/invalidate';

export function useCreateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ServiceCreate) => createService(data),
    // GH #223 §8: the payload may carry material links → the materials table's
    // «Где используется» counter changes too (spec S4: count updates after
    // linking). Cross-entity invalidation mirrors useMaterialsMutations.
    onSuccess: () => {
      // Family rules via the shared map (#239): ['services'] + ['materials']
      // (#223: link changes touch both «Где используется» counters) — the
      // delete hook additionally cascades to ['records'] via the same map.
      invalidateEntities(queryClient, ['services']);
    },
  });
}

export function useUpdateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ServiceUpdate }) => updateService(id, data),
    // GH #223 §8 — see useCreateService (link changes touch both counters).
    onSuccess: () => {
      // Family rules via the shared map (#239): ['services'] + ['materials']
      // (#223: link changes touch both «Где используется» counters) — the
      // delete hook additionally cascades to ['records'] via the same map.
      invalidateEntities(queryClient, ['services']);
    },
  });
}

export function usePatchService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ServiceUpdate> }) =>
      patchService(id, data),
    onSuccess: () => invalidateEntities(queryClient, ['services']),
  });
}

/**
 * Dry-run hard delete (GH #207 §7.3): no-body DELETE → 204 (no deps) or
 * 409 + dependency tree. On 409 the tree is exposed via `dependencies` so
 * the DeleteDialog (Task 18/19) can render Mode A/B; the mutation still
 * rejects so callers control the flow.
 */
export function useDeleteService() {
  const queryClient = useQueryClient();
  const [dependencies, setDependencies] = useState<DependencyNode[] | null>(null);

  const mutation = useMutation({
    mutationFn: (id: string) => deleteService(id),
    onMutate: () => setDependencies(null), // clear stale tree from a prior attempt
    onSuccess: () => {
      // Family rules via the shared map (#239): ['services'] + ['materials']
      // + ['records'] (a hard-deleted service may be referenced by
      // records-derived views keyed on ['services'] — useRecordData.ts).
      invalidateEntities(queryClient, ['services']);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409 && err.dependencies) {
        setDependencies(err.dependencies);
      }
    },
  });

  return { ...mutation, dependencies };
}

/** Archive a service (#207). */
export function useArchiveService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => archiveService(id),
    onSuccess: () => invalidateEntities(queryClient, ['services']),
  });
}

/** Restore an archived service (#207). */
export function useRestoreService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => restoreService(id),
    onSuccess: () => invalidateEntities(queryClient, ['services']),
  });
}
