'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getServices } from '@memo/api-client';
import type { ServiceResponse } from '@memo/api-client';
import { useUpdateService, useCreateService, useDeleteService } from '@/hooks/useServicesMutations';
import { useUI } from '@/contexts/UIContext';
import { ServiceModal } from './ServiceModal';
import { ServiceFilters } from './ServiceFilters';
import { ColumnPicker } from './ColumnPicker';

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
  sortValue?: (s: ServiceResponse) => string | number;
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
    sortValue: (s) => s.title,
  },
  {
    key: 'duration',
    label: 'Длительность',
    defaultVisible: true,
    render: (s) => (
      <span style={{ color: 'var(--ink-mid)' }}>{s.duration} мин</span>
    ),
    sortValue: (s) => s.duration,
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
    sortValue: (s) => s.min_age,
  },
  {
    key: 'material_hint',
    label: 'Материал',
    defaultVisible: true,
    render: (s) => (
      <span style={{ color: 'var(--ink-mid)' }}>{s.material_hint ?? '—'}</span>
    ),
    sortValue: (s) => s.material_hint ?? '',
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
    sortValue: (s) => s.tariffs.length,
  },
  {
    key: 'specialty',
    label: 'Специализация',
    defaultVisible: false,
    render: (s) => (
      <span style={{ color: 'var(--ink-mid)' }}>{s.specialty || '—'}</span>
    ),
    sortValue: (s) => s.specialty,
  },
  {
    key: 'tags',
    label: 'Теги',
    defaultVisible: false,
    render: (s) => (
      <span style={{ color: 'var(--ink-mid)' }}>
        {s.tags.length > 0 ? s.tags.map((t) => t.tag).join(', ') : '—'}
      </span>
    ),
  },
  {
    key: 'is_active',
    label: 'Статус',
    defaultVisible: false,
    render: (s) => (
      <span
        className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium"
        style={{
          backgroundColor: s.is_active ? 'var(--success-bg, #dcfce7)' : 'var(--surface)',
          color: s.is_active ? 'var(--success, #16a34a)' : 'var(--ink-light)',
        }}
      >
        {s.is_active ? 'Активна' : 'Архив'}
      </span>
    ),
    sortValue: (s) => (s.is_active ? 0 : 1),
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
    sortValue: (s) => s.created_at,
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
  const { data: services = [], isLoading } = useQuery<ServiceResponse[], Error>({
    queryKey: ['services'],
    queryFn: () => getServices(),
    staleTime: 5 * 60 * 1000,
  });

  const updateService = useUpdateService();
  const createService = useCreateService();
  const deleteService = useDeleteService();
  const { showToast } = useUI();

  // Filters
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');

  // Sort
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Pagination
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

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

  const visibleColumns = useMemo(
    () => ALL_COLUMNS.filter((c) => visibleKeys.includes(c.key)),
    [visibleKeys],
  );

  // ─── Filtering ──────────────────────────────────────────────────────────

  const filteredServices = useMemo(() => {
    return services.filter((s) => {
      if (search && !s.title.toLowerCase().includes(search.toLowerCase()))
        return false;
      if (status === 'active' && !s.is_active) return false;
      if (status === 'archived' && s.is_active) return false;
      return true;
    });
  }, [services, search, status]);

  // ─── Sorting ────────────────────────────────────────────────────────────

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortIcon = (field: string) => {
    if (sortField !== field) return ' ↕';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  const sortedServices = useMemo(() => {
    if (!sortField) return filteredServices;
    const col = ALL_COLUMNS.find((c) => c.key === sortField);
    if (!col?.sortValue) return filteredServices;
    const sorted = [...filteredServices];
    sorted.sort((a, b) => {
      const aVal = col.sortValue!(a);
      const bVal = col.sortValue!(b);
      let cmp = 0;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        cmp = aVal.localeCompare(bVal);
      } else {
        cmp = (aVal as number) - (bVal as number);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredServices, sortField, sortDir]);

  // ─── Pagination ─────────────────────────────────────────────────────────

  const paginatedServices = useMemo(() => {
    return sortedServices.slice(page * pageSize, (page + 1) * pageSize);
  }, [sortedServices, page, pageSize]);

  const totalPages = Math.ceil(sortedServices.length / pageSize);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [search, status]);

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
    await updateService.mutateAsync({
      id: editingService.id,
      data: data as Record<string, unknown>,
    });
    showToast('Услуга обновлена', undefined);
  };

  const handleArchive = async (service: ServiceResponse) => {
    setActionMenuId(null);
    // ServiceUpdate doesn't include is_active — cast needed for archive/restore
    await updateService.mutateAsync({
      id: service.id,
      data: { is_active: !service.is_active } as never,
    });
    showToast(
      service.is_active ? 'Услуга в архиве' : 'Услуга восстановлена',
      undefined,
    );
  };

  const handleCreate = () => {
    setCreatingService(true);
  };

  const handleCreateSubmit = async (data: Record<string, unknown>) => {
    await createService.mutateAsync(data as never);
    showToast('Услуга создана', undefined);
  };

  const handleDelete = async (service: ServiceResponse) => {
    setActionMenuId(null);
    if (!window.confirm('Удалить услугу?')) return;
    await deleteService.mutateAsync(service.id);
    showToast('Услуга удалена', undefined);
  };

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
            onStatusChange={setStatus}
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
                  onClick={() => col.sortValue && handleSort(col.key)}
                >
                  {col.label}
                  {col.sortValue ? sortIcon(col.key) : ''}
                </th>
              ))}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {paginatedServices.map((service) => (
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
                          handleArchive(service);
                        }}
                        className="w-full text-left px-4 py-2 text-sm transition-colors hover:opacity-80"
                        style={{ color: 'var(--ink)' }}
                      >
                        {service.is_active ? 'В архив' : 'Восстановить'}
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
            {paginatedServices.length === 0 && (
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
        {sortedServices.length > 0 && (
          <div
            className="flex items-center justify-between px-4 py-3 border-t"
            style={{ borderColor: 'var(--line)' }}
          >
            <div
              className="flex items-center gap-2 text-sm"
              style={{ color: 'var(--ink-light)' }}
            >
              <span>Строк:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(0);
                }}
                className="border rounded px-2 py-1 text-xs"
                style={{
                  borderColor: 'var(--line)',
                  backgroundColor: 'var(--white)',
                  color: 'var(--ink)',
                }}
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
              <span>{sortedServices.length} всего</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="px-3 py-1 text-sm rounded border disabled:opacity-30"
                style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
              >
                ←
              </button>
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setPage(i)}
                  className={`px-3 py-1 text-sm rounded border ${
                    i === page ? 'font-bold' : ''
                  }`}
                  style={{
                    borderColor: 'var(--line)',
                    backgroundColor:
                      i === page ? 'var(--brand)' : 'transparent',
                    color: i === page ? 'white' : 'var(--ink)',
                  }}
                >
                  {i + 1}
                </button>
              ))}
              <button
                onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1 text-sm rounded border disabled:opacity-30"
                style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
              >
                →
              </button>
            </div>
          </div>
        )}
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
    </>
  );
}
