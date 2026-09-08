'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createTag, updateTag, deleteTag } from '@memo/api-client';
import type { TagCreate, TagUpdate } from '@memo/api-client';
import { invalidateEntities } from '@/lib/invalidate';

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: TagCreate) => createTag(data),
    onSuccess: () => invalidateEntities(qc, ['tags']),
  });
}

export function useUpdateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: TagUpdate }) => updateTag(id, data),
    onSuccess: () => invalidateEntities(qc, ['tags']),
  });
}

export function useDeleteTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTag(id),
    onSuccess: () => invalidateEntities(qc, ['tags']),
  });
}
