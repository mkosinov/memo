'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createPhoto, updatePhoto, deletePhoto } from '@memo/api-client';
import type { PhotoCreate, PhotoUpdate } from '@memo/api-client';
import { qk } from '@/lib/queryKeys';

export function useCreatePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: PhotoCreate) => createPhoto(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.photos }),
  });
}

export function useUpdatePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: PhotoUpdate }) => updatePhoto(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.photos }),
  });
}

export function useDeletePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deletePhoto(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.photos }),
  });
}
