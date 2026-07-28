'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createService, updateService, patchService, deleteService } from '@memo/api-client';
import type { ServiceCreate, ServiceUpdate } from '@memo/api-client';

export function useCreateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ServiceCreate) => createService(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['services'] }),
  });
}

export function useUpdateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ServiceUpdate }) => updateService(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['services'] }),
  });
}

export function usePatchService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ServiceUpdate> & { is_active?: boolean } }) =>
      patchService(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['services'] }),
  });
}

export function useDeleteService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteService(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['services'] }),
  });
}
