'use client';

import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ServiceResponse, ServiceUpdate, DependencyNode } from '@memo/api-client';
import { resolveDeleteService, ApiError } from '@memo/api-client';
import { useUpdateService, useCreateService, useDeleteService, useArchiveService, useRestoreService } from '@/hooks/useServicesMutations';
import { useUI } from '@/contexts/UIContext';
import { useServicesTable } from '@/contexts/ServicesContext';
import { useMaterialsRaw } from '@/hooks/useMaterials';
import { ServiceModal } from './ServiceModal';
import { ServiceFilters } from './ServiceFilters';
import { DataTable } from '@/app/components/shared/DataTable';
import { DeleteDialog } from '@/app/components/DeleteDialog';
import { serviceColumns, serviceActions } from './serviceColumns';
import { parseApiError } from '@/app/lib/api/parseApiError';
import { invalidateEntities } from '@/lib/invalidate';

// ─── Component ────────────────────────────────────────────────────────────

export function ServicesTable() {
  // Server pagination/sort/search state (ServicesContext, #205 §5.2 + #139 §6.7)
  const servicesTable = useServicesTable();
  // GH #223 T7 — ACTIVE materials feed the «Материал» filter select
  // (spec §8; source: getAllMaterials /all?status=active, same as the
  // ServiceModal picker — REUSE the Task 5 hook).
  const { data: materials = [] } = useMaterialsRaw();

  const updateService = useUpdateService();
  const createService = useCreateService();
  const deleteService = useDeleteService();
  const archiveService = useArchiveService();
  const restoreService = useRestoreService();
  const queryClient = useQueryClient();
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
      max_age: (data.max_age as number | null | undefined) ?? 18,
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

  // ─── Delete ─────────────────────────────────────────────────────────
  // #207 §7.3 dry-run flow: no-body DELETE → 204 (instant delete, no deps)
  // or 409 + dependency tree → DeleteDialog (Mode A/B). The parent owns the
  // call + open/close state; the dialog receives the parsed tree.

  const handleDelete = async (service: ServiceResponse) => {
    try {
      await deleteService.mutateAsync(service.id);
      // 204 — already deleted (zero deps): refresh handled by the hook.
      showToast('Услуга удалена');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.dependencies) {
        setDeleteTarget({ service, dependencies: err.dependencies });
      } else {
        showToast(parseApiError(err).message, 'error');
      }
    }
  };

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
        onRowClick={setEditingService}
        rowKey={(s) => s.id}
        // Pre-#139 row classes were `border-b cursor-pointer transition-colors
        // hover:opacity-80`; the shared DataTable renders the base three, the
        // hover style is entity-parity and comes through rowClassName.
        rowClassName={() => 'hover:opacity-80'}
        // Addendum #9: the dict *Filters bar rides in the toolbar's left group —
        // search rewired to context search/setSearch (§6.7 predicate-only),
        // status select already context-wired; bar UI/markup untouched.
        toolbarLead={
          <ServiceFilters
            search={servicesTable.search}
            status={servicesTable.status}
            onSearchChange={servicesTable.setSearch}
            onStatusChange={(v) => servicesTable.setStatus(v as 'active' | 'all' | 'archived')}
            onReset={() => { servicesTable.setSearch(''); servicesTable.setStatus('active'); servicesTable.resetFilters(); }}
            materials={materials}
            materialFilter={servicesTable.filters.material_id}
            onMaterialFilterChange={(v) => servicesTable.setFilters({ material_id: v })}
          />
        }
        toolbarExtras={
          <button
            onClick={() => setCreatingService(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            + Добавить услугу
          </button>
        }
      />

      {/* Edit Modal */}
      {editingService && (
        <ServiceModal
          mode="edit"
          service={editingService}
          onSubmit={handleEditSubmit}
          onClose={() => setEditingService(null)}
          title="Редактировать услугу"
          subtitle={editingService.title}
        />
      )}

      {/* Create Modal */}
      {creatingService && (
        <ServiceModal
          mode="create"
          service={null}
          onSubmit={handleCreateSubmit}
          onClose={() => setCreatingService(false)}
          title="Новая услуга"
        />
      )}

      {/* Delete dialog — §7.3: opened on dry-run 409, closed on done/cancel */}
      {deleteTarget && (
        <DeleteDialog
          entityName={deleteTarget.service.title}
          entityType="service"
          entityId={deleteTarget.service.id}
          dependencies={deleteTarget.dependencies}
          onResolve={async (id, resolutions) => {
            await resolveDeleteService(id, resolutions);
            // The resolve call bypasses the hook's onSuccess, so refresh
            // here — incl. cross-key ['records'] (useRecordData consumers).
            // Family rules via the shared map (#239): ['services'] + ['materials']
            // + ['records'] (see useServicesMutations).
            invalidateEntities(queryClient, ['services']);
            showToast('Услуга удалена');
          }}
          onArchive={(id) => archiveService.mutateAsync(id)}
          onDone={() => setDeleteTarget(null)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
