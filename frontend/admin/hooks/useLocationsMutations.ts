'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import {
  createLocation,
  updateLocation,
  patchLocation,
  archiveLocation,
  restoreLocation,
  dryRunDeleteLocation,
  resolveDeleteLocation,
  ApiError,
} from '@memo/api-client';
import type {
  LocationCreate,
  LocationUpdate,
  LocationResponse,
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

export function useCreateLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: LocationCreate) => createLocation(data),
    onSuccess: () => invalidateEntities(queryClient, ['locations']),
  });
}

export function useUpdateLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: LocationUpdate }) => updateLocation(id, data),
    onSuccess: () => invalidateEntities(queryClient, ['locations']),
  });
}

export function usePatchLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<LocationUpdate> }) =>
      patchLocation(id, data),
    onSuccess: () => invalidateEntities(queryClient, ['locations']),
  });
}

// ── #345 Task 7: deferred location delete — the useDeleteTag (#318) /
// useDeleteRecord (#285) / useDeleteStaff (Task 6) conveyor ─────────────────
//
// Both entry points are NON-BLOCKING deferred actions: the row disappears
// optimistically, the user gets a 5s undo window, the real DELETE runs in
// commit — carrying the `expected` state snapshot so the backend answers
// 409 `stale_dependencies` on a mid-window race.
//
// - `removeLocation` — clean path: item-level snapshots → dry-run
//   `?dry_run=true` (pure preview; 409 + dependency tree REJECTS upward —
//   the call site parks the tree + opens DeleteDialog) → optimistic row
//   removal → enqueue with `commit = resolveDeleteLocation(id, {expected: {}})`.
// - `removeLocationResolved` — cascade path after DeleteDialog confirmation:
//   no dry-run (the tree is already in hand); `expected` id-sets are built
//   from the FULL tree via the shared expectedFromDependencies (the location
//   tree's nodes are auto/blocked and carry no items → expected {}); the
//   dialog closes immediately (enqueue is sync).
//
// Location matrix (§4.4): activities BLOCK (Mode B «Архивировать вместо» —
// unchanged, the delete branch is unreachable from the UI); location_tags
// cascade and photos nullify — a successful commit always carries
// `{expected: {}}`.
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
// with «Обновить» invalidating the locations family); any other error → undo +
// generic error toast. Invalidation failures inside commit are non-fatal:
// the screen converges via SSE / next load.

/** Snapshot mechanics over the ['locations', …] family (paged envelope from
 *  LocationsContext + the bare lookup list from useLocations — shared prefix). */
const locationRowSync = createRowSnapshotSync(qk.locations);

/** Location cache shape: paged envelope ({items,…} — LocationsContext
 *  factory) or a plain-array lookup list (useLocations). Shape-agnostic via
 *  mapRowListCache. */
type LocationListCache = LocationResponse[] | PaginatedResponse<LocationResponse>;

/** Prefix-wide removal from EVERY ['locations', …] cache (shape-agnostic).
 *  Used in commit as the reconcile safety net — it also catches caches that
 *  appeared or refetched during the undo window. */
function removeLocationFromCaches(qc: QueryClient, id: string): void {
  qc.setQueriesData<LocationListCache | undefined>(
    { queryKey: qk.locations },
    (old) =>
      old == null
        ? old
        : (mapRowListCache<LocationResponse>(old, (items) =>
            items.filter((l) => l.id !== id),
          ) as LocationListCache),
  );
}

/** Non-fatal invalidation at commit (spec §5.2): the locations family map
 *  (#239) — ['locations'] + ['records']. No point key: locations have no
 *  canonical single-entity cache. */
function invalidateAfterDelete(qc: QueryClient): void {
  invalidateEntities(qc, ['locations']);
}

/** Payload type for the execute path — `expected` is mandatory on the new
 *  contract (T5), resolutions optional (all-auto location trees send {}). */
type ResolveDeleteLocationPayload = {
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
  locationId: string,
  payload: ResolveDeleteLocationPayload,
  snapshots: RowSnapshot[],
): Promise<void> {
  await resolveDeleteLocation(locationId, payload);
  // Reconcile: ensure the captured keys still reflect the deletion even if
  // a mid-window refetch brought the row back.
  locationRowSync.remove(qc, snapshots);
  removeLocationFromCaches(qc, locationId);
  try {
    invalidateAfterDelete(qc);
  } catch {
    // Non-fatal: server state after 204 is authoritative, undo never
    // resurrects a server-deleted location; SSE / next load converge.
  }
}

/** Shared enqueue shape (dedupe/cancel key + 5s window + by-key undo). */
function buildDeferredDeleteAction(
  qc: QueryClient,
  location: Pick<LocationResponse, 'id'>,
  payload: ResolveDeleteLocationPayload,
  snapshots: RowSnapshot[],
  showToast: ShowToast,
): PendingActionShape {
  const undo = () => locationRowSync.restore(qc, snapshots);
  return {
    id: `delete-location-${location.id}`,
    kind: 'delete',
    message: 'Удалено. Отменить',
    delayMs: 5000,
    // Undo (§5.2): pure by-key restore — no server calls (the dry-run
    // guarantees nothing was deleted during the window), no invalidations.
    undo,
    commit: () => commitDeferredDelete(qc, location.id, payload, snapshots),
    // Commit failures: 409+dependencies → undo + «Не удалось удалить:
    // данные изменились» with the «Обновить» action (locations family map);
    // 404 — quiet success; any other error — context-default (undo + toast).
    onError: staleAwareOnError(qc, 'locations', undo, showToast),
  };
}

/**
 * Deferred hard delete (GH #345): dry-run preview → optimistic removal →
 * 5s undo window → commit `resolveDeleteLocation({expected, resolutions?})`.
 * Each consumer owns its hook instance (LocationsTable precedent) — the
 * in-flight guard is local to the button that rendered it.
 */
export function useDeleteLocation() {
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
  const removeLocation = useCallback(
    async (location: LocationResponse): Promise<void> => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setIsPending(true);
      try {
        const snapshots = locationRowSync.capture(queryClient, location.id);
        // Dry-run errors: 409-with-dependencies REJECTS upward (the call
        // site parks the tree + opens DeleteDialog — the row stays
        // visible). 404 → quiet family invalidation; network/5xx →
        // «Не удалось проверить зависимости» toast (§5.3) — both swallowed.
        try {
          await dryRunDeleteLocation(location.id);
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            invalidateEntities(queryClient, ['locations']);
            return;
          }
          if (!(err instanceof ApiError && err.status === 409 && err.dependencies)) {
            showToast('Не удалось проверить зависимости', 'error');
            return;
          }
          throw err;
        }
        locationRowSync.remove(queryClient, snapshots);
        enqueuePendingAction(
          buildDeferredDeleteAction(
            queryClient,
            location,
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
  const removeLocationResolved = useCallback(
    async (
      location: LocationResponse,
      resolutions: Record<string, string>,
      dependencies: DependencyNode[],
    ): Promise<void> => {
      const snapshots = locationRowSync.capture(queryClient, location.id);
      locationRowSync.remove(queryClient, snapshots);
      enqueuePendingAction(
        buildDeferredDeleteAction(
          queryClient,
          location,
          { resolutions, expected: expectedFromDependencies(dependencies) },
          snapshots,
          showToast,
        ),
      );
    },
    [queryClient, enqueuePendingAction, showToast],
  );

  return { removeLocation, removeLocationResolved, isPending };
}

/** Archive a location (#207). */
export function useArchiveLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => archiveLocation(id),
    onSuccess: () => invalidateEntities(queryClient, ['locations']),
  });
}

/** Restore an archived location (#207). */
export function useRestoreLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => restoreLocation(id),
    onSuccess: () => invalidateEntities(queryClient, ['locations']),
  });
}
