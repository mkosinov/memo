'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  createStaff,
  updateStaff,
  patchStaff,
  deleteStaff,
  archiveStaff,
  restoreStaff,
  ApiError,
} from '@memo/api-client';
import type {
  StaffCreate,
  StaffUpdate,
  StaffPatch,
  StaffArchiveRequest,
  DependencyNode,
} from '@memo/api-client';
import { invalidateEntities } from '@/lib/invalidate';

// GH #266: every staff write invalidates the ['staff'] family, which the
// shared INVALIDATION_MAP fans out to ['staff'] + ['masters'] + ['records']
// (the read-only /masters view is staff ⨝ masters, and records render
// master_name/master_color from that join). One call site, one source of
// truth — never hand-list the cross-keys here (lib/invalidate.ts §4.1).

export function useCreateStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: StaffCreate) => createStaff(data),
    onSuccess: () => invalidateEntities(queryClient, ['staff']),
  });
}

export function useUpdateStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: StaffUpdate }) => updateStaff(id, data),
    onSuccess: () => invalidateEntities(queryClient, ['staff']),
  });
}

export function usePatchStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: StaffPatch }) => patchStaff(id, data),
    onSuccess: () => invalidateEntities(queryClient, ['staff']),
  });
}

/**
 * Dry-run hard delete (GH #207 §7.3): no-body DELETE → 204 (no deps) or
 * 409 + dependency tree. On 409 the tree is exposed via `dependencies` so
 * the DeleteDialog can render Mode A/B; the mutation still rejects so callers
 * control the flow. Staff matrix (#266): activities BLOCK; users, the masters
 * row, master_tags and staff_positions auto-cascade.
 */
export function useDeleteStaff() {
  const queryClient = useQueryClient();
  const [dependencies, setDependencies] = useState<DependencyNode[] | null>(null);

  const mutation = useMutation({
    mutationFn: (id: string) => deleteStaff(id),
    onMutate: () => setDependencies(null), // clear stale tree from a prior attempt
    onSuccess: () => {
      invalidateEntities(queryClient, ['staff']);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409 && err.dependencies) {
        setDependencies(err.dependencies);
      }
    },
  });

  return { ...mutation, dependencies };
}

/**
 * Archive a staff card (#207) with the D6 dismissal checkboxes.
 * `checkboxes` = `{archive_master, archive_user}` — both default true on the
 * backend (a body-less call consents to the preselected dialog choice); the
 * dialog always sends an explicit body so the admin's choice is visible.
 * No hidden cascade: each flag applies only to an existing ACTIVE link.
 */
export function useArchiveStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...checkboxes }: { id: string } & StaffArchiveRequest) =>
      archiveStaff(id, checkboxes),
    onSuccess: () => invalidateEntities(queryClient, ['staff']),
  });
}

/** Restore an archived staff card (#207). Person only — master/user flags are explicit toggles (D3). */
export function useRestoreStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => restoreStaff(id),
    onSuccess: () => invalidateEntities(queryClient, ['staff']),
  });
}
