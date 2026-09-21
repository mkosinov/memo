'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { createTag, updateTag, dryRunDeleteTag, resolveDeleteTag } from '@memo/api-client';
import type {
  DependencyNode,
  PaginatedResponse,
  ResolveDeleteTagPayload,
  TagCreate,
  TagResponse,
  TagUpdate,
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

// ── #318 deferred tag delete (spec §3 D4/D5) — mirrors useDeleteRecord ──────
//
// Both entry points are NON-BLOCKING deferred actions: the row disappears
// optimistically, the user gets a 5s undo window, the real DELETE runs in
// commit — carrying the `expected` state snapshot so the backend answers
// 409 `stale_dependencies` on a mid-window race.
//
// Simpler than records (spec D4): ONE cache family (['tags', …] — paged
// factory envelope + lookup lists, no canonical point key, no modal keys),
// no cross-family invalidation cascade (D4: only ['tags']).
//
// - `removeTag` — clean path: item-level snapshots → dry-run `?dry_run=true`
//   (pure preview; 409 + dependency tree REJECTS upward — the call site
//   opens DeleteDialog; any other error also propagates) → optimistic row
//   removal → enqueue with `commit = resolveDeleteTag(id, {expected: {}})`.
// - `removeTagResolved` — cascade path after DeleteDialog confirmation:
//   no dry-run (the tree is already in hand); `expected` id-sets are built
//   from the tree's `items` (all 8 tag deps are non-auto and carry items);
//   dialog closes immediately (enqueue is sync).
//
// Error surface (D4 family): dry-run errors are never intercepted
// (409-with-tree rejects upward to the call site); COMMIT errors go through
// the PendingActions pipeline — 404 = quiet success, the shared stale-aware
// handler owns every other failure (409 `stale_dependencies` → undo +
// «Не удалось удалить: данные изменились» with «Обновить» invalidating
// ['tags']); any other error → undo + generic error toast. Invalidation
// failures inside commit are non-fatal: the screen converges via SSE /
// next load.

/** Snapshot mechanics over the single ['tags', …] family (shared factory,
 *  #285 D5 — same rowSnapshotSync as records/activities). */
const tagRowSync = createRowSnapshotSync(qk.tags);

/** expected = id-sets per entity from the dialog tree's `items` (D6).
 *  Nodes without items are skipped (defensive — the tag tree always has
 *  items; the guard mirrors expectedFromDependencies). */
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

/** Tags cache shape: paged envelope ({items,…} — TagsContext factory) or a
 *  plain-array lookup list. Shape-agnostic via the shared mapRowListCache. */
type TagsListCache = TagResponse[] | PaginatedResponse<TagResponse>;

/** Prefix-wide removal from EVERY ['tags', …] cache (shape-agnostic).
 *  Used in commit as the reconcile safety net — it also catches caches that
 *  appeared or refetched during the undo window (the snapshot-scoped remove
 *  covers only the keys captured at click time). */
function removeTagFromCaches(qc: QueryClient, id: string): void {
  qc.setQueriesData<TagsListCache | undefined>(
    { queryKey: qk.tags },
    (old) =>
      old == null
        ? old
        : (mapRowListCache<TagResponse>(old, (items) =>
            items.filter((t) => t.id !== id),
          ) as TagsListCache),
  );
}

/** Non-fatal invalidation at commit (spec D4): the ['tags'] family only —
 *  no canonical point key (tags have none), no cross-family cascade. */
function invalidateAfterDelete(qc: QueryClient): void {
  invalidateEntities(qc, ['tags']);
}

/** Shared commit body: real DELETE (with the expected-state contract) →
 *  removal reconcile → non-fatal invalidation. Errors propagate to the
 *  PendingActions pipeline (undo/toast handled there). */
async function commitDeferredDelete(
  qc: QueryClient,
  tagId: string,
  payload: ResolveDeleteTagPayload,
  snapshots: RowSnapshot[],
): Promise<void> {
  await resolveDeleteTag(tagId, payload);
  // Reconcile: ensure the captured keys still reflect the deletion even if
  // a mid-window refetch brought the row back.
  tagRowSync.remove(qc, snapshots);
  removeTagFromCaches(qc, tagId);
  try {
    invalidateAfterDelete(qc);
  } catch {
    // Non-fatal (spec D4): server state after 204 is authoritative, undo
    // never resurrects a server-deleted tag; SSE / next load converge.
  }
}

/** Toast shower type derived from the UI context (the hook consumes useUI). */
type ShowToast = ReturnType<typeof useUI>['showToast'];

/** Shared enqueue shape (dedupe/cancel key + 5s window + by-key undo). */
function buildDeferredDeleteAction(
  qc: QueryClient,
  tag: TagResponse,
  payload: ResolveDeleteTagPayload,
  snapshots: RowSnapshot[],
  showToast: ShowToast,
): PendingActionShape {
  const undo = () => tagRowSync.restore(qc, snapshots);
  return {
    id: `delete-tag-${tag.id}`,
    kind: 'delete',
    message: 'Удалено. Отменить',
    delayMs: 5000,
    // Undo (D4): pure by-key restore — no server calls (the dry-run
    // guarantees nothing was deleted during the window), no invalidations.
    undo,
    commit: () => commitDeferredDelete(qc, tag.id, payload, snapshots),
    // D4 family / #286 D7: the shared stale-aware handler parameterized on
    // 'tags' — 409+dependencies → undo + «Не удалось удалить: данные
    // изменились» with the «Обновить» action (['tags'] family); 404 —
    // quiet success; any other error — context-default (undo + red toast).
    onError: staleAwareOnError(qc, 'tags', undo, showToast),
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

export function useDeleteTag() {
  const queryClient = useQueryClient();
  const { showToast } = useUI();
  const { enqueuePendingAction } = usePendingActions();

  /** Clean deferred delete (D5): snapshots → dry-run → optimistic removal →
   *  enqueue (5s undo window; undo restores snapshots by key). */
  const removeTag = useCallback(
    async (tag: TagResponse): Promise<void> => {
      const snapshots = tagRowSync.capture(queryClient, tag.id);
      // Dry-run errors are NEVER intercepted: 409-with-dependencies → the
      // call site opens DeleteDialog (row stays visible); other errors keep
      // their catch/toast surfaces (D5). One thrown ApiError — the single
      // error mechanism of the hook.
      await dryRunDeleteTag(tag.id);
      tagRowSync.remove(queryClient, snapshots);
      enqueuePendingAction(
        buildDeferredDeleteAction(
          queryClient,
          tag,
          { expected: {} },
          snapshots,
          showToast,
        ),
      );
    },
    [queryClient, enqueuePendingAction, showToast],
  );

  /** Cascade deferred delete (D5): same enqueue mechanics, no dry-run —
   *  the DeleteDialog built `resolutions` from the 409 tree it already has.
   *  `expected` carries the id-sets snapshotted from that tree (D6). */
  const removeTagResolved = useCallback(
    async (
      tag: TagResponse,
      resolutions: Record<string, string>,
      dependencies: DependencyNode[],
    ): Promise<void> => {
      const snapshots = tagRowSync.capture(queryClient, tag.id);
      tagRowSync.remove(queryClient, snapshots);
      enqueuePendingAction(
        buildDeferredDeleteAction(
          queryClient,
          tag,
          { resolutions, expected: expectedFromDependencies(dependencies) },
          snapshots,
          showToast,
        ),
      );
    },
    [queryClient, enqueuePendingAction, showToast],
  );

  return { removeTag, removeTagResolved };
}
