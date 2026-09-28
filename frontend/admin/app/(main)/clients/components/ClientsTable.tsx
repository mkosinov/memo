'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useClientsTable } from '@/contexts/ClientsContext';
import {
  useDeleteClient,
  useArchiveClient,
  useRestoreClient,
} from '@/hooks/useClientsMutations';
import { useUI } from '@/contexts/UIContext';
import { DataTable } from '@/app/components/shared/DataTable';
import { DeleteDialog } from '@/app/components/DeleteDialog';
import { clientColumns, clientActions } from './clientColumns';
import { parseApiError } from '@/app/lib/api/parseApiError';
import type { ClientWithStats, DependencyNode } from '@memo/api-client';
import { ApiError } from '@memo/api-client';

interface ClientsTableProps {
  onClientClick: (client: ClientWithStats) => void;
}

export function ClientsTable({ onClientClick }: ClientsTableProps) {
  // GH #140 — table state from the factory context (server-paginated,
  // page-scoped); mutations are local hook instances (LocationsTable
  // precedent) — the parked 409 tree lives on this component's state.
  const {
    items, total, page, perPage, sortBy, sortOrder, isLoading, isPending,
    isFetching, error, refetch, setPage, setPerPage, setSort,
  } = useClientsTable();
  const { removeClient, removeClientResolved } = useDeleteClient();
  const archiveMutation = useArchiveClient();
  const restoreMutation = useRestoreClient();
  const { showToast } = useUI();

  // ─── Delete dialog state (parent owns dry-run + open/close) ──────────
  const [deleteTarget, setDeleteTarget] = useState<{
    client: ClientWithStats;
    dependencies: DependencyNode[];
  } | null>(null);

  // ─── Archive / Restore (#198 parity) ─────────────────────────────────
  const handleArchiveToggle = async (client: ClientWithStats) => {
    try {
      if (client.archived) {
        await restoreMutation.mutateAsync(client.id);
        showToast('Клиент восстановлен');
      } else {
        await archiveMutation.mutateAsync(client.id);
        showToast('Клиент в архиве');
      }
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // ─── Delete — GH #345: deferred conveyor (useDeleteTag/useDeleteRecord
  // template). removeClient ALWAYS dry-runs (pure preview): a clean 204
  // removes the row optimistically + enqueues the deferred delete (5s undo
  // window, commit = resolveDeleteClient); a 409 WITH the dependency tree
  // rejects here → park the tree + open DeleteDialog (the row stays
  // visible). The hook swallows 404 (quiet family invalidation) and
  // network/5xx («Не удалось проверить зависимости» toast) — the catch
  // below handles ONLY the 409-with-tree dialog path. Toasts on success
  // come from the pending stack («Удалено. Отменить» with the ring).
  const handleDelete = useCallback(async (client: ClientWithStats) => {
    try {
      await removeClient(client);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.dependencies) {
        setDeleteTarget({ client, dependencies: err.dependencies });
        return;
      }
      showToast(parseApiError(err).message, 'error');
    }
  }, [removeClient, showToast]);

  // §6.15 — memoize the factory outputs.
  const columns = useMemo(() => clientColumns(), []);
  const actions = useMemo(
    () =>
      clientActions({
        onToggleArchive: (c) => void handleArchiveToggle(c),
        onDelete: (c) => void handleDelete(c),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- §6.15 stable identity
    [handleDelete],
  );

  return (
    <div>
      <DataTable<ClientWithStats>
        storageKey="clients-columns"
        columns={columns}
        tableState={{
          items,
          total,
          page,
          perPage,
          sortBy,
          sortOrder,
          isLoading,
          isPending,
          isFetching,
          error,
          setPage,
          setPerPage,
          setSort,
          refetch,
        }}
        actions={actions}
        onRowClick={onClientClick}
        rowKey={(c) => c.id}
        // Pre-#139 row classes were `border-b hover:bg-gray-50 cursor-pointer
        // group transition-colors`; the shared DataTable renders the base
        // three, the hover variant comes through rowClassName for parity with
        // the old visual baseline.
        rowClassName={() => 'hover:bg-gray-50'}
      />

      {/* Delete dialog — GH #345: opened on dry-run 409; the confirm
          enqueues the cascade deferred delete (enqueue is synchronous) and
          the dialog closes immediately via onDone. Client is the only
          entity with a resolvable commit: records nullify + visitors
          cascade — commit {resolutions, expected} from the FULL tree. */}
      {deleteTarget && (
        <DeleteDialog
          entityName={deleteTarget.client.name || 'Дорогой гость'}
          entityType="client"
          entityId={deleteTarget.client.id}
          dependencies={deleteTarget.dependencies}
          onResolve={async (_id, resolutions) => {
            // Enqueue is synchronous — no await, the dialog closes at once.
            void removeClientResolved(deleteTarget.client, resolutions, deleteTarget.dependencies);
          }}
          onArchive={(id) => archiveMutation.mutateAsync(id)}
          onDone={() => setDeleteTarget(null)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
