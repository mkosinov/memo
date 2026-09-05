'use client';

import React, { useMemo, useState } from 'react';
import { useClientsTable } from '@/contexts/ClientsContext';
import {
  useDeleteClient,
  useArchiveClient,
  useRestoreClient,
  useResolveDeleteClient,
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
  // precedent) — the parked 409 tree lives on this component's delete hook.
  const {
    items, total, page, perPage, sortBy, sortOrder, isLoading, isPending,
    isFetching, error, refetch, setPage, setPerPage, setSort,
  } = useClientsTable();
  const deleteMutation = useDeleteClient();
  const archiveMutation = useArchiveClient();
  const restoreMutation = useRestoreClient();
  const resolveDeleteMutation = useResolveDeleteClient();
  const { dependencies } = deleteMutation;
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

  // ─── Delete — §7.3 dry-run flow ───────────────────────────────────────
  const handleDelete = async (client: ClientWithStats) => {
    try {
      await deleteMutation.mutateAsync(client.id);
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
            await resolveDeleteMutation.mutateAsync({ id, resolutions });
            showToast('Клиент удалён');
          }}
          onArchive={(id) => archiveMutation.mutateAsync(id)}
          onDone={() => setDeleteTarget(null)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
