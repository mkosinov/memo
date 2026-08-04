'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createMaterial, updateMaterial, patchMaterial, deleteMaterial } from '@memo/api-client';
import type { MaterialCreate, MaterialUpdate } from '@memo/api-client';

export function useCreateMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: MaterialCreate) => createMaterial(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['materials'] }),
  });
}

export function useUpdateMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: MaterialUpdate }) => updateMaterial(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['materials'] }),
  });
}

export function usePatchMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<MaterialUpdate> }) =>
      patchMaterial(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['materials'] }),
  });
}

export function useDeleteMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteMaterial(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['materials'] }),
  });
}
