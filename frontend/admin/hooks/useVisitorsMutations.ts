'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { dryRunDeleteVisitor, resolveDeleteVisitor } from '@memo/api-client';
import type {
  DependencyNode,
  ResolveDeleteVisitorPayload,
  VisitorResponse,
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

// ── #324 Task 8 deferred visitor delete (spec §6) — mirrors useDeleteTag
// (#318) / useDeletePhoto (T7) ──────────────────────────────────────────────
//
// Both entry points are NON-BLOCKING deferred actions: the row disappears
// optimistically, the user gets a 5s undo window, the real DELETE runs in
// commit — carrying the `expected` state snapshot so the backend answers
// 409 `stale_dependencies` on a mid-window race (§9.4).
//
// - `removeVisitor` — clean path: item-level snapshots → dry-run
//   `?dry_run=true` (pure preview; 409 + the visits/visitor_tags tree
//   REJECTS upward — the call site opens DeleteDialog «Посещения: N будут
//   удалены»; any other error also propagates) → optimistic row removal →
//   enqueue with commit = resolveDeleteVisitor(id, {expected: {}}) — a
//   visit-less visitor behaves as a leaf.
// - `removeVisitorResolved` — cascade path after DeleteDialog confirmation:
//   no dry-run (the tree is already in hand); `expected` id-sets are built
//   from the tree's `items` for BOTH groups — {visits: [...], visitor_tags:
//   [...]} (the executor deletes both: the visits batch WITH the record
//   seats/status recompute + the visitor_tags join strip); dialog closes
//   immediately (enqueue is sync).
//
// Cache family: ONE row family — ['visitors', clientId] bare arrays (the
// useRecordData/ClientInfoTab readers; qk.visitors prefix). The UNDO is an
// item-level snapshot restore over that family (no server calls).
//
// Invalidation family (spec §6): ['records', 'clients'] — routed through
// the shared #239 map: records → ['records'] + ['visitorsList']; clients →
// ['clients'] + ['records'] (dedup). The visits cascade recomputes record
// statuses/seats (['records'] view rows + list caches converge) and the
// client stats/visitors count (['clients']). The ['visitors'] family rides
// the records entry of the map — the restored row's own family converges.
//
// Error surface (D4 family): dry-run errors are never intercepted
// (409-with-tree rejects upward to the call site); COMMIT errors go through
// the PendingActions pipeline — 404 = quiet success, the shared stale-aware
// handler owns every other failure. Invalidation failures inside commit are
// non-fatal: the screen converges via SSE / next load.

/** Snapshot mechanics over the ['visitors', …] family (bare per-client
 *  arrays — the qk.visitors(clientId) shape; the shared factory is
 *  shape-agnostic, so a future envelope needs no change here). */
const visitorRowSync = createRowSnapshotSync(qk.visitorsList);

/** expected = id-sets per entity from the dialog tree's `items` (D6).
 *  Visitor trees carry items on BOTH nodes — visits (non-auto) and
 *  visitor_tags (auto, join rows). Nodes without items are skipped
 *  (defensive — mirrors the tags hook). */
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

/** Visitors cache shape: per-client bare arrays. */
type VisitorsListCache = VisitorResponse[];

/** Prefix-wide removal from EVERY ['visitors', …] cache (shape-agnostic).
 *  Used in commit as the reconcile safety net — it also catches caches that
 *  appeared or refetched during the undo window (other clients' lists are
 *  untouched — the row never lived there). */
function removeVisitorFromCaches(qc: QueryClient, id: string): void {
  qc.setQueriesData<VisitorsListCache | undefined>(
    { queryKey: qk.visitorsList },
    (old) =>
      old == null
        ? old
        : (mapRowListCache<VisitorResponse>(old, (items) =>
            items.filter((v) => v.id !== id),
          ) as VisitorsListCache),
  );
}

/** Non-fatal invalidation at commit (spec §6): the ['records','clients']
 *  family union via the shared #239 map (see the header note — ['visitors']
 *  rides the records entry). */
function invalidateAfterDelete(qc: QueryClient): void {
  invalidateEntities(qc, ['records', 'clients']);
}

/** Shared commit body: real DELETE (with the expected-state contract) →
 *  removal reconcile → non-fatal invalidation. Errors propagate to the
 *  PendingActions pipeline (undo/toast handled there). */
async function commitDeferredDelete(
  qc: QueryClient,
  visitorId: string,
  payload: ResolveDeleteVisitorPayload,
  snapshots: RowSnapshot[],
): Promise<void> {
  await resolveDeleteVisitor(visitorId, payload);
  // Reconcile: ensure the captured keys still reflect the deletion even if
  // a mid-window refetch brought the row back.
  visitorRowSync.remove(qc, snapshots);
  removeVisitorFromCaches(qc, visitorId);
  try {
    invalidateAfterDelete(qc);
  } catch {
    // Non-fatal: server state after 204 is authoritative, undo never
    // resurrects a server-deleted visitor; SSE / next load converge.
  }
}

/** Toast shower type derived from the UI context (the hook consumes useUI). */
type ShowToast = ReturnType<typeof useUI>['showToast'];

/** Shared enqueue shape (dedupe/cancel key + 5s window + by-key undo). */
function buildDeferredDeleteAction(
  qc: QueryClient,
  visitor: VisitorResponse,
  payload: ResolveDeleteVisitorPayload,
  snapshots: RowSnapshot[],
  showToast: ShowToast,
): PendingActionShape {
  const undo = () => visitorRowSync.restore(qc, snapshots);
  return {
    id: `delete-visitor-${visitor.id}`,
    kind: 'delete',
    message: 'Удалено. Отменить',
    delayMs: 5000,
    // Undo: pure by-key restore — no server calls (the dry-run guarantees
    // nothing was deleted during the window), no invalidations.
    undo,
    commit: () => commitDeferredDelete(qc, visitor.id, payload, snapshots),
    // D4 family / #286 D7: the shared stale-aware handler parameterized on
    // 'records' (an INVALIDATION_MAP key whose family converges the whole
    // affected surface — records + visitors + clients via the map union).
    // 409+dependencies → undo + honest stale toast with the «Обновить»
    // action; 404 — quiet success; any other error — context-default
    // (undo + red toast).
    onError: staleAwareOnError(qc, 'records', undo, showToast),
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

/**
 * Deferred visitor delete (#324 Task 8, spec §6/§9.3/§9.4). Entity-level
 * (not record-scoped): consumed by BOTH surfaces — ClientRecordTab (the
 * record modal) and ClientInfoTab (the client card) — the two former
 * instant `deleteVisitor` call sites.
 */
export function useDeleteVisitor() {
  const queryClient = useQueryClient();
  const { showToast } = useUI();
  const { enqueuePendingAction } = usePendingActions();

  /** Clean deferred delete: snapshots → dry-run → optimistic removal →
   *  enqueue (5s undo window; undo restores snapshots by key). */
  const removeVisitor = useCallback(
    async (visitor: VisitorResponse): Promise<void> => {
      const snapshots = visitorRowSync.capture(queryClient, visitor.id);
      // Dry-run errors are NEVER intercepted: 409-with-dependencies → the
      // call site opens DeleteDialog (row stays visible); other errors keep
      // their catch/toast surfaces. One thrown ApiError — the single error
      // mechanism of the hook.
      await dryRunDeleteVisitor(visitor.id);
      visitorRowSync.remove(queryClient, snapshots);
      enqueuePendingAction(
        buildDeferredDeleteAction(
          queryClient,
          visitor,
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
   *  `expected` carries BOTH groups' id-sets snapshotted from that tree
   *  (visits + visitor_tags — D6, the executor deletes both). */
  const removeVisitorResolved = useCallback(
    async (
      visitor: VisitorResponse,
      resolutions: Record<string, string>,
      dependencies: DependencyNode[],
    ): Promise<void> => {
      const snapshots = visitorRowSync.capture(queryClient, visitor.id);
      visitorRowSync.remove(queryClient, snapshots);
      enqueuePendingAction(
        buildDeferredDeleteAction(
          queryClient,
          visitor,
          { resolutions, expected: expectedFromDependencies(dependencies) },
          snapshots,
          showToast,
        ),
      );
    },
    [queryClient, enqueuePendingAction, showToast],
  );

  return { removeVisitor, removeVisitorResolved };
}
