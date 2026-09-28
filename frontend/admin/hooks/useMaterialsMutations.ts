'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import {
  createMaterial,
  updateMaterial,
  patchMaterial,
  archiveMaterial,
  restoreMaterial,
  dryRunDeleteMaterial,
  resolveDeleteMaterial,
  ApiError,
} from '@memo/api-client';
import type {
  MaterialCreate,
  MaterialUpdate,
  MaterialResponse,
  DependencyNode,
  PaginatedResponse,
} from '@memo/api-client';
import {
  createRowSnapshotSync,
  mapRowListCache,
  type RowSnapshot,
} from '@/lib/cache/rowSnapshotSync';
import { expectedFromDependencies } from '@/lib/expectedFromDependencies';
import { usePendingActions } from '@/contexts/PendingActionsContext';
import { useUI } from '@/contexts/UIContext';
import { invalidateEntities } from '@/lib/invalidate';
import { staleAwareOnError } from '@/lib/staleAwareOnError';
import { qk } from '@/lib/queryKeys';

export function useCreateMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: MaterialCreate) => createMaterial(data),
    onSuccess: () => invalidateEntities(qc, ['materials']),
  });
}

export function useUpdateMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: MaterialUpdate }) => updateMaterial(id, data),
    onSuccess: () => invalidateEntities(qc, ['materials']),
  });
}

export function usePatchMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<MaterialUpdate> }) =>
      patchMaterial(id, data),
    onSuccess: () => invalidateEntities(qc, ['materials']),
  });
}

// ── #345 Task 7: deferred material delete — the useDeleteTag (#318) /
// useDeleteRecord (#285) / useDeleteStaff (Task 6) conveyor ─────────────────
//
// Both entry points are NON-BLOCKING deferred actions: the row disappears
// optimistically, the user gets a 5s undo window, the real DELETE runs in
// commit — carrying the `expected` state snapshot so the backend answers
// 409 `stale_dependencies` on a mid-window race.
//
// - `removeMaterial` — clean path (unlinked material): item-level snapshots →
//   dry-run `?dry_run=true` (pure preview; 409 + dependency tree REJECTS
//   upward — the call site parks the tree + opens DeleteDialog) → optimistic
//   row removal → enqueue with `commit = resolveDeleteMaterial(id,
//   {expected: {}})`.
// - `removeMaterialResolved` — cascade path after DeleteDialog confirmation:
//   no dry-run (the tree is already in hand); `expected` id-sets are built
//   from the FULL tree via the shared expectedFromDependencies (the material
//   tree's single auto node carries no items → expected {}); the dialog
//   closes immediately (enqueue is sync).
//
// Material matrix (§4.4 / GH #223): NO blocked state — an unlinked material
// is clean (204), a linked one returns one auto `service_materials`
// cascade node → the dialog is information-only; a successful commit always
// carries `{expected: {}}`.
//
// Preview phase (§5.3): `isPending` gates the delete button (double click —
// ONE request, the in-flight guard skips re-entry); dry-run 404 → quiet
// family invalidation (the row leaves on refetch, no dialog, no toast);
// network/5xx → error toast «Не удалось проверить зависимости», page state
// unchanged. Both are swallowed INSIDE the hook — the call site's catch
// handles only the 409-with-tree dialog path.
//
// Commit errors go through the PendingActions pipeline — 404 = quiet
// success, the shared stale-aware handler owns every other failure (409
// `stale_dependencies` → undo + «Не удалось удалить: данные изменились»
// with «Обновить» invalidating the materials family); any other error → undo +
// generic error toast. Invalidation failures inside commit are non-fatal:
// the screen converges via SSE / next load.

/** Snapshot mechanics over the ['materials', …] family (paged envelope from
 *  MaterialsContext + the bare lookup list from useMaterialsRaw — shared
 *  prefix). */
const materialRowSync = createRowSnapshotSync(qk.materials);

/** Material cache shape: paged envelope ({items,…} — MaterialsContext
 *  factory) or a plain-array lookup list (useMaterialsRaw). Shape-agnostic
 *  via mapRowListCache. */
type MaterialListCache = MaterialResponse[] | PaginatedResponse<MaterialResponse>;

/** Prefix-wide removal from EVERY ['materials', …] cache (shape-agnostic).
 *  Used in commit as the reconcile safety net — it also catches caches that
 *  appeared or refetched during the undo window. */
function removeMaterialFromCaches(qc: QueryClient, id: string): void {
  qc.setQueriesData<MaterialListCache | undefined>(
    { queryKey: qk.materials },
    (old) =>
      old == null
        ? old
        : (mapRowListCache<MaterialResponse>(old, (items) =>
            items.filter((m) => m.id !== id),
          ) as MaterialListCache),
  );
}

/** Non-fatal invalidation at commit (spec §5.2): the materials family map
 *  (#239) — ['materials'] only. No point key: materials have no canonical
 *  single-entity cache. */
function invalidateAfterDelete(qc: QueryClient): void {
  invalidateEntities(qc, ['materials']);
}

/** Payload type for the execute path — `expected` is mandatory on the new
 *  contract (T5), resolutions optional (all-auto material trees send {}). */
type ResolveDeleteMaterialPayload = {
  expected: Record<string, string[]>;
  resolutions?: Record<string, string>;
};

/** Toast shower type derived from the UI context (the hook consumes useUI). */
type ShowToast = ReturnType<typeof useUI>['showToast'];

/** Structural mirror of PendingAction (imported type keeps this file
 *  provider-agnostic in tests that mock the context). */
interface PendingActionShape {
  id: string;
  kind: 'delete';
  message: string;
  delayMs: number;
  commit: () => Promise<void>;
  undo: () => void;
  onError?: (err: unknown) => void;
}

/** Shared commit body: real DELETE (with the expected-state contract) →
 *  removal reconcile → non-fatal invalidation. Errors propagate to the
 *  PendingActions pipeline (undo/toast handled there). */
async function commitDeferredDelete(
  qc: QueryClient,
  materialId: string,
  payload: ResolveDeleteMaterialPayload,
  snapshots: RowSnapshot[],
): Promise<void> {
  await resolveDeleteMaterial(materialId, payload);
  // Reconcile: ensure the captured keys still reflect the deletion even if
  // a mid-window refetch brought the row back.
  materialRowSync.remove(qc, snapshots);
  removeMaterialFromCaches(qc, materialId);
  try {
    invalidateAfterDelete(qc);
  } catch {
    // Non-fatal: server state after 204 is authoritative, undo never
    // resurrects a server-deleted material; SSE / next load converge.
  }
}

/** Shared enqueue shape (dedupe/cancel key + 5s window + by-key undo). */
function buildDeferredDeleteAction(
  qc: QueryClient,
  material: Pick<MaterialResponse, 'id'>,
  payload: ResolveDeleteMaterialPayload,
  snapshots: RowSnapshot[],
  showToast: ShowToast,
): PendingActionShape {
  const undo = () => materialRowSync.restore(qc, snapshots);
  return {
    id: `delete-material-${material.id}`,
    kind: 'delete',
    message: 'Удалено. Отменить',
    delayMs: 5000,
    // Undo (§5.2): pure by-key restore — no server calls (the dry-run
    // guarantees nothing was deleted during the window), no invalidations.
    undo,
    commit: () => commitDeferredDelete(qc, material.id, payload, snapshots),
    // Commit failures: 409+dependencies → undo + «Не удалось удалить:
    // данные изменились» with the «Обновить» action (materials family);
    // 404 — quiet success; any other error — context-default (undo + toast).
    onError: staleAwareOnError(qc, 'materials', undo, showToast),
  };
}

/**
 * Deferred hard delete (GH #345): dry-run preview → optimistic removal →
 * 5s undo window → commit `resolveDeleteMaterial({expected, resolutions?})`.
 * Each consumer owns its hook instance (LocationsTable precedent) — the
 * in-flight guard is local to the button that rendered it.
 */
export function useDeleteMaterial() {
  const queryClient = useQueryClient();
  const { showToast } = useUI();
  const { enqueuePendingAction } = usePendingActions();
  const [isPending, setIsPending] = useState(false);
  // Synchronous re-entry guard (§5.3): `isPending` renders the button
  // disabled, but the state update lands after the tick — a second call
  // inside the same tick must consult the ref, not the closure state.
  const inFlightRef = useRef(false);

  /** Clean deferred delete: snapshots → dry-run → optimistic removal →
   *  enqueue (5s undo window; undo restores snapshots by key). */
  const removeMaterial = useCallback(
    async (material: MaterialResponse): Promise<void> => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setIsPending(true);
      try {
        const snapshots = materialRowSync.capture(queryClient, material.id);
        // Dry-run errors: 409-with-dependencies REJECTS upward (the call
        // site parks the tree + opens DeleteDialog — the row stays
        // visible). 404 → quiet family invalidation; network/5xx →
        // «Не удалось проверить зависимости» toast (§5.3) — both swallowed.
        try {
          await dryRunDeleteMaterial(material.id);
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            invalidateEntities(queryClient, ['materials']);
            return;
          }
          if (!(err instanceof ApiError && err.status === 409 && err.dependencies)) {
            showToast('Не удалось проверить зависимости', 'error');
            return;
          }
          throw err;
        }
        materialRowSync.remove(queryClient, snapshots);
        enqueuePendingAction(
          buildDeferredDeleteAction(
            queryClient,
            material,
            { expected: {} },
            snapshots,
            showToast,
          ),
        );
      } finally {
        inFlightRef.current = false;
        setIsPending(false);
      }
    },
    [queryClient, enqueuePendingAction, showToast],
  );

  /** Cascade deferred delete: same enqueue mechanics, no dry-run — the
   *  DeleteDialog built `resolutions` from the 409 tree it already has.
   *  `expected` carries the id-sets snapshotted from that FULL tree. */
  const removeMaterialResolved = useCallback(
    async (
      material: MaterialResponse,
      resolutions: Record<string, string>,
      dependencies: DependencyNode[],
    ): Promise<void> => {
      const snapshots = materialRowSync.capture(queryClient, material.id);
      materialRowSync.remove(queryClient, snapshots);
      enqueuePendingAction(
        buildDeferredDeleteAction(
          queryClient,
          material,
          { resolutions, expected: expectedFromDependencies(dependencies) },
          snapshots,
          showToast,
        ),
      );
    },
    [queryClient, enqueuePendingAction, showToast],
  );

  return { removeMaterial, removeMaterialResolved, isPending };
}

/** Archive a material (#207). */
export function useArchiveMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => archiveMaterial(id),
    onSuccess: () => invalidateEntities(qc, ['materials']),
  });
}

/** Restore an archived material (#207). */
export function useRestoreMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => restoreMaterial(id),
    onSuccess: () => invalidateEntities(qc, ['materials']),
  });
}
