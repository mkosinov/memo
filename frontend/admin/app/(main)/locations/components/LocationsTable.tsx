'use client';

import React, { useMemo, useState } from 'react';
import type { LocationResponse } from '@memo/api-client';
import { useUpdateLocation, useCreateLocation, useDeleteLocation, useArchiveLocation, useRestoreLocation } from '@/hooks/useLocationsMutations';
import type { LocationUpdate, DependencyNode } from '@memo/api-client';
import { resolveDeleteLocation, ApiError } from '@memo/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useUI } from '@/contexts/UIContext';
import { useLocationsTable } from '@/contexts/LocationsContext';
import { LocationModal } from './LocationModal';
import { LocationFilters } from './LocationFilters';
import { DataTable } from '@/app/components/shared/DataTable';
import { DeleteDialog } from '@/app/components/DeleteDialog';
import { locationColumns, locationActions } from './locationColumns';
import { parseApiError } from '@/app/lib/api/parseApiError';
import { invalidateEntities } from '@/lib/invalidate';

// ─── Component ───────────────────────────────────────────────────────────

export function LocationsTable() {
  // Server pagination/sort/search state (LocationsContext, #205 §5.2 + #139 §6.7)
  const locationsTable = useLocationsTable();

  const updateLocation = useUpdateLocation();
  const createLocation = useCreateLocation();
  const deleteLocation = useDeleteLocation();
  const archiveLocation = useArchiveLocation();
  const restoreLocation = useRestoreLocation();
  const queryClient = useQueryClient();
  const { showToast } = useUI();

  // ─── Edit modal state ────────────────────────────────────────────────
  const [editLocation, setEditLocation] = useState<LocationResponse | null>(null);

  // ─── Create modal state ─────────────────────────────────────────────
  const [creatingLocation, setCreatingLocation] = useState(false);

  // ─── Delete dialog state (§7.3: parent owns dry-run + open/close) ────
  const [deleteTarget, setDeleteTarget] = useState<{
    location: LocationResponse;
    dependencies: DependencyNode[];
  } | null>(null);

  // ─── Edit handlers ───────────────────────────────────────────────────

  const handleEdit = async (data: Record<string, unknown>) => {
    if (!editLocation) return;
    // Canonical PUT (GH #178): every LocationUpdate field listed — tsc fails on
    // missing/extra fields. Form values are untyped → per-field extraction;
    // null optionals coerce to the Create default (backend does the same).
    // #207: the Update schema carries no archive flag — archive/restore goes
    // through POST /locations/{id}/archive|restore, so PUT never flips it.
    const payload: LocationUpdate = {
      name: data.name as string,
      short_title: (data.short_title as string | null | undefined) ?? '',
      address: (data.address as string | null | undefined) ?? '',
      description: (data.description as string | null | undefined) ?? '',
      capacity: data.capacity as number,
      yandex_map_url: (data.yandex_map_url as string | null | undefined) ?? '',
      review_url: (data.review_url as string | null | undefined) ?? '',
      record_info: (data.record_info as string | null | undefined) ?? '',
      image_url: (data.image_url as string | null | undefined) ?? '',
      location_hint: (data.location_hint as string | null | undefined) ?? '',
      tag_ids: (data.tag_ids as string[] | undefined) ?? [],
    };
    try {
      await updateLocation.mutateAsync({
        id: editLocation.id,
        data: payload,
      });
      showToast('Локация обновлена');
      setEditLocation(null);
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // ─── Archive / Restore ───────────────────────────────────────────────
  // #207: dedicated POST endpoints. Label and action drive off
  // `row.archived` (inverted response field).

  const handleArchiveToggle = async (loc: LocationResponse) => {
    try {
      if (loc.archived) {
        await restoreLocation.mutateAsync(loc.id);
        showToast('Локация восстановлена');
      } else {
        await archiveLocation.mutateAsync(loc.id);
        showToast('Локация архивирована');
      }
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  const handleCreateSubmit = async (data: Record<string, unknown>) => {
    const payload: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(data)) {
      if (val !== null && val !== undefined) {
        payload[key] = val;
      }
    }
    try {
      await createLocation.mutateAsync(payload as never);
      showToast('Локация создана');
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // ─── Delete ─────────────────────────────────────────────────────────
  // #207 §7.3 dry-run flow: no-body DELETE → 204 (instant delete, no deps)
  // or 409 + dependency tree → DeleteDialog (Mode A/B). The parent owns the
  // call + open/close state; the dialog receives the parsed tree.

  const handleDelete = async (loc: LocationResponse) => {
    try {
      await deleteLocation.mutateAsync(loc.id);
      // 204 — already deleted (zero deps): refresh handled by the hook.
      showToast('Локация удалена');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.dependencies) {
        setDeleteTarget({ location: loc, dependencies: err.dependencies });
      } else {
        showToast(parseApiError(err).message, 'error');
      }
    }
  };

  // §6.15 — memoize the factory outputs
  const columns = useMemo(() => locationColumns(), []);
  const actions = useMemo(
    () =>
      locationActions({
        onToggleArchive: (loc) => void handleArchiveToggle(loc),
        onDelete: (loc) => void handleDelete(loc),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- §6.15 stable identity
    [],
  );

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div>
      <DataTable<LocationResponse>
        storageKey="locations-columns"
        columns={columns}
        tableState={locationsTable}
        actions={actions}
        onRowClick={setEditLocation}
        rowKey={(l) => l.id}
        rowTestId={(l) => `location-row-${l.id}`}
        // Pre-#139 row classes were `border-b cursor-pointer transition-colors
        // hover:opacity-80`; the shared DataTable renders the base three, the
        // hover style is entity-parity and comes through rowClassName.
        rowClassName={() => 'hover:opacity-80'}
        // Addendum #10: the pre-#139 actions cell carried an inline 🗺 Карта
        // link next to the ⋯ trigger (old LocationsTable.tsx:377-390) — the
        // DataTable actions cell renders the dropdown only, so the link rides
        // through this per-row seam. Rendered only when the URL exists.
        actionCellExtra={(l) =>
          l.yandex_map_url ? (
            <a
              href={l.yandex_map_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs transition-colors"
              style={{ color: 'var(--brand)' }}
              aria-label="Карта"
              onClick={(e) => e.stopPropagation()}
            >
              🗺
            </a>
          ) : null
        }
        // Addendum #9: the dict *Filters bar rides in the toolbar's left group —
        // search rewired to context search/setSearch (§6.7 predicate-only),
        // status select already context-wired; bar UI/markup untouched.
        toolbarLead={
          <LocationFilters
            search={locationsTable.search}
            status={locationsTable.status}
            onSearchChange={locationsTable.setSearch}
            onStatusChange={(v) => locationsTable.setStatus(v as 'active' | 'all' | 'archived')}
            onReset={() => { locationsTable.setSearch(''); locationsTable.setStatus('active'); }}
          />
        }
        toolbarExtras={
          <button
            onClick={() => setCreatingLocation(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            + Добавить локацию
          </button>
        }
      />

      {/* Edit modal */}
      {editLocation && (
        <LocationModal
          mode="edit"
          location={editLocation}
          onSubmit={handleEdit}
          onClose={() => setEditLocation(null)}
          title="Редактирование локации"
          subtitle={editLocation.name}
        />
      )}

      {/* Create modal */}
      {creatingLocation && (
        <LocationModal
          mode="create"
          location={null}
          onSubmit={handleCreateSubmit}
          onClose={() => setCreatingLocation(false)}
          title="Новая локация"
        />
      )}

      {/* Delete dialog — §7.3: opened on dry-run 409, closed on done/cancel */}
      {deleteTarget && (
        <DeleteDialog
          entityName={deleteTarget.location.name}
          entityType="location"
          entityId={deleteTarget.location.id}
          dependencies={deleteTarget.dependencies}
          onResolve={async (id, resolutions) => {
            await resolveDeleteLocation(id, resolutions);
            // The resolve call bypasses the hook's onSuccess, so refresh
            // here — incl. cross-key ['records'] (useRecordData consumers).
            // Family rules via the shared map (#239): ['locations'] + ['records'].
            invalidateEntities(queryClient, ['locations']);
            showToast('Локация удалена');
          }}
          onArchive={(id) => archiveLocation.mutateAsync(id)}
          onDone={() => setDeleteTarget(null)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}