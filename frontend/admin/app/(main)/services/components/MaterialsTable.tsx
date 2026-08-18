'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { MaterialResponse, MaterialUpdate, DependencyNode } from '@memo/api-client';
import { resolveDeleteMaterial, ApiError } from '@memo/api-client';
import { useUpdateMaterial, useCreateMaterial, useDeleteMaterial, useArchiveMaterial, useRestoreMaterial } from '@/hooks/useMaterialsMutations';
import { useUI } from '@/contexts/UIContext';
import { useMaterialsTable } from '@/contexts/MaterialsContext';
import { MaterialModal } from './MaterialModal';
import { ServiceFilters } from './ServiceFilters';
import { ColumnPicker } from './ColumnPicker';
import { DeleteDialog } from '@/app/components/DeleteDialog';
import { ErrorState } from '@/app/components/error';
import { parseApiError } from '@/app/lib/api/parseApiError';

// ─── Column definitions ─────────────────────────────────────────────────

interface ColumnDef {
  key: string;
  label: string;
  defaultVisible: boolean;
  render: (m: MaterialResponse) => React.ReactNode;
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
  // ─── Server pagination/sort state (MaterialsContext, #205 §5.2) ──────
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
  } = useMaterialsTable();

  // ─── Filter state ────────────────────────────────────────────────────
  // Search stays client-side (G1b Q1): it filters the currently loaded page
  // only — the temporary degradation until server ?q= lands in #212.
  const [search, setSearch] = useState('');

  const updateMaterial = useUpdateMaterial();
  const createMaterial = useCreateMaterial();
  const deleteMaterial = useDeleteMaterial();
  const archiveMaterial = useArchiveMaterial();
  const restoreMaterial = useRestoreMaterial();
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

  // ─── Filtered data (client-side search over the loaded page) ───────────

  const filteredMaterials = useMemo(() => {
    return items.filter((m) => {
      if (search && !m.title.toLowerCase().includes(search.toLowerCase()))
        return false;
      return true;
    });
  }, [items, search]);

  // ─── Pagination (server-driven) ────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  // ─── Sort handler ────────────────────────────────────────────────────
  // All four material column keys (title, description, archived, created_at)
  // are in the backend sort whitelist (#205 Task 3) — every key passes
  // through as-is; `archived` maps to the is_active flip server-side.

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
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}
                  {sortIcon(col.key)}
                </th>
              ))}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {filteredMaterials.map((material) => (
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
            {filteredMaterials.length === 0 && (
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
