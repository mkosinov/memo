'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { deleteRecord, resolveDeleteRecord, ApiError } from '@memo/api-client';
import type { DependencyNode } from '@memo/api-client';
import { mapRecordsListCache, type RecordsListCache } from '@/lib/cache/recordCacheSync';
import { useUI } from '@/contexts/UIContext';

/**
 * Shared unbound record delete (Addendum 13 / GH #139 T8-FE2a) — mirrors
 * useDeleteMaster. Two stages:
 *
 * 1. Dry-run: no-body DELETE /records/{id} → 204 (no deps: toast + cached
 *    removal + invalidation) or 409 + dependency tree (exposed via
 *    `dependencies` for the DeleteDialog; the mutation still rejects so
 *    callers control the flow).
 * 2. resolveDelete: DELETE with `{ resolutions }` body after the user's
 *    explicit confirmation in the DeleteDialog — cascade visits/payments,
 *    record_tags auto-handled server-side.
 *
 * Invalidation union (per-site readers, #127 — no 5-key blanket):
 *   ['records']  — every list cache (prefix): ScheduleActivityCard
 *                  ['records',df,dt], ClientQuickCard ['records','client',id],
 *                  RecordsTable envelope ['records',page,...]
 *   ['record', id] — canonical store (RecordModal / useRecordData)
 *   ['visitors']   — visits cascade shrinks per-client visitor counts
 */
export function useDeleteRecord() {
  const queryClient = useQueryClient();
  const { showToast } = useUI();
  const [dependencies, setDependencies] = useState<DependencyNode[] | null>(null);

  /** Optimistic removal from EVERY ['records', ...] cache via prefix match
   *  (shape-agnostic: envelope lists + per-client/per-activity arrays). */
  const removeRecordFromCaches = (id: string): void => {
    queryClient.setQueriesData<RecordsListCache | undefined>(
      { queryKey: ['records'] },
      (old) => mapRecordsListCache(old, (items) => items.filter((r) => r.id !== id)),
    );
  };

  const invalidateAfterDelete = (id: string): void => {
    queryClient.invalidateQueries({ queryKey: ['records'] });
    queryClient.invalidateQueries({ queryKey: ['record', id] });
    queryClient.invalidateQueries({ queryKey: ['visitors'] });
  };

  const mutation = useMutation({
    mutationFn: (id: string) => deleteRecord(id),
    onMutate: () => setDependencies(null), // clear stale tree from a prior attempt
    onSuccess: (_data, id) => {
      removeRecordFromCaches(id);
      invalidateAfterDelete(id);
      showToast('Запись удалена');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409 && err.dependencies) {
        setDependencies(err.dependencies);
      }
    },
  });

  const resolveDelete = useMutation({
    mutationFn: ({ id, resolutions }: { id: string; resolutions: Record<string, string> }) =>
      resolveDeleteRecord(id, resolutions),
    onSuccess: (_data, { id }) => {
      removeRecordFromCaches(id);
      invalidateAfterDelete(id);
      showToast('Запись удалена');
    },
  });

  return { ...mutation, dependencies, resolveDelete };
}
