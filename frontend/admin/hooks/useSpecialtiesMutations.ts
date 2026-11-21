'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import {
  createSpecialty,
  patchSpecialty,
  dryRunDeleteSpecialty,
  resolveDeleteSpecialty,
} from '@memo/api-client';
import type {
  DependencyNode,
  PaginatedResponse,
  SpecialtyCreate,
  SpecialtyPatch,
  SpecialtyResponse,
  ResolveDeleteSpecialtyPayload,
} from '@memo/api-client';
import {
  createRowSnapshotSync,
  mapRowListCache,
  type RowSnapshot,
} from '@/lib/cache/rowSnapshotSync';
import { usePendingActions } from '@/contexts/PendingActionsContext';
import { useUI } from '@/contexts/UIContext';
import { UNDO_WINDOW_MS } from '@/lib/constants';
import { staleAwareOnError } from '@/lib/staleAwareOnError';
import { qk } from '@/lib/queryKeys';

/**
 * Specialties dictionary mutations (GH #599 Task 8.1; delete → the #324
 * deferred family).
 *
 * Invalidation goes DIRECTLY at the ['specialties'] prefix instead of
 * through lib/invalidate.ts INVALIDATION_MAP: `specialties` is deliberately
 * absent from that map (the positions SSE-omission rule — the backend DOES
 * emit the `specialties` entity over SSE, but the dictionary screen relies
 * on its own mutation invalidation; the drift guard
 * __tests__/invalidate.test.ts pins the absence). react-query prefix
 * matching then covers BOTH cache granularities in one call: the paged
 * table key (['specialties', page, perPage] — SpecialtiesContext) and the
 * future /all lookup (the Task 8.2/8.3 dropdown consumers).
 */

export function useCreateSpecialty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: SpecialtyCreate) => createSpecialty(data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.specialties }),
  });
}

export function useUpdateSpecialty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: SpecialtyPatch }) => patchSpecialty(id, data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.specialties }),
  });
}

// ── #324/#599 deferred specialty delete — mirrors useDeletePosition ────────
//
// Same NON-BLOCKING deferred contract as tags/photos/positions: optimistic
// removal → 5s undo window → the real DELETE in commit with the `expected`
// snapshot.
//
// - `removeSpecialty` — clean path: snapshots → dry-run ?dry_run=true.
//   409 (busy) rejects upward → the call site opens DeleteDialog; the tree
//   decides the mode (domain-rules Delete semantics): a `services` node
//   (allowed_actions: []) → the BLOCKED Mode B («Услуги: N», nothing
//   deletable — acknowledgment only); a lone `staff_specialties` auto node
//   → Mode A («Сотрудники — потеряют направление», confirm enqueues the
//   cascade commit).
// - `removeSpecialtyResolved` — cascade path after DeleteDialog
//   confirmation: expected = {staff_specialties: [staff ids]} from the
//   tree's items; the staff cards SURVIVE (the join rows die — the
//   materials pattern).
//
// Error surface: commit errors go through the PendingActions pipeline —
// 404 = quiet success; the shared stale-aware handler (the
// EXPLICIT-PREFIX overload — specialties has no INVALIDATION_MAP entry)
// owns the rest: 409 stale → undo + «Не удалось удалить: данные изменились»
// with «Обновить» invalidating ['specialties'].

/** Snapshot mechanics over the ['specialties', …] family — both granularities
 * (the paged envelope now + the /all lookup list once Task 8.2/8.3 lands it)
 * via the shared factory. */
const specialtyRowSync = createRowSnapshotSync(qk.specialties);

/** expected = id-sets per entity from the dialog tree's `items` (D6). */
function expectedFromDependencies(
  dependencies: DependencyNode[],
): Record<string, string[]> {
  const expected: Record<string, string[]> = {};
  for (const node of dependencies) {
    if (!node.items) continue;
    expected[node.entity] = node.items.map((item) => item.id);
  }
  return expected;
}

/** Specialties cache shapes: the paged envelope (+ the /all bare array once
 * the lookup consumers land). */
type SpecialtiesListCache = SpecialtyResponse[] | PaginatedResponse<SpecialtyResponse>;

/** Prefix-wide removal from EVERY ['specialties', …] cache (shape-agnostic) —
 * the commit-time reconcile safety net. */
function removeSpecialtyFromCaches(qc: QueryClient, id: string): void {
  qc.setQueriesData<SpecialtiesListCache | undefined>(
    { queryKey: qk.specialties },
    (old) =>
      old == null
        ? old
        : (mapRowListCache<SpecialtyResponse>(old, (items) =>
            items.filter((s) => s.id !== id),
          ) as SpecialtiesListCache),
  );
}

/** Non-fatal invalidation at commit: the ['specialties'] prefix only. */
function invalidateAfterDelete(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: qk.specialties });
}

/** Shared commit body: real DELETE (with the expected-state contract) →
 * removal reconcile → non-fatal invalidation. Errors propagate to the
 * PendingActions pipeline (undo/toast handled there). */
async function commitDeferredDelete(
  qc: QueryClient,
  specialtyId: string,
  payload: ResolveDeleteSpecialtyPayload,
  snapshots: RowSnapshot[],
): Promise<void> {
  await resolveDeleteSpecialty(specialtyId, payload);
  specialtyRowSync.remove(qc, snapshots);
  removeSpecialtyFromCaches(qc, specialtyId);
  try {
    invalidateAfterDelete(qc);
  } catch {
    // Non-fatal: server state after 204 is authoritative.
  }
}

/** Toast shower type derived from the UI context (the hook consumes useUI). */
type ShowToast = ReturnType<typeof useUI>['showToast'];

/** Shared enqueue shape (dedupe/cancel key + 5s window + by-key undo). */
function buildDeferredDeleteAction(
  qc: QueryClient,
  specialty: SpecialtyResponse,
  payload: ResolveDeleteSpecialtyPayload,
  snapshots: RowSnapshot[],
  showToast: ShowToast,
): PendingActionShape {
  const undo = () => specialtyRowSync.restore(qc, snapshots);
  return {
    id: `delete-specialty-${specialty.id}`,
    kind: 'delete',
    message: 'Удалено. Отменить',
    delayMs: UNDO_WINDOW_MS,
    undo,
    commit: () => commitDeferredDelete(qc, specialty.id, payload, snapshots),
    // The shared stale-aware handler, EXPLICIT-PREFIX overload —
    // specialties has no INVALIDATION_MAP entry (drift-guarded), so the
    // ['specialties'] family travels directly.
    onError: staleAwareOnError(qc, qk.specialties, undo, showToast),
  };
}

/** Structural mirror of PendingAction (imported type keeps this file
 * provider-agnostic in tests that mock the context). */
interface PendingActionShape {
  id: string;
  kind: 'delete';
  message: string;
  delayMs: number;
  commit: () => Promise<void>;
  undo: () => void;
  onError?: (err: unknown) => void;
}

/**
 * Deferred specialty delete (#324 family, GH #599). `removeSpecialty`
 * dry-runs: a free/staff-held row that went clean (204) → optimistic
 * removal + enqueue; a 409 WITH the dependency tree rejects upward — the
 * call site owns the surfaces (blocked Mode B for the `services` node /
 * confirmable Mode A for the staff-only tree).
 */
export function useDeleteSpecialty() {
  const queryClient = useQueryClient();
  const { showToast } = useUI();
  const { enqueuePendingAction } = usePendingActions();

  /** Clean deferred delete: snapshots → dry-run → optimistic removal →
   * enqueue (5s undo window; undo restores snapshots by key). */
  const removeSpecialty = useCallback(
    async (specialty: SpecialtyResponse): Promise<void> => {
      const snapshots = specialtyRowSync.capture(queryClient, specialty.id);
      // Dry-run errors are NEVER intercepted: 409-with-dependencies (busy)
      // rejects upward; the call site owns the surfaces (DeleteDialog).
      await dryRunDeleteSpecialty(specialty.id);
      specialtyRowSync.remove(queryClient, snapshots);
      enqueuePendingAction(
        buildDeferredDeleteAction(
          queryClient,
          specialty,
          { expected: {} },
          snapshots,
          showToast,
        ),
      );
    },
    [queryClient, enqueuePendingAction, showToast],
  );

  /** Cascade deferred delete: same enqueue mechanics, no dry-run — the
   * DeleteDialog built `resolutions` from the 409 tree it already has. */
  const removeSpecialtyResolved = useCallback(
    async (
      specialty: SpecialtyResponse,
      resolutions: Record<string, string>,
      dependencies: DependencyNode[],
    ): Promise<void> => {
      const snapshots = specialtyRowSync.capture(queryClient, specialty.id);
      specialtyRowSync.remove(queryClient, snapshots);
      enqueuePendingAction(
        buildDeferredDeleteAction(
          queryClient,
          specialty,
          { resolutions, expected: expectedFromDependencies(dependencies) },
          snapshots,
          showToast,
        ),
      );
    },
    [queryClient, enqueuePendingAction, showToast],
  );

  return { removeSpecialty, removeSpecialtyResolved };
}
