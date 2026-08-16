'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { getMaterials } from '@memo/api-client';
import type { MaterialResponse, MaterialUpdate, DependencyNode } from '@memo/api-client';
import { resolveDeleteMaterial, ApiError } from '@memo/api-client';
import { useUpdateMaterial, useCreateMaterial, useDeleteMaterial, useArchiveMaterial, useRestoreMaterial } from '@/hooks/useMaterialsMutations';
import { useUI } from '@/contexts/UIContext';
import { MaterialModal } from './MaterialModal';
import { ColumnPicker } from './ColumnPicker';
import { DeleteDialog } from '@/app/components/DeleteDialog';
import { parseApiError } from '@/app/lib/api/parseApiError';

// ─── Column definitions ─────────────────────────────────────────────────

interface ColumnDef {
  key: string;
  label: string;
  defaultVisible: boolean;
  render: (m: MaterialResponse) => React.ReactNode;
  sortValue?: (m: MaterialResponse) => string | number;
}

const ALL_COLUMNS: ColumnDef[] = [
  {
    key: 'title',
    label: 'Название',
    defaultVisible: true,
    render: (m) => (
      <span className="font-medium" style={{ color: 'var(--ink)' }}>
        {m.title}
      </span>
    ),
    sortValue: (m) => m.title,
  },
  {
    key: 'description',
    label: 'Описание',
    defaultVisible: true,
    render: (m) => (
      <span className="truncate block max-w-xs" style={{ color: 'var(--ink-mid)' }}>
        {m.description || '—'}
      </span>
    ),
    sortValue: (m) => m.description,
  },
  {
    key: 'archived',
    label: 'Статус',
    defaultVisible: true,
    render: (m) => (
      <span
        className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium"
        style={{
          backgroundColor: !m.archived ? 'var(--success-bg, #dcfce7)' : 'var(--surface)',
          color: !m.archived ? 'var(--success, #16a34a)' : 'var(--ink-light)',
        }}
      >
        {m.archived ? 'Архив' : 'Активен'}
      </span>
    ),
    sortValue: (m) => (m.archived ? 1 : 0),
  },
  {
    key: 'created_at',
    label: 'Создан',
    defaultVisible: false,
    render: (m) => (
      <span className="text-xs" style={{ color: 'var(--ink-light)' }}>
        {new Date(m.created_at).toLocaleDateString('ru-RU')}
      </span>
    ),
    sortValue: (m) => m.created_at,
  },
];

// ─── Storage key ──────────────────────────────────────────────────────

const STORAGE_KEY = 'materials-column-visibility';

function loadVisibleKeys(): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return null;
}

// ─── Component ────────────────────────────────────────────────────────

export function MaterialsTable() {
  // ─── Filter state ────────────────────────────────────────────────────
  // `status` is declared above `useQuery` because the query is keyed on it
  // (server-side archive filter via ListParams.status).
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'active' | 'all' | 'archived'>('active');

  const { data: materials = [], isLoading } = useQuery<MaterialResponse[], Error>({
    queryKey: ['materials', status],
    queryFn: () => getMaterials({ per_page: 100, status }).then(r => r.items),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });

  const updateMaterial = useUpdateMaterial();
  const createMaterial = useCreateMaterial();
  const deleteMaterial = useDeleteMaterial();
  const archiveMaterial = useArchiveMaterial();
  const restoreMaterial = useRestoreMaterial();
  const queryClient = useQueryClient();
  const { showToast } = useUI();

  // Sort state
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
  const [editingMaterial, setEditingMaterial] = useState<MaterialResponse | null>(
    null,
  );

  // Create modal
  const [creatingMaterial, setCreatingMaterial] = useState(false);

  // Action dropdown
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);

  // ─── Delete dialog state (§7.3: parent owns dry-run + open/close) ────
  const [deleteTarget, setDeleteTarget] = useState<{
    material: MaterialResponse;
    dependencies: DependencyNode[];
  } | null>(null);

  const visibleColumns = useMemo(
    () => ALL_COLUMNS.filter((c) => visibleKeys.includes(c.key)),
    [visibleKeys],
  );

  // ─── Filtering ──────────────────────────────────────────────────────

  const filteredMaterials = useMemo(() => {
    return materials.filter((m) => {
      if (search && !m.title.toLowerCase().includes(search.toLowerCase()))
        return false;
      return true;
    });
  }, [materials, search]);

  // ─── Sorting ────────────────────────────────────────────────────────

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

  const sortedMaterials = useMemo(() => {
    if (!sortField) return filteredMaterials;
    const col = ALL_COLUMNS.find((c) => c.key === sortField);
    if (!col?.sortValue) return filteredMaterials;
    const sorted = [...filteredMaterials];
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
  }, [filteredMaterials, sortField, sortDir]);

  // ─── Pagination ─────────────────────────────────────────────────────

  const paginatedMaterials = useMemo(() => {
    return sortedMaterials.slice(page * pageSize, (page + 1) * pageSize);
  }, [sortedMaterials, page, pageSize]);

  const totalPages = Math.ceil(sortedMaterials.length / pageSize);

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

  // ─── Handlers ───────────────────────────────────────────────────────

  const handleEdit = (material: MaterialResponse) => {
    setEditingMaterial(material);
    setActionMenuId(null);
  };

  const handleEditSubmit = async (data: Record<string, unknown>) => {
    if (!editingMaterial) return;
    // Canonical PUT (GH #178): full typed MaterialUpdate — every field listed.
    // #207: the Update schema carries no archive flag — archive/restore goes
    // through POST /materials/{id}/archive|restore, so PUT never flips it.
    const payload: MaterialUpdate = {
      title: data.title as string,
      description: (data.description as string | null | undefined) ?? '',
    };
    try {
      await updateMaterial.mutateAsync({ id: editingMaterial.id, data: payload });
      showToast('Материал обновлён', undefined);
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  const handleArchiveToggle = async (material: MaterialResponse) => {
    setActionMenuId(null);
    try {
      if (material.archived) {
        await restoreMaterial.mutateAsync(material.id);
        showToast('Материал восстановлен', undefined);
      } else {
        await archiveMaterial.mutateAsync(material.id);
        showToast('Материал в архиве', undefined);
      }
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  const handleCreate = () => {
    setCreatingMaterial(true);
  };

  const handleCreateSubmit = async (data: Record<string, unknown>) => {
    try {
      await createMaterial.mutateAsync(data as never);
      showToast('Материал создан', undefined);
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // #207 §7.3 dry-run flow: Material has ZERO FK deps (§4), so the no-body
  // DELETE normally returns 204 (instant delete). The 409 branch is
  // defensive but keeps the uniform DeleteDialog wiring.
  const handleDelete = async (material: MaterialResponse) => {
    setActionMenuId(null);
    try {
      await deleteMaterial.mutateAsync(material.id);
      // 204 — already deleted (zero deps): refresh handled by the hook.
      showToast('Материал удалён', undefined);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.dependencies) {
        setDeleteTarget({ material, dependencies: err.dependencies });
      } else {
        showToast(parseApiError(err).message, 'error');
      }
    }
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
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label
                className="text-xs font-medium"
                style={{ color: 'var(--ink-light)' }}
              >
                Поиск
              </label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Название..."
                className="rounded-lg border px-2 py-1.5 text-xs"
                style={{
                  borderColor: 'var(--line)',
                  color: 'var(--ink-mid)',
                  backgroundColor: 'var(--white)',
                }}
                aria-label="Поиск по названию"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label
                className="text-xs font-medium"
                style={{ color: 'var(--ink-light)' }}
              >
                Статус
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'active' | 'all' | 'archived')}
                className="rounded-lg border px-2 py-1.5 text-xs"
                style={{
                  borderColor: 'var(--line)',
                  color: 'var(--ink-mid)',
                  backgroundColor: 'var(--white)',
                }}
                aria-label="Фильтр по статусу"
              >
                <option value="active">Активные</option>
                <option value="all">Все</option>
                <option value="archived">Архив</option>
              </select>
            </div>
            <button
              onClick={() => {
                setSearch('');
                setStatus('active');
              }}
              className="px-3 py-1.5 text-xs font-medium transition-colors rounded-lg"
              style={{ color: 'var(--brand)', border: '1px solid var(--brand)' }}
            >
              Сбросить
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreate}
              className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              + Добавить материал
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
            {paginatedMaterials.map((material) => (
              <tr
                key={material.id}
                onClick={() => handleEdit(material)}
                className="border-b cursor-pointer transition-colors hover:opacity-80"
                style={{ borderColor: 'var(--line)' }}
              >
                {visibleColumns.map((col) => (
                  <td key={col.key} className="px-4 py-3 text-sm">
                    {col.render(material)}
                  </td>
                ))}
                <td className="px-2 py-3 relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setActionMenuId(
                        actionMenuId === material.id ? null : material.id,
                      );
                    }}
                    className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors text-sm"
                    style={{ color: 'var(--ink-light)' }}
                    aria-label="Действия"
                  >
                    ⋯
                  </button>
                  {actionMenuId === material.id && (
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
                          handleArchiveToggle(material);
                        }}
                        className="w-full text-left px-4 py-2 text-sm transition-colors hover:opacity-80"
                        style={{ color: 'var(--ink)' }}
                      >
                        {material.archived ? 'Восстановить' : 'В архив'}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(material);
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
            {paginatedMaterials.length === 0 && (
              <tr>
                <td
                  colSpan={visibleColumns.length + 1}
                  className="px-4 py-12 text-center text-sm"
                  style={{ color: 'var(--ink-light)' }}
                >
                  Материалы не найдены
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {sortedMaterials.length > 0 && (
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
              <span>{sortedMaterials.length} всего</span>
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
      {editingMaterial && (
        <MaterialModal
          mode="edit"
          material={editingMaterial}
          onSubmit={handleEditSubmit}
          onClose={() => setEditingMaterial(null)}
          title="Редактировать материал"
          subtitle={editingMaterial.title}
        />
      )}

      {/* Create Modal */}
      {creatingMaterial && (
        <MaterialModal
          mode="create"
          material={null}
          onSubmit={handleCreateSubmit}
          onClose={() => setCreatingMaterial(false)}
          title="Новый материал"
        />
      )}

      {/* Delete dialog — §7.3: opened on dry-run 409 (defensive), closed on done/cancel */}
      {deleteTarget && (
        <DeleteDialog
          entityName={deleteTarget.material.title}
          entityType="material"
          entityId={deleteTarget.material.id}
          dependencies={deleteTarget.dependencies}
          onResolve={async (id, resolutions) => {
            await resolveDeleteMaterial(id, resolutions);
            queryClient.invalidateQueries({ queryKey: ['materials'] });
            showToast('Материал удалён', undefined);
          }}
          onArchive={(id) => archiveMaterial.mutateAsync(id)}
          onDone={() => setDeleteTarget(null)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}
