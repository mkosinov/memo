'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createTag, updateTag, deleteTag } from '@memo/api-client';
import type { TagCreate, TagUpdate } from '@memo/api-client';

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: TagCreate) => createTag(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }),
  });
}

export function useUpdateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: TagUpdate }) => updateTag(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }),
  });
}

export function useDeleteTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTag(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }),
  });
}
