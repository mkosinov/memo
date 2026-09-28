'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { createPhoto, updatePhoto, dryRunDeletePhoto, resolveDeletePhoto } from '@memo/api-client';
import type {
  DependencyNode,
  PaginatedResponse,
  PhotoCreate,
  PhotoResponse,
  PhotoUpdate,
  ResolveDeletePhotoPayload,
} from '@memo/api-client';
import {
  createRowSnapshotSync,
  mapRowListCache,
  type RowSnapshot,
} from '@/lib/cache/rowSnapshotSync';
import { usePendingActions } from '@/contexts/PendingActionsContext';
import { useUI } from '@/contexts/UIContext';
import { invalidateEntities } from '@/lib/invalidate';
import { staleAwareOnError } from '@/lib/staleAwareOnError';
import { qk } from '@/lib/queryKeys';

export function useCreatePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: PhotoCreate) => createPhoto(data),
    onSuccess: () => invalidateEntities(qc, ['photos']),
  });
}

export function useUpdatePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: PhotoUpdate }) => updatePhoto(id, data),
    onSuccess: () => invalidateEntities(qc, ['photos']),
  });
}

// ── #324 deferred photo delete (spec §6) — mirrors useDeleteTag (#318) ──────
//
// Both entry points are NON-BLOCKING deferred actions: the row disappears
// optimistically, the user gets a 5s undo window, the real DELETE runs in
// commit — carrying the `expected` state snapshot so the backend answers
// 409 `stale_dependencies` on a mid-window race.
//
// ONE cache family (['photos', …] — the PhotosContext paged envelope; no
// /all lookup list, no canonical point key), no cross-family invalidation.
//
// - `removePhoto` — clean path: item-level snapshots → dry-run
//   `?dry_run=true` (pure preview; 409 + the photo_tags tree REJECTS upward
//   — the call site opens DeleteDialog; any other error also propagates) →
//   optimistic row removal → enqueue with commit =
//   resolveDeletePhoto(id, {expected: {}}).
// - `removePhotoResolved` — cascade path after DeleteDialog confirmation:
//   no dry-run (the tree is already in hand); `expected` id-sets are built
//   from the tree's `items` (the photo_tags node always carries items);
//   dialog closes immediately (enqueue is sync). The tags SURVIVE — the
//   join rows die (resolutions {photo_tags: cascade}).
//
// Error surface (D4 family): dry-run errors are never intercepted
// (409-with-tree rejects upward to the call site); COMMIT errors go through
// the PendingActions pipeline — 404 = quiet success, the shared stale-aware
// handler owns every other failure. Invalidation failures inside commit are
// non-fatal: the screen converges via SSE / next load.

/** Snapshot mechanics over the single ['photos', …] family (#285 D5). */
const photoRowSync = createRowSnapshotSync(qk.photos);

/** expected = id-sets per entity from the dialog tree's `items` (D6).
 *  Nodes without items are skipped (defensive — mirrors the tags hook). */
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

/** Photos cache shape: the PhotosContext paged envelope (shape-agnostic via
 *  the shared mapRowListCache). */
type PhotosListCache = PhotoResponse[] | PaginatedResponse<PhotoResponse>;

/** Prefix-wide removal from EVERY ['photos', …] cache (shape-agnostic).
 *  Used in commit as the reconcile safety net — it also catches caches that
 *  appeared or refetched during the undo window. */
function removePhotoFromCaches(qc: QueryClient, id: string): void {
  qc.setQueriesData<PhotosListCache | undefined>(
    { queryKey: qk.photos },
    (old) =>
      old == null
        ? old
        : (mapRowListCache<PhotoResponse>(old, (items) =>
            items.filter((p) => p.id !== id),
          ) as PhotosListCache),
  );
}

/** Non-fatal invalidation at commit: the ['photos'] family only. */
function invalidateAfterDelete(qc: QueryClient): void {
  invalidateEntities(qc, ['photos']);
}

/** Shared commit body: real DELETE (with the expected-state contract) →
 *  removal reconcile → non-fatal invalidation. Errors propagate to the
 *  PendingActions pipeline (undo/toast handled there). */
async function commitDeferredDelete(
  qc: QueryClient,
  photoId: string,
  payload: ResolveDeletePhotoPayload,
  snapshots: RowSnapshot[],
): Promise<void> {
  await resolveDeletePhoto(photoId, payload);
  // Reconcile: ensure the captured keys still reflect the deletion even if
  // a mid-window refetch brought the row back.
  photoRowSync.remove(qc, snapshots);
  removePhotoFromCaches(qc, photoId);
  try {
    invalidateAfterDelete(qc);
  } catch {
    // Non-fatal: server state after 204 is authoritative, undo never
    // resurrects a server-deleted photo; SSE / next load converge.
  }
}

/** Toast shower type derived from the UI context (the hook consumes useUI). */
type ShowToast = ReturnType<typeof useUI>['showToast'];

/** Shared enqueue shape (dedupe/cancel key + 5s window + by-key undo). */
function buildDeferredDeleteAction(
  qc: QueryClient,
  photo: PhotoResponse,
  payload: ResolveDeletePhotoPayload,
  snapshots: RowSnapshot[],
  showToast: ShowToast,
): PendingActionShape {
  const undo = () => photoRowSync.restore(qc, snapshots);
  return {
    id: `delete-photo-${photo.id}`,
    kind: 'delete',
    message: 'Удалено. Отменить',
    delayMs: 5000,
    // Undo: pure by-key restore — no server calls (the dry-run guarantees
    // nothing was deleted during the window), no invalidations.
    undo,
    commit: () => commitDeferredDelete(qc, photo.id, payload, snapshots),
    // D4 family / #286 D7: the shared stale-aware handler parameterized on
    // 'photos' — 409+dependencies → undo + honest stale toast with the
    // «Обновить» action (['photos'] family); 404 — quiet success; any other
    // error — context-default (undo + red toast).
    onError: staleAwareOnError(qc, 'photos', undo, showToast),
  };
}

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

export function useDeletePhoto() {
  const queryClient = useQueryClient();
  const { showToast } = useUI();
  const { enqueuePendingAction } = usePendingActions();

  /** Clean deferred delete: snapshots → dry-run → optimistic removal →
   *  enqueue (5s undo window; undo restores snapshots by key). */
  const removePhoto = useCallback(
    async (photo: PhotoResponse): Promise<void> => {
      const snapshots = photoRowSync.capture(queryClient, photo.id);
      // Dry-run errors are NEVER intercepted: 409-with-dependencies → the
      // call site opens DeleteDialog (row stays visible); other errors keep
      // their catch/toast surfaces. One thrown ApiError — the single error
      // mechanism of the hook.
      await dryRunDeletePhoto(photo.id);
      photoRowSync.remove(queryClient, snapshots);
      enqueuePendingAction(
        buildDeferredDeleteAction(
          queryClient,
          photo,
          { expected: {} },
          snapshots,
          showToast,
        ),
      );
    },
    [queryClient, enqueuePendingAction, showToast],
  );

  /** Cascade deferred delete: same enqueue mechanics, no dry-run — the
   *  DeleteDialog built `resolutions` from the 409 tree it already has.
   *  `expected` carries the id-sets snapshotted from that tree (D6). */
  const removePhotoResolved = useCallback(
    async (
      photo: PhotoResponse,
      resolutions: Record<string, string>,
      dependencies: DependencyNode[],
    ): Promise<void> => {
      const snapshots = photoRowSync.capture(queryClient, photo.id);
      photoRowSync.remove(queryClient, snapshots);
      enqueuePendingAction(
        buildDeferredDeleteAction(
          queryClient,
          photo,
          { resolutions, expected: expectedFromDependencies(dependencies) },
          snapshots,
          showToast,
        ),
      );
    },
    [queryClient, enqueuePendingAction, showToast],
  );

  return { removePhoto, removePhotoResolved };
}
