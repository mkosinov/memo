'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import {
  createClient,
  updateClient,
  archiveClient,
  restoreClient,
  dryRunDeleteClient,
  resolveDeleteClient,
  ApiError,
} from '@memo/api-client';
import type {
  ClientCreate,
  ClientUpdate,
  ClientResponse,
  ClientWithStats,
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
import { invalidateEntities, invalidateEntitiesAsync } from '@/lib/invalidate';
import { staleAwareOnError } from '@/lib/staleAwareOnError';
import { qk } from '@/lib/queryKeys';

/**
 * Shared success handler (GH #140): every client mutation invalidates BOTH
 * lists — the clients table AND the records prefix, because records rows are
 * composite view rows carrying denormalized client name/phone (spec §6.3).
 * Awaiting is the pre-existing #140 contract: mutateAsync().then() must
 * resolve only after the refetches land. Routed through the shared
 * invalidation map's awaitable variant (#239) — same family pair.
 */
const useInvalidateClients = () => {
  const queryClient = useQueryClient();
  return async () => {
    await invalidateEntitiesAsync(queryClient, ['clients']);
  };
};

export function useCreateClient() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (data: ClientCreate) => createClient(data),
    onSuccess: invalidate,
  });
}

export function useUpdateClient() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ClientUpdate }) => updateClient(id, data),
    onSuccess: invalidate,
  });
}


// ── #345 Task 6: deferred client delete — the useDeleteTag (#318) /
// useDeleteRecord (#285) conveyor ──────────────────────────────────────────
//
// Both entry points are NON-BLOCKING deferred actions: the row disappears
// optimistically, the user gets a 5s undo window, the real DELETE runs in
// commit — carrying the `expected` state snapshot so the backend answers
// 409 `stale_dependencies` on a mid-window race.
//
// - `removeClient` — clean path: item-level snapshots → dry-run
//   `?dry_run=true` (pure preview; 409 + dependency tree REJECTS upward —
//   the call site parks the tree + opens DeleteDialog) → optimistic row
//   removal → enqueue with `commit = resolveDeleteClient(id, {expected: {}})`.
// - `removeClientResolved` — cascade path after DeleteDialog confirmation:
//   no dry-run (the tree is already in hand); `expected` id-sets are built
//   from the FULL tree via the shared expectedFromDependencies (the render
//   caps item lines at 10 + «и ещё N» — the payload carries EVERY id); the
//   dialog closes immediately (enqueue is sync). Client is the only entity
//   with a resolvable commit (§4.4): records nullify + visitors cascade.
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
// with «Обновить» invalidating the clients family); any other error → undo +
// generic error toast. Invalidation failures inside commit are non-fatal:
// the screen converges via SSE / next load.
//
// Invalidation union at commit: family map (#239: ['clients'] + ['records'])
// PLUS the client modal's point key ['client', id] layered ON TOP (§4.1 —
// the modal's own query is not prefix-covered; ClientCardModal wiring).

/** Snapshot mechanics over the ['clients', …] family (ClientsContext paged
 *  envelope — factory key ['clients', page, perPage, filters, sort]). */
const clientRowSync = createRowSnapshotSync(qk.clients);

/** Client cache shape: paged envelope ({items,…} — ClientsContext factory)
 *  or a plain-array lookup list. Shape-agnostic via mapRowListCache. */
type ClientsListCache = ClientResponse[] | PaginatedResponse<ClientResponse>;

/** Prefix-wide removal from EVERY ['clients', …] cache (shape-agnostic).
 *  Used in commit as the reconcile safety net — it also catches caches that
 *  appeared or refetched during the undo window. */
function removeClientFromCaches(qc: QueryClient, id: string): void {
  qc.setQueriesData<ClientsListCache | undefined>(
    { queryKey: qk.clients },
    (old) =>
      old == null
        ? old
        : (mapRowListCache<ClientResponse>(old, (items) =>
            items.filter((c) => c.id !== id),
          ) as ClientsListCache),
  );
}

/** Non-fatal invalidation at commit (spec §5.2): family map via the shared
 *  #239 map (['clients'] + ['records']) + the modal's point key only this
 *  hook knows (§4.1: id → hook). */
function invalidateAfterDelete(qc: QueryClient, id: string): void {
  invalidateEntities(qc, ['clients']);
  qc.invalidateQueries({ queryKey: qk.client(id) });
}

/** Payload type for the execute path — `expected` is mandatory on the new
 *  contract (T5), resolutions optional (the clean path sends only expected). */
type ResolveDeleteClientPayload = {
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
 *  removal reconcile → non-fatal invalidations. Errors propagate to the
 *  PendingActions pipeline (undo/toast handled there). */
async function commitDeferredDelete(
  qc: QueryClient,
  clientId: string,
  payload: ResolveDeleteClientPayload,
  snapshots: RowSnapshot[],
): Promise<void> {
  await resolveDeleteClient(clientId, payload);
  // Reconcile: ensure the captured keys still reflect the deletion even if
  // a mid-window refetch brought the row back.
  clientRowSync.remove(qc, snapshots);
  removeClientFromCaches(qc, clientId);
  try {
    invalidateAfterDelete(qc, clientId);
  } catch {
    // Non-fatal: server state after 204 is authoritative, undo never
    // resurrects a server-deleted client; SSE / next load converge.
  }
}

/** Shared enqueue shape (dedupe/cancel key + 5s window + by-key undo). */
function buildDeferredDeleteAction(
  qc: QueryClient,
  client: Pick<ClientWithStats, 'id'>,
  payload: ResolveDeleteClientPayload,
  snapshots: RowSnapshot[],
  showToast: ShowToast,
): PendingActionShape {
  const undo = () => clientRowSync.restore(qc, snapshots);
  return {
    id: `delete-client-${client.id}`,
    kind: 'delete',
    message: 'Удалено. Отменить',
    delayMs: 5000,
    // Undo (§5.2): pure by-key restore — no server calls (the dry-run
    // guarantees nothing was deleted during the window), no invalidations.
    undo,
    commit: () => commitDeferredDelete(qc, client.id, payload, snapshots),
    // Commit failures: 409+dependencies → undo + «Не удалось удалить:
    // данные изменились» with the «Обновить» action (clients family);
    // 404 — quiet success; any other error — context-default (undo + toast).
    onError: staleAwareOnError(qc, 'clients', undo, showToast),
  };
}

/**
 * Deferred hard delete (GH #345): dry-run preview → optimistic removal →
 * 5s undo window → commit `resolveDeleteClient({expected, resolutions?})`.
 * Each consumer owns its hook instance (LocationsTable precedent) — the
 * in-flight guard is local to the button that rendered it.
 */
export function useDeleteClient() {
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
  const removeClient = useCallback(
    async (client: ClientWithStats): Promise<void> => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setIsPending(true);
      try {
        const snapshots = clientRowSync.capture(queryClient, client.id);
        // Dry-run errors: 409-with-dependencies REJECTS upward (the call
        // site parks the tree + opens DeleteDialog — the row stays
        // visible). 404 → quiet family invalidation; network/5xx →
        // «Не удалось проверить зависимости» toast (§5.3) — both swallowed.
        try {
          await dryRunDeleteClient(client.id);
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            invalidateEntities(queryClient, ['clients']);
            return;
          }
          if (!(err instanceof ApiError && err.status === 409 && err.dependencies)) {
            showToast('Не удалось проверить зависимости', 'error');
            return;
          }
          throw err;
        }
        clientRowSync.remove(queryClient, snapshots);
        enqueuePendingAction(
          buildDeferredDeleteAction(
            queryClient,
            client,
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
   *  `expected` carries the id-sets snapshotted from that FULL tree (§5.2). */
  const removeClientResolved = useCallback(
    async (
      client: ClientWithStats,
      resolutions: Record<string, string>,
      dependencies: DependencyNode[],
    ): Promise<void> => {
      const snapshots = clientRowSync.capture(queryClient, client.id);
      clientRowSync.remove(queryClient, snapshots);
      enqueuePendingAction(
        buildDeferredDeleteAction(
          queryClient,
          client,
          { resolutions, expected: expectedFromDependencies(dependencies) },
          snapshots,
          showToast,
        ),
      );
    },
    [queryClient, enqueuePendingAction, showToast],
  );

  return { removeClient, removeClientResolved, isPending };
}

/** Archive a client (#207). */
export function useArchiveClient() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (id: string) => archiveClient(id),
    onSuccess: invalidate,
  });
}

/** Restore an archived client (#207). */
export function useRestoreClient() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (id: string) => restoreClient(id),
    onSuccess: invalidate,
  });
}
