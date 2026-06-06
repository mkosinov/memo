'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createMaster, updateMaster, deleteMaster } from '@memo/api-client';
import type { MasterCreate, MasterUpdate } from '@memo/api-client';

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

export function useDeleteMaster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteMaster(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['masters'] }),
  });
}
