'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ServiceResponse, ServiceUpdate, DependencyNode } from '@memo/api-client';
import { resolveDeleteService, ApiError } from '@memo/api-client';
import { useUpdateService, useCreateService, useDeleteService, useArchiveService, useRestoreService } from '@/hooks/useServicesMutations';
import { useUI } from '@/contexts/UIContext';
import { useServicesTable } from '@/contexts/ServicesContext';
import { ServiceModal } from './ServiceModal';
import { ServiceFilters } from './ServiceFilters';
import { ColumnPicker } from './ColumnPicker';
import { DeleteDialog } from '@/app/components/DeleteDialog';
import { ErrorState } from '@/app/components/error';
import { parseApiError } from '@/app/lib/api/parseApiError';

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatPrice(n: number): string {
  return `${n.toLocaleString('ru-RU')}₽`;
}

function minTariffPrice(service: ServiceResponse): number | null {
  if (service.tariffs.length === 0) return null;
  return Math.min(...service.tariffs.map((t) => t.price));
}

function tariffLabel(count: number): string {
  if (count === 0) return '—';
  if (count === 1) return '1 тариф';
  if (count < 5) return `${count} тарифа`;
  return `${count} тарифов`;
}

// ─── Column definitions ───────────────────────────────────────────────────

interface ColumnDef {
  key: string;
  label: string;
  defaultVisible: boolean;
  render: (s: ServiceResponse) => React.ReactNode;
  /** Server sort key exists in the backend whitelist (#205 Task 3). False only for `tags`. */
  sortable?: boolean;
}

const ALL_COLUMNS: ColumnDef[] = [
  {
    key: 'title',
    label: 'Название',
    defaultVisible: true,
    render: (s) => (
      <span className="font-medium" style={{ color: 'var(--ink)' }}>
        {s.title}
      </span>
    ),
  },
  {
    key: 'duration',
    label: 'Длительность',
    defaultVisible: true,
    render: (s) => (
      <span style={{ color: 'var(--ink-mid)' }}>{s.duration} мин</span>
    ),
  },
  {
    key: 'age',
    label: 'Возраст',
    defaultVisible: true,
    render: (s) => (
      <span style={{ color: 'var(--ink-mid)' }}>
        {s.min_age}–{s.max_age}
      </span>
    ),
  },
  {
    key: 'material_hint',
    label: 'Материал',
    defaultVisible: true,
    render: (s) => (
      <span style={{ color: 'var(--ink-mid)' }}>{s.material_hint ?? '—'}</span>
    ),
  },
  {
    key: 'tariffs',
    label: 'Тарифы',
    defaultVisible: true,
    render: (s) => {
      const min = minTariffPrice(s);
      return (
        <span style={{ color: 'var(--ink-mid)' }}>
          {tariffLabel(s.tariffs.length)}
          {min !== null && (
            <span className="ml-1 text-xs" style={{ color: 'var(--ink-light)' }}>
              от {formatPrice(min)}
            </span>
          )}
        </span>
      );
    },
  },
  {
    key: 'specialty',
    label: 'Специализация',
    defaultVisible: false,
    render: (s) => (
      <span style={{ color: 'var(--ink-mid)' }}>{s.specialty || '—'}</span>
    ),
  },
  {
    key: 'tags',
    label: 'Теги',
    defaultVisible: false,
    sortable: false, // no server sort key — backend whitelist has no tags mapping (#205 Task 3)
    render: (s) => (
      <span style={{ color: 'var(--ink-mid)' }}>
        {s.tags.length > 0 ? s.tags.map((t) => t.tag).join(', ') : '—'}
      </span>
    ),
  },
  {
    key: 'archived',
    label: 'Статус',
    defaultVisible: false,
    render: (s) => (
      <span
        className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium"
        style={{
          backgroundColor: !s.archived ? 'var(--success-bg, #dcfce7)' : 'var(--surface)',
          color: !s.archived ? 'var(--success, #16a34a)' : 'var(--ink-light)',
        }}
      >
        {s.archived ? 'Архив' : 'Активна'}
      </span>
    ),
  },
  {
    key: 'created_at',
    label: 'Создана',
    defaultVisible: false,
    render: (s) => (
      <span className="text-xs" style={{ color: 'var(--ink-light)' }}>
        {new Date(s.created_at).toLocaleDateString('ru-RU')}
      </span>
    ),
  },
];

// ─── Storage key ──────────────────────────────────────────────────────────

const STORAGE_KEY = 'services-column-visibility';

function loadVisibleKeys(): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────

export function ServicesTable() {
  // ─── Server pagination/sort state (ServicesContext, #205 §5.2) ────────
  const {
    items,
    total,
    page,
    perPage,
    sortBy,
    sortOrder,
    status,
    isLoading,
    error,
    setPage,
    setPerPage,
    setSort,
    setStatus,
    refetch,
  } = useServicesTable();

  // ─── Filter state ────────────────────────────────────────────────────
  // Search stays client-side (G1b Q1): it filters the currently loaded page
  // only — the temporary degradation until server ?q= lands in #212.
  const [search, setSearch] = useState('');

  const updateService = useUpdateService();
  const createService = useCreateService();
  const deleteService = useDeleteService();
  const archiveService = useArchiveService();
  const restoreService = useRestoreService();
  const queryClient = useQueryClient();
  const { showToast } = useUI();

  // Column visibility
  const defaultVisible = ALL_COLUMNS.filter((c) => c.defaultVisible).map(
    (c) => c.key,
  );
  const [visibleKeys, setVisibleKeys] = useState<string[]>(() => {
    return loadVisibleKeys() ?? defaultVisible;
  });

  // Edit modal
  const [editingService, setEditingService] = useState<ServiceResponse | null>(
    null,
  );

  // Create modal
  const [creatingService, setCreatingService] = useState(false);

  // Action dropdown
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);

  // ─── Delete dialog state (§7.3: parent owns dry-run + open/close) ────
  const [deleteTarget, setDeleteTarget] = useState<{
    service: ServiceResponse;
    dependencies: DependencyNode[];
  } | null>(null);

  const visibleColumns = useMemo(
    () => ALL_COLUMNS.filter((c) => visibleKeys.includes(c.key)),
    [visibleKeys],
  );

  // ─── Filtered data (client-side search over the loaded page) ───────────

  const filteredServices = useMemo(() => {
    return items.filter((s) => {
      if (search && !s.title.toLowerCase().includes(search.toLowerCase()))
        return false;
      return true;
    });
  }, [items, search]);

  // ─── Pagination (server-driven) ────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  // ─── Sort handler ────────────────────────────────────────────────────
  // `tags` has no server sort key (backend whitelist, #205 Task 3) → gated
  // off in its column def via `sortable`; every other key passes through
  // as-is (`age` → min_age, `tariffs` → count subquery — backend maps them).

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSort(field, sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(field, 'asc');
    }
  };

  const sortIcon = (field: string) => {
    if (sortBy !== field) return ' ↕';
    return sortOrder === 'asc' ? ' ↑' : ' ↓';
  };

  // Close action menu on outside click
  useEffect(() => {
    if (!actionMenuId) return;
    const handler = () => setActionMenuId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [actionMenuId]);

  // ─── Handlers ───────────────────────────────────────────────────────────

  const handleEdit = (service: ServiceResponse) => {
    setEditingService(service);
    setActionMenuId(null);
  };

  const handleEditSubmit = async (data: Record<string, unknown>) => {
    if (!editingService) return;
    // Canonical PUT (GH #178): full typed ServiceUpdate — every field listed.
    // #207: the Update schema carries no archive flag — archive/restore goes
    // through POST /services/{id}/archive|restore, so PUT never flips it.
    const payload: ServiceUpdate = {
      title: data.title as string,
      description: (data.description as string | null | undefined) ?? '',
      image_url: (data.image_url as string | null | undefined) ?? '',
      specialty: (data.specialty as string | null | undefined) ?? '',
      min_age: (data.min_age as number | null | undefined) ?? 0,
      max_age: (data.max_age as number | null | undefined) ?? 18,
      duration: data.duration as number,
      record_info: (data.record_info as string | null | undefined) ?? '',
      material_hint: (data.material_hint as string | null | undefined) ?? '',
      tariffs: (data.tariffs as ServiceUpdate['tariffs'] | undefined) ?? [],
      tag_ids: (data.tag_ids as string[] | undefined) ?? [],
    };
    try {
      await updateService.mutateAsync({ id: editingService.id, data: payload });
      showToast('Услуга обновлена', undefined);
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  const handleArchiveToggle = async (service: ServiceResponse) => {
    setActionMenuId(null);
    try {
      if (service.archived) {
        await restoreService.mutateAsync(service.id);
        showToast('Услуга восстановлена', undefined);
      } else {
        await archiveService.mutateAsync(service.id);
        showToast('Услуга в архиве', undefined);
      }
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  const handleCreate = () => {
    setCreatingService(true);
  };

  const handleCreateSubmit = async (data: Record<string, unknown>) => {
    try {
      await createService.mutateAsync(data as never);
      showToast('Услуга создана', undefined);
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // #207 §7.3 dry-run flow: no-body DELETE → 204 (instant delete, no deps)
  // or 409 + dependency tree → DeleteDialog (Mode A/B). The parent owns the
  // call + open/close state; the dialog receives the parsed tree.
  const handleDelete = async (service: ServiceResponse) => {
    setActionMenuId(null);
    try {
      await deleteService.mutateAsync(service.id);
      // 204 — already deleted (zero deps): refresh handled by the hook.
      showToast('Услуга удалена', undefined);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.dependencies) {
        setDeleteTarget({ service, dependencies: err.dependencies });
      } else {
        showToast(parseApiError(err).message, 'error');
      }
    }
  };

  if (error) {
    return (
      <ErrorState
        error={error}
        onRetry={refetch}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="px-4 py-12 text-center text-sm" style={{ color: 'var(--ink-light)' }}>
        Загрузка...
      </div>
    );
  }

  return (
    <>
      {/* Filters */}
      <div
        className="rounded-xl border p-4"
        style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
      >
        <div className="flex items-center justify-between">
          <ServiceFilters
            search={search}
            status={status}
            onSearchChange={setSearch}
            onStatusChange={(v) => setStatus(v as 'active' | 'all' | 'archived')}
            onReset={() => {
              setSearch('');
              setStatus('active');
            }}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreate}
              className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              + Добавить услугу
            </button>
            <ColumnPicker
              columns={ALL_COLUMNS.map((c) => ({ key: c.key, label: c.label }))}
              visibleKeys={visibleKeys}
              onChange={setVisibleKeys}
              storageKey={STORAGE_KEY}
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr
              className="border-b"
              style={{
                borderColor: 'var(--line)',
                backgroundColor: 'var(--surface)',
              }}
            >
              {visibleColumns.map((col) => (
                <th
                  key={col.key}
                  className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none"
                  style={{ color: 'var(--ink-light)' }}
                  onClick={() => col.sortable !== false && handleSort(col.key)}
                >
                  {col.label}
                  {col.sortable !== false ? sortIcon(col.key) : ''}
                </th>
              ))}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {filteredServices.map((service) => (
              <tr
                key={service.id}
                onClick={() => handleEdit(service)}
                className="border-b cursor-pointer transition-colors hover:opacity-80"
                style={{ borderColor: 'var(--line)' }}
              >
                {visibleColumns.map((col) => (
                  <td key={col.key} className="px-4 py-3 text-sm">
                    {col.render(service)}
                  </td>
                ))}
                <td className="px-2 py-3 relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setActionMenuId(
                        actionMenuId === service.id ? null : service.id,
                      );
                    }}
                    className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors text-sm"
                    style={{ color: 'var(--ink-light)' }}
                    aria-label="Действия"
                  >
                    ⋯
                  </button>
                  {actionMenuId === service.id && (
                    <div
                      className="absolute right-0 top-full mt-1 z-20 rounded-lg border shadow-lg py-1 min-w-[160px]"
                      style={{
                        borderColor: 'var(--line)',
                        backgroundColor: 'var(--white)',
                      }}
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleArchiveToggle(service);
                        }}
                        className="w-full text-left px-4 py-2 text-sm transition-colors hover:opacity-80"
                        style={{ color: 'var(--ink)' }}
                      >
                        {service.archived ? 'Восстановить' : 'В архив'}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(service);
                        }}
                        className="w-full text-left px-4 py-2 text-sm transition-colors hover:opacity-80"
                        style={{ color: 'var(--danger, #dc2626)' }}
                      >
                        Удалить
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {filteredServices.length === 0 && (
              <tr>
                <td
                  colSpan={visibleColumns.length + 1}
                  className="px-4 py-12 text-center text-sm"
                  style={{ color: 'var(--ink-light)' }}
                >
                  Услуги не найдены
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Pagination */}
        <div
          className="flex items-center justify-between px-4 py-3 border-t"
          style={{ borderColor: 'var(--line)' }}
        >
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink-light)' }}>
            <span>Строк:</span>
            <select
              value={perPage}
              onChange={(e) => setPerPage(Number(e.target.value) || 10)}
              className="border rounded px-2 py-1 text-xs"
              style={{
                borderColor: 'var(--line)',
                backgroundColor: 'var(--white)',
                color: 'var(--ink)',
              }}
              data-testid="page-size-select"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span>{total} всего</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="px-3 py-1 text-sm rounded border disabled:opacity-30"
              style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
            >
              ←
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`px-3 py-1 text-sm rounded border ${p === page ? 'font-bold' : ''}`}
                style={{
                  borderColor: 'var(--line)',
                  backgroundColor: p === page ? 'var(--brand)' : 'transparent',
                  color: p === page ? 'white' : 'var(--ink)',
                }}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1 text-sm rounded border disabled:opacity-30"
              style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
            >
              →
            </button>
          </div>
        </div>
      </div>

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
            queryClient.invalidateQueries({ queryKey: ['services'] });
            queryClient.invalidateQueries({ queryKey: ['records'] });
            showToast('Услуга удалена', undefined);
          }}
          onArchive={(id) => archiveService.mutateAsync(id)}
          onDone={() => setDeleteTarget(null)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}
