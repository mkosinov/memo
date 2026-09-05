'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  createMaterial,
  updateMaterial,
  patchMaterial,
  deleteMaterial,
  archiveMaterial,
  restoreMaterial,
  ApiError,
} from '@memo/api-client';
import type { MaterialCreate, MaterialUpdate, DependencyNode } from '@memo/api-client';
import { qk } from '@/lib/queryKeys';

export function useCreateMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: MaterialCreate) => createMaterial(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.materials }),
  });
}

export function useUpdateMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: MaterialUpdate }) => updateMaterial(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.materials }),
  });
}

export function usePatchMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<MaterialUpdate> }) =>
      patchMaterial(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.materials }),
  });
}

/**
 * Hard delete (GH #207). Material has ZERO FK deps (§4 matrix), so the
 * no-body DELETE always returns 204 — the 409 branch is defensive only and
 * keeps the uniform hook shape shared with the other entities.
 */
export function useDeleteMaterial() {
  const qc = useQueryClient();
  const [dependencies, setDependencies] = useState<DependencyNode[] | null>(null);

  const mutation = useMutation({
    mutationFn: (id: string) => deleteMaterial(id),
    onMutate: () => setDependencies(null),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.materials }),
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409 && err.dependencies) {
        setDependencies(err.dependencies);
      }
    },
  });

  return { ...mutation, dependencies };
}

/** Archive a material (#207). */
export function useArchiveMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => archiveMaterial(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.materials }),
  });
}

/** Restore an archived material (#207). */
export function useRestoreMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => restoreMaterial(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.materials }),
  });
}
