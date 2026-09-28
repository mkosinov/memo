'use client';

import React, { useCallback, useMemo, useState } from 'react';
import type { ServiceResponse, ServiceUpdate, DependencyNode } from '@memo/api-client';
import { ApiError } from '@memo/api-client';
import { useUpdateService, useCreateService, useDeleteService, useArchiveService, useRestoreService } from '@/hooks/useServicesMutations';
import { useUI } from '@/contexts/UIContext';
import { useAuth } from '@/contexts/AuthContext';
import { useServicesTable } from '@/contexts/ServicesContext';
import { useMaterialsRaw } from '@/hooks/useMaterials';
import { ServiceModal } from './ServiceModal';
import { ServiceFilters } from './ServiceFilters';
import { DataTable } from '@/app/components/shared/DataTable';
import { DeleteDialog } from '@/app/components/DeleteDialog';
import { serviceColumns, serviceActions } from './serviceColumns';
import { parseApiError } from '@/app/lib/api/parseApiError';

// ─── Component ────────────────────────────────────────────────────────────

export function ServicesTable() {
  // Server pagination/sort/search state (ServicesContext, #205 §5.2 + #139 §6.7)
  const servicesTable = useServicesTable();
  // GH #263 T9 — permission gates: services:write hides create/edit
  // affordances, materials:read hides the materials surface (filter select +
  // modal picker). The backend is the enforcement point; this only keeps the
  // master's UI honest (no dead buttons).
  const { can } = useAuth();
  const canWriteServices = can('services:write');
  const canReadMaterials = can('materials:read');
  // GH #223 T7 — ACTIVE materials feed the «Материал» filter select
  // (spec §8; source: getAllMaterials /all?status=active, same as the
  // ServiceModal picker — REUSE the Task 5 hook). Without materials:read the
  // query never mounts (master has no token for it — a fetch would just 403).
  const { data: materials = [] } = useMaterialsRaw(canReadMaterials);

  const updateService = useUpdateService();
  const createService = useCreateService();
  const { removeService, removeServiceResolved } = useDeleteService();
  const archiveService = useArchiveService();
  const restoreService = useRestoreService();
  const { showToast } = useUI();

  // ─── Edit modal state ───────────────────────────────────────────────
  const [editingService, setEditingService] = useState<ServiceResponse | null>(null);

  // ─── Create modal state ─────────────────────────────────────────────
  const [creatingService, setCreatingService] = useState(false);

  // ─── Delete dialog state (§7.3: parent owns dry-run + open/close) ────
  const [deleteTarget, setDeleteTarget] = useState<{
    service: ServiceResponse;
    dependencies: DependencyNode[];
  } | null>(null);

  // ─── Edit handler ───────────────────────────────────────────────────

  const handleEditSubmit = async (data: Record<string, unknown>) => {
    if (!editingService) return;
    // Canonical PUT (GH #178): full typed ServiceUpdate — every field listed.
    // #207: the Update schema carries no archive flag — archive/restore goes
    // through POST /services/{id}/archive|restore, so PUT never flips it.
    // #223 T5/T13: the form sends `materials` (checkbox multi-list state →
    // {material_id, note?}[] in ServiceModal's handleSubmit) — PUT hard-replaces
    // the links. `material_hint` is retired everywhere (Task 13, spec §10).
    const payload = {
      title: data.title as string,
      description: (data.description as string | null | undefined) ?? '',
      image_url: (data.image_url as string | null | undefined) ?? '',
      specialty: (data.specialty as string | null | undefined) ?? '',
      min_age: (data.min_age as number | null | undefined) ?? 0,
      // GH #203: no coercion — an empty «Возраст до» is `null` = «без
      // ограничения»; the server schema is int | None.
      max_age: (data.max_age as number | null | undefined) ?? null,
      duration: data.duration as number,
      record_info: (data.record_info as string | null | undefined) ?? '',
      tariffs: (data.tariffs as ServiceUpdate['tariffs'] | undefined) ?? [],
      tag_ids: (data.tag_ids as string[] | undefined) ?? [],
      materials: (data.materials as ServiceUpdate['materials'] | undefined) ?? [],
    } as ServiceUpdate;
    try {
      await updateService.mutateAsync({ id: editingService.id, data: payload });
      showToast('Услуга обновлена');
      setEditingService(null);
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // ─── Archive / Restore ──────────────────────────────────────────────
  // #207: dedicated POST endpoints; label and action drive off `row.archived`
  // (inverted response field).

  const handleArchiveToggle = async (service: ServiceResponse) => {
    try {
      if (service.archived) {
        await restoreService.mutateAsync(service.id);
        showToast('Услуга восстановлена');
      } else {
        await archiveService.mutateAsync(service.id);
        showToast('Услуга в архиве');
      }
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  const handleCreateSubmit = async (data: Record<string, unknown>) => {
    try {
      await createService.mutateAsync(data as never);
      showToast('Услуга создана');
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // ─── Delete (GH #345: deferred conveyor — useDeleteTag/useDeleteRecord
  // template). removeService ALWAYS dry-runs (pure preview): a clean 204
  // removes the row optimistically + enqueues the deferred delete (5s undo
  // window, commit = resolveDeleteService); a 409 WITH the dependency tree
  // rejects here → park the tree + open DeleteDialog (the row stays
  // visible). The hook swallows 404 (quiet family invalidation) and
  // network/5xx («Не удалось проверить зависимости» toast) — the catch
  // below handles ONLY the 409-with-tree dialog path. Toasts on success
  // come from the pending stack («Удалено. Отменить» with the ring).

  const handleDelete = useCallback(async (s: ServiceResponse) => {
    try {
      await removeService(s);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.dependencies) {
        setDeleteTarget({ service: s, dependencies: err.dependencies });
        return;
      }
      showToast(parseApiError(err).message, 'error');
    }
  }, [removeService, showToast]);

  // §6.15 — memoize the factory outputs
  const columns = useMemo(() => serviceColumns(), []);
  const actions = useMemo(
    () =>
      serviceActions({
        onToggleArchive: (s) => void handleArchiveToggle(s),
        onDelete: (s) => void handleDelete(s),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- §6.15 stable identity
    [],
  );

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div>
      <DataTable<ServiceResponse>
        storageKey="services-columns"
        columns={columns}
        tableState={servicesTable}
        actions={actions}
        // GH #263 T9: without services:write the list is read-only — row
        // click opens nothing (no dead edit modal behind a 403).
        onRowClick={canWriteServices ? setEditingService : undefined}
        rowKey={(s) => s.id}
        // Pre-#139 row classes were `border-b cursor-pointer transition-colors
        // hover:opacity-80`; the shared DataTable renders the base three, the
        // hover style is entity-parity and comes through rowClassName.
        rowClassName={() => 'hover:opacity-80'}
        // Addendum #9: the dict *Filters bar rides in the toolbar's left group —
        // search rewired to context search/setSearch (§6.7 predicate-only),
        // status select already context-wired; bar UI/markup untouched.
        // GH #263 T9: the «Материал» filter needs materials:read — hidden
        // otherwise (master's token list carries no materials:read; a fetch
        // would just 403). The props stay undefined → ServiceFilters omits
        // the select.
        toolbarLead={
          <ServiceFilters
            search={servicesTable.search}
            status={servicesTable.status}
            onSearchChange={servicesTable.setSearch}
            onStatusChange={(v) => servicesTable.setStatus(v as 'active' | 'all' | 'archived')}
            onReset={() => { servicesTable.setSearch(''); servicesTable.setStatus('active'); servicesTable.resetFilters(); }}
            materials={canReadMaterials ? materials : undefined}
            materialFilter={canReadMaterials ? servicesTable.filters.material_id : undefined}
            onMaterialFilterChange={canReadMaterials ? (v) => servicesTable.setFilters({ material_id: v }) : undefined}
          />
        }
        toolbarExtras={
          canWriteServices ? (
            <button
              onClick={() => setCreatingService(true)}
              className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              + Добавить услугу
            </button>
          ) : null
        }
      />

      {/* Edit Modal — GH #263 T9: only reachable WITH services:write (row
          click is gated above), so no read-only rendering is needed here. */}
      {editingService && canWriteServices && (
        <ServiceModal
          service={editingService}
          onSubmit={handleEditSubmit}
          onClose={() => setEditingService(null)}
          title="Редактировать услугу"
          subtitle={editingService.title}
        />
      )}

      {/* Create Modal */}
      {creatingService && canWriteServices && (
        <ServiceModal
          service={null}
          onSubmit={handleCreateSubmit}
          onClose={() => setCreatingService(false)}
          title="Новая услуга"
        />
      )}

      {/* Delete dialog — GH #345: opened on dry-run 409; the confirm
          enqueues the cascade deferred delete (enqueue is synchronous) and
          the dialog closes immediately via onDone. Service matrix (§4.4):
          activities BLOCK (Mode B — archive, the delete branch is
          unreachable); tariffs, photos, service_tags and service_materials
          auto-cascade (Mode A — the all-auto tree confirms immediately,
          commit {resolutions:{}, expected:{}}). */}
      {deleteTarget && (
        <DeleteDialog
          entityName={deleteTarget.service.title}
          entityType="service"
          entityId={deleteTarget.service.id}
          dependencies={deleteTarget.dependencies}
          onResolve={async (_id, resolutions) => {
            // Enqueue is synchronous — no await, the dialog closes at once.
            void removeServiceResolved(deleteTarget.service, resolutions, deleteTarget.dependencies);
          }}
          onArchive={(id) => archiveService.mutateAsync(id)}
          onDone={() => setDeleteTarget(null)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
