'use client';

import React, { useMemo, useState } from 'react';
import { useClients } from '@/contexts/ClientsContext';
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
  // Spec §6.4 — `items` is the new alias; `clients` retained for backwards
  // compat with non-table consumers until they migrate. `error` is now
  // `Error | null` (was `string | null` — stringified error.message).
  const {
    items, total, page, perPage, sortBy, sortOrder, isLoading, isPending,
    isFetching, error, refetch, setPage, setPerPage, setSort, deleteClient,
    archiveClient, restoreClient, resolveDeleteClient, dependencies,
  } = useClients();
  const { showToast } = useUI();

  // ─── Delete dialog state (§7.3: parent owns dry-run + open/close) ────
  const [deleteTarget, setDeleteTarget] = useState<{
    client: ClientWithStats;
    dependencies: DependencyNode[];
  } | null>(null);

  // ─── Archive / Restore (#198 parity) ─────────────────────────────────
  const handleArchiveToggle = async (client: ClientWithStats) => {
    try {
      if (client.archived) {
        await restoreClient(client.id);
        showToast('Клиент восстановлен');
      } else {
        await archiveClient(client.id);
        showToast('Клиент в архиве');
      }
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // ─── Delete — §7.3 dry-run flow ───────────────────────────────────────
  const handleDelete = async (client: ClientWithStats) => {
    try {
      await deleteClient(client.id);
      showToast('Клиент удалён');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const deps = err.dependencies ?? dependencies ?? [];
        if (deps.length > 0) {
          setDeleteTarget({ client, dependencies: deps });
          return;
        }
      }
      showToast(parseApiError(err).message, 'error');
    }
  };

  // §6.15 — memoize the factory outputs.
  const columns = useMemo(() => clientColumns(), []);
  const actions = useMemo(
    () =>
      clientActions({
        onToggleArchive: (c) => void handleArchiveToggle(c),
        onDelete: (c) => void handleDelete(c),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- §6.15 stable identity
    [],
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

      {/* Delete dialog — §7.3: opened on dry-run 409, closed on done/cancel */}
      {deleteTarget && (
        <DeleteDialog
          entityName={deleteTarget.client.name || 'Дорогой гость'}
          entityType="client"
          entityId={deleteTarget.client.id}
          dependencies={deleteTarget.dependencies}
          onResolve={async (id, resolutions) => {
            await resolveDeleteClient(id, resolutions);
            showToast('Клиент удалён');
          }}
          onArchive={(id) => archiveClient(id)}
          onDone={() => setDeleteTarget(null)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
