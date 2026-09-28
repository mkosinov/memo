'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import {
  createService,
  updateService,
  patchService,
  archiveService,
  restoreService,
  dryRunDeleteService,
  resolveDeleteService,
  ApiError,
} from '@memo/api-client';
import type {
  ServiceCreate,
  ServiceUpdate,
  ServiceResponse,
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

export function useCreateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ServiceCreate) => createService(data),
    // GH #223 §8: the payload may carry material links → the materials table's
    // «Где используется» counter changes too (spec S4: count updates after
    // linking). Cross-entity invalidation mirrors useMaterialsMutations.
    onSuccess: () => {
      // Family rules via the shared map (#239): ['services'] + ['materials']
      // (#223: link changes touch both «Где используется» counters).
      invalidateEntities(queryClient, ['services']);
    },
  });
}

export function useUpdateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ServiceUpdate }) => updateService(id, data),
    // GH #223 §8 — see useCreateService (link changes touch both counters).
    onSuccess: () => {
      // Family rules via the shared map (#239): ['services'] + ['materials'].
      invalidateEntities(queryClient, ['services']);
    },
  });
}

export function usePatchService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ServiceUpdate> }) =>
      patchService(id, data),
    onSuccess: () => invalidateEntities(queryClient, ['services']),
  });
}

// ── #345 Task 7: deferred service delete — the useDeleteTag (#318) /
// useDeleteRecord (#285) / useDeleteStaff (Task 6) conveyor ─────────────────
//
// Both entry points are NON-BLOCKING deferred actions: the row disappears
// optimistically, the user gets a 5s undo window, the real DELETE runs in
// commit — carrying the `expected` state snapshot so the backend answers
// 409 `stale_dependencies` on a mid-window race.
//
// - `removeService` — clean path: item-level snapshots → dry-run
//   `?dry_run=true` (pure preview; 409 + dependency tree REJECTS upward —
//   the call site parks the tree + opens DeleteDialog) → optimistic row
//   removal → enqueue with `commit = resolveDeleteService(id, {expected: {}})`.
// - `removeServiceResolved` — cascade path after DeleteDialog confirmation:
//   no dry-run (the tree is already in hand); `expected` id-sets are built
//   from the FULL tree via the shared expectedFromDependencies (the service
//   tree's nodes are auto/blocked and carry no items → expected {}); the
//   dialog closes immediately (enqueue is sync).
//
// Service matrix (§4.4): activities BLOCK (Mode B «Архивировать вместо» —
// unchanged, the delete branch is unreachable from the UI); tariffs,
// photos, service_tags and service_materials auto-cascade — a successful
// commit always carries `{expected: {}}`.
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
// with «Обновить» invalidating the services family); any other error → undo +
// generic error toast. Invalidation failures inside commit are non-fatal:
// the screen converges via SSE / next load.

/** Snapshot mechanics over the ['services', …] family (paged envelope from
 *  ServicesContext + the bare lookup list from useServices — shared prefix). */
const serviceRowSync = createRowSnapshotSync(qk.services);

/** Service cache shape: paged envelope ({items,…} — ServicesContext factory)
 *  or a plain-array lookup list (useServices). Shape-agnostic via
 *  mapRowListCache. */
type ServiceListCache = ServiceResponse[] | PaginatedResponse<ServiceResponse>;

/** Prefix-wide removal from EVERY ['services', …] cache (shape-agnostic).
 *  Used in commit as the reconcile safety net — it also catches caches that
 *  appeared or refetched during the undo window. */
function removeServiceFromCaches(qc: QueryClient, id: string): void {
  qc.setQueriesData<ServiceListCache | undefined>(
    { queryKey: qk.services },
    (old) =>
      old == null
        ? old
        : (mapRowListCache<ServiceResponse>(old, (items) =>
            items.filter((s) => s.id !== id),
          ) as ServiceListCache),
  );
}

/** Non-fatal invalidation at commit (spec §5.2): the services family map
 *  (#239) — ['services'] + ['materials'] + ['records']. No point key:
 *  services have no canonical single-entity cache. */
function invalidateAfterDelete(qc: QueryClient): void {
  invalidateEntities(qc, ['services']);
}

/** Payload type for the execute path — `expected` is mandatory on the new
 *  contract (T5), resolutions optional (all-auto service trees send {}). */
type ResolveDeleteServicePayload = {
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
  serviceId: string,
  payload: ResolveDeleteServicePayload,
  snapshots: RowSnapshot[],
): Promise<void> {
  await resolveDeleteService(serviceId, payload);
  // Reconcile: ensure the captured keys still reflect the deletion even if
  // a mid-window refetch brought the row back.
  serviceRowSync.remove(qc, snapshots);
  removeServiceFromCaches(qc, serviceId);
  try {
    invalidateAfterDelete(qc);
  } catch {
    // Non-fatal: server state after 204 is authoritative, undo never
    // resurrects a server-deleted service; SSE / next load converge.
  }
}

/** Shared enqueue shape (dedupe/cancel key + 5s window + by-key undo). */
function buildDeferredDeleteAction(
  qc: QueryClient,
  service: Pick<ServiceResponse, 'id'>,
  payload: ResolveDeleteServicePayload,
  snapshots: RowSnapshot[],
  showToast: ShowToast,
): PendingActionShape {
  const undo = () => serviceRowSync.restore(qc, snapshots);
  return {
    id: `delete-service-${service.id}`,
    kind: 'delete',
    message: 'Удалено. Отменить',
    delayMs: 5000,
    // Undo (§5.2): pure by-key restore — no server calls (the dry-run
    // guarantees nothing was deleted during the window), no invalidations.
    undo,
    commit: () => commitDeferredDelete(qc, service.id, payload, snapshots),
    // Commit failures: 409+dependencies → undo + «Не удалось удалить:
    // данные изменились» with the «Обновить» action (services family map);
    // 404 — quiet success; any other error — context-default (undo + toast).
    onError: staleAwareOnError(qc, 'services', undo, showToast),
  };
}

/**
 * Deferred hard delete (GH #345): dry-run preview → optimistic removal →
 * 5s undo window → commit `resolveDeleteService({expected, resolutions?})`.
 * Each consumer owns its hook instance (LocationsTable precedent) — the
 * in-flight guard is local to the button that rendered it.
 */
export function useDeleteService() {
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
  const removeService = useCallback(
    async (service: ServiceResponse): Promise<void> => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setIsPending(true);
      try {
        const snapshots = serviceRowSync.capture(queryClient, service.id);
        // Dry-run errors: 409-with-dependencies REJECTS upward (the call
        // site parks the tree + opens DeleteDialog — the row stays
        // visible). 404 → quiet family invalidation; network/5xx →
        // «Не удалось проверить зависимости» toast (§5.3) — both swallowed.
        try {
          await dryRunDeleteService(service.id);
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            invalidateEntities(queryClient, ['services']);
            return;
          }
          if (!(err instanceof ApiError && err.status === 409 && err.dependencies)) {
            showToast('Не удалось проверить зависимости', 'error');
            return;
          }
          throw err;
        }
        serviceRowSync.remove(queryClient, snapshots);
        enqueuePendingAction(
          buildDeferredDeleteAction(
            queryClient,
            service,
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
  const removeServiceResolved = useCallback(
    async (
      service: ServiceResponse,
      resolutions: Record<string, string>,
      dependencies: DependencyNode[],
    ): Promise<void> => {
      const snapshots = serviceRowSync.capture(queryClient, service.id);
      serviceRowSync.remove(queryClient, snapshots);
      enqueuePendingAction(
        buildDeferredDeleteAction(
          queryClient,
          service,
          { resolutions, expected: expectedFromDependencies(dependencies) },
          snapshots,
          showToast,
        ),
      );
    },
    [queryClient, enqueuePendingAction, showToast],
  );

  return { removeService, removeServiceResolved, isPending };
}

/** Archive a service (#207). */
export function useArchiveService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => archiveService(id),
    onSuccess: () => invalidateEntities(queryClient, ['services']),
  });
}

/** Restore an archived service (#207). */
export function useRestoreService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => restoreService(id),
    onSuccess: () => invalidateEntities(queryClient, ['services']),
  });
}
