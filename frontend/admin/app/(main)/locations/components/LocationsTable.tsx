'use client';

import React, { useCallback, useMemo, useState } from 'react';
import type { LocationResponse } from '@memo/api-client';
import { useUpdateLocation, useCreateLocation, useDeleteLocation, useArchiveLocation, useRestoreLocation } from '@/hooks/useLocationsMutations';
import type { LocationUpdate, DependencyNode } from '@memo/api-client';
import { ApiError } from '@memo/api-client';
import { useUI } from '@/contexts/UIContext';
import { useLocationsTable } from '@/contexts/LocationsContext';
import { LocationModal } from './LocationModal';
import { LocationFilters } from './LocationFilters';
import { DataTable } from '@/app/components/shared/DataTable';
import { DeleteDialog } from '@/app/components/DeleteDialog';
import { locationColumns, locationActions } from './locationColumns';
import { parseApiError } from '@/app/lib/api/parseApiError';

// ─── Component ───────────────────────────────────────────────────────────

export function LocationsTable() {
  // Server pagination/sort/search state (LocationsContext, #205 §5.2 + #139 §6.7)
  const locationsTable = useLocationsTable();

  const updateLocation = useUpdateLocation();
  const createLocation = useCreateLocation();
  const { removeLocation, removeLocationResolved } = useDeleteLocation();
  const archiveLocation = useArchiveLocation();
  const restoreLocation = useRestoreLocation();
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
      title: data.title as string,
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

  // ─── Delete (GH #345: deferred conveyor — useDeleteTag/useDeleteRecord
  // template). removeLocation ALWAYS dry-runs (pure preview): a clean 204
  // removes the row optimistically + enqueues the deferred delete (5s undo
  // window, commit = resolveDeleteLocation); a 409 WITH the dependency tree
  // rejects here → park the tree + open DeleteDialog (the row stays
  // visible). The hook swallows 404 (quiet family invalidation) and
  // network/5xx («Не удалось проверить зависимости» toast) — the catch
  // below handles ONLY the 409-with-tree dialog path. Toasts on success
  // come from the pending stack («Удалено. Отменить» with the ring).

  const handleDelete = useCallback(async (loc: LocationResponse) => {
    try {
      await removeLocation(loc);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.dependencies) {
        setDeleteTarget({ location: loc, dependencies: err.dependencies });
        return;
      }
      showToast(parseApiError(err).message, 'error');
    }
  }, [removeLocation, showToast]);

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
          location={editLocation}
          onSubmit={handleEdit}
          onClose={() => setEditLocation(null)}
          title="Редактирование локации"
          subtitle={editLocation.title}
        />
      )}

      {/* Create modal */}
      {creatingLocation && (
        <LocationModal
          location={null}
          onSubmit={handleCreateSubmit}
          onClose={() => setCreatingLocation(false)}
          title="Новая локация"
        />
      )}

      {/* Delete dialog — GH #345: opened on dry-run 409; the confirm
          enqueues the cascade deferred delete (enqueue is synchronous) and
          the dialog closes immediately via onDone. Location matrix (§4.4):
          activities BLOCK (Mode B — archive, the delete branch is
          unreachable); location_tags cascade and photos nullify (Mode A —
          the all-auto tree confirms immediately, commit {resolutions:{},
          expected:{}}). */}
      {deleteTarget && (
        <DeleteDialog
          entityName={deleteTarget.location.title}
          entityType="location"
          entityId={deleteTarget.location.id}
          dependencies={deleteTarget.dependencies}
          onResolve={async (_id, resolutions) => {
            // Enqueue is synchronous — no await, the dialog closes at once.
            void removeLocationResolved(deleteTarget.location, resolutions, deleteTarget.dependencies);
          }}
          onArchive={(id) => archiveLocation.mutateAsync(id)}
          onDone={() => setDeleteTarget(null)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}