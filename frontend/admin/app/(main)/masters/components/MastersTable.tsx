'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMasters } from '@memo/api-client';
import type { MasterResponse } from '@memo/api-client';
import { useUpdateMaster, usePatchMaster, useCreateMaster, useDeleteMaster } from '@/hooks/useMastersMutations';
import type { MasterUpdate } from '@memo/api-client';
import { useUI } from '@/contexts/UIContext';
import { displayMasterName } from '@/lib/utils';
import { MasterModal } from './MasterModal';
import { MasterFilters } from './MasterFilters';
import { ColumnPicker } from '@/app/components/shared/ColumnPicker';
import { ErrorState } from '@/app/components/error';
import { parseApiError } from '@/app/lib/api/parseApiError';

// ─── Column definitions ──────────────────────────────────────────────────

interface Column {
  key: string;
  label: string;
  width?: string;
  defaultVisible: boolean;
}

const COLUMNS: Column[] = [
  { key: 'name', label: 'Имя', width: 'flex-1', defaultVisible: true },
  { key: 'specialty', label: 'Специальность', width: 'w-[150px]', defaultVisible: true },
  { key: 'position', label: 'Должность', width: 'w-[150px]', defaultVisible: true },
  { key: 'color', label: 'Цвет', width: 'w-[80px]', defaultVisible: true },
  { key: 'avatar', label: 'Аватар', width: 'w-[60px]', defaultVisible: false },
  { key: 'status', label: 'Статус', width: 'w-[100px]', defaultVisible: false },
];

// ─── Component ───────────────────────────────────────────────────────────

export function MastersTable() {
  const { data: masters = [], isLoading, error, refetch } = useQuery<MasterResponse[]>({
    queryKey: ['masters'],
    queryFn: () => getMasters({ per_page: 100 }).then(r => r.items),
  });

  const updateMaster = useUpdateMaster();
  const patchMaster = usePatchMaster();
  const createMaster = useCreateMaster();
  const deleteMaster = useDeleteMaster();
  const { showToast } = useUI();

  // ─── Column visibility state ───────────────────────────────────────
  const [visibleKeys, setVisibleKeys] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('masters-columns');
      if (stored) return JSON.parse(stored);
    } catch {}
    return COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);
  });

  const VISIBLE_COLUMNS = COLUMNS.filter((c) => visibleKeys.includes(c.key));

  // ─── Filter state ────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  // ─── Sort state ──────────────────────────────────────────────────────
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // ─── Edit modal state ────────────────────────────────────────────────
  const [editMaster, setEditMaster] = useState<MasterResponse | null>(null);

  // ─── Create modal state ─────────────────────────────────────────────
  const [creatingMaster, setCreatingMaster] = useState(false);

  // ─── Action dropdown state ───────────────────────────────────────────
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [search, status]);

  // ─── Filtered data ───────────────────────────────────────────────────

  const filteredMasters = useMemo(() => {
    return masters.filter((m) => {
      // Search filter (first_name or last_name contains)
      if (search) {
        const q = search.toLowerCase();
        const firstNameMatch = m.first_name.toLowerCase().includes(q);
        const lastNameMatch = m.last_name.toLowerCase().includes(q);
        if (!firstNameMatch && !lastNameMatch) return false;
      }
      // Status filter
      if (status === 'active' && !m.is_active) return false;
      if (status === 'archived' && m.is_active) return false;
      return true;
    });
  }, [masters, search, status]);

  // ─── Sorted data ─────────────────────────────────────────────────────

  const sortedMasters = useMemo(() => {
    if (!sortField) return filteredMasters;
    const sorted = [...filteredMasters];
    sorted.sort((a, b) => {
      let aVal: unknown;
      let bVal: unknown;
      if (sortField === 'name') {
        aVal = `${a.first_name} ${a.last_name}`;
        bVal = `${b.first_name} ${b.last_name}`;
      } else {
        aVal = a[sortField as keyof MasterResponse];
        bVal = b[sortField as keyof MasterResponse];
      }
      let cmp = 0;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        cmp = aVal.localeCompare(bVal, 'ru');
      } else if (typeof aVal === 'boolean' && typeof bVal === 'boolean') {
        cmp = aVal === bVal ? 0 : aVal ? -1 : 1;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredMasters, sortField, sortDir]);

  // ─── Pagination ──────────────────────────────────────────────────────

  const paginatedMasters = useMemo(() => {
    return sortedMasters.slice(page * pageSize, (page + 1) * pageSize);
  }, [sortedMasters, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(sortedMasters.length / (pageSize || 10)));

  // ─── Sort handler ────────────────────────────────────────────────────

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

  // ─── Edit handlers ───────────────────────────────────────────────────

  const handleEdit = async (data: Record<string, unknown>) => {
    if (!editMaster) return;
    const payload: MasterUpdate = {};
    for (const [key, val] of Object.entries(data)) {
      if (val !== null && val !== undefined) {
        (payload as Record<string, unknown>)[key] = val;
      }
    }
    try {
      await updateMaster.mutateAsync({
        id: editMaster.id,
        data: payload,
      });
      showToast('Мастер обновлён');
      setEditMaster(null);
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // ─── Archive / Restore ───────────────────────────────────────────────

  const handleToggleActive = async (master: MasterResponse) => {
    try {
      await patchMaster.mutateAsync({
        id: master.id,
        data: { is_active: !master.is_active },
      });
      showToast(master.is_active ? 'Мастер архивирован' : 'Мастер восстановлен');
      setOpenDropdownId(null);
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // ─── Create ─────────────────────────────────────────────────────────

  const handleCreate = () => {
    setCreatingMaster(true);
  };

  const handleCreateSubmit = async (data: Record<string, unknown>) => {
    const payload: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(data)) {
      if (val !== null && val !== undefined) {
        payload[key] = val;
      }
    }
    try {
      await createMaster.mutateAsync(payload as never);
      showToast('Мастер создан');
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // ─── Delete ─────────────────────────────────────────────────────────

  const handleDelete = async (master: MasterResponse) => {
    setOpenDropdownId(null);
    if (!window.confirm('Удалить мастера?')) return;
    try {
      await deleteMaster.mutateAsync(master.id);
      showToast('Мастер удалён');
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // ─── Error ─────────────────────────────────────────────────────────

  if (error) {
    return (
      <ErrorState
        error={error}
        onRetry={refetch}
      />
    );
  }

  // ─── Loading / Empty ─────────────────────────────────────────────────

  if (isLoading) {
    return <div className="px-4 py-12 text-center text-sm" style={{ color: 'var(--ink-light)' }}>Загрузка...</div>;
  }

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div>
      {/* Filters */}
      <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--line)' }}>
        <MasterFilters
          search={search}
          status={status}
          onSearchChange={setSearch}
          onStatusChange={setStatus}
          onReset={() => { setSearch(''); setStatus(''); }}
        />
        <div className="flex items-center gap-2">
          <ColumnPicker
            columns={COLUMNS.map((c) => ({ key: c.key, label: c.label }))}
            visibleKeys={visibleKeys}
            onChange={setVisibleKeys}
            storageKey="masters-columns"
          />
          <button
            onClick={handleCreate}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            + Добавить мастера
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr
              className="border-b"
              style={{ borderColor: 'var(--line)', backgroundColor: 'var(--surface)' }}
            >
              {VISIBLE_COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={`text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none ${col.width ?? ''}`}
                  style={{ color: 'var(--ink-light)' }}
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}{sortIcon(col.key)}
                </th>
              ))}
              <th
                className="w-[60px]"
                style={{ color: 'var(--ink-light)' }}
              />
            </tr>
          </thead>
          <tbody>
            {paginatedMasters.map((master) => (
              <tr
                key={master.id}
                onClick={() => setEditMaster(master)}
                className="border-b cursor-pointer transition-colors hover:opacity-80"
                style={{ borderColor: 'var(--line)' }}
                data-testid={`master-row-${master.id}`}
              >
                {/* Name */}
                {visibleKeys.includes('name') && (
                <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--ink)' }}>
                  {displayMasterName(master)}
                </td>
                )}

                {/* Specialty */}
                {visibleKeys.includes('specialty') && (
                <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink-mid)' }}>
                  {master.specialty}
                </td>
                )}

                {/* Position */}
                {visibleKeys.includes('position') && (
                <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink-mid)' }}>
                  {master.position}
                </td>
                )}

                {/* Color */}
                {visibleKeys.includes('color') && (
                <td className="px-4 py-3 text-sm">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-4 h-4 rounded-full border"
                      style={{ backgroundColor: master.color }}
                    />
                    <span className="text-xs" style={{ color: 'var(--ink-light)' }}>
                      {master.color}
                    </span>
                  </div>
                </td>
                )}

                {/* Avatar */}
                {visibleKeys.includes('avatar') && (
                <td className="px-4 py-3 text-sm">
                  {master.avatar_url ? (
                    <img
                      src={master.avatar_url}
                      alt="avatar"
                      className="w-8 h-8 rounded-full object-cover"
                    />
                  ) : (
                    <span style={{ color: 'var(--ink-light)' }}>—</span>
                  )}
                </td>
                )}

                {/* Status */}
                {visibleKeys.includes('status') && (
                <td className="px-4 py-3 text-sm">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${master.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {master.is_active ? 'Активен' : 'Архив'}
                  </span>
                </td>
                )}

                {/* Actions */}
                <td className="px-4 py-3 text-center relative">
                  <div className="flex items-center justify-center gap-2">
                    {/* Actions dropdown */}
                    <div className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenDropdownId(openDropdownId === master.id ? null : master.id);
                        }}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-sm transition-colors"
                        style={{ color: 'var(--ink-light)' }}
                        aria-label="Действия"
                      >
                        ⋯
                      </button>
                      {openDropdownId === master.id && (
                        <div
                          className="absolute right-0 top-full mt-1 z-10 border rounded-lg shadow-lg py-1 min-w-[160px]"
                          style={{
                            borderColor: 'var(--line)',
                            backgroundColor: 'var(--white)',
                          }}
                          data-testid={`dropdown-${master.id}`}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleActive(master);
                            }}
                            className="w-full text-left px-3 py-2 text-sm transition-colors hover:opacity-80"
                            style={{ color: 'var(--ink)' }}
                          >
                            {master.is_active ? 'В архив' : 'Восстановить'}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(master);
                            }}
                            className="w-full text-left px-3 py-2 text-sm transition-colors hover:opacity-80"
                            style={{ color: 'var(--danger, #dc2626)' }}
                          >
                            Удалить
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </td>
              </tr>
            ))}
            {paginatedMasters.length === 0 && (
              <tr>
                <td
                  colSpan={VISIBLE_COLUMNS.length + 1}
                  className="px-4 py-12 text-center text-sm"
                  style={{ color: 'var(--ink-light)' }}
                >
                  Мастера не найдены
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div
        className="flex items-center justify-between px-4 py-3 border-t"
        style={{ borderColor: 'var(--line)' }}
      >
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink-light)' }}>
          <span>Строк:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value) || 10);
              setPage(0);
            }}
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
          <span>{sortedMasters.length} всего</span>
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
              className={`px-3 py-1 text-sm rounded border ${i === page ? 'font-bold' : ''}`}
              style={{
                borderColor: 'var(--line)',
                backgroundColor: i === page ? 'var(--brand)' : 'transparent',
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

      {/* Edit modal */}
      {editMaster && (
        <MasterModal
          mode="edit"
          master={editMaster}
          onSubmit={handleEdit}
          onClose={() => setEditMaster(null)}
          title="Редактирование мастера"
          subtitle={`${editMaster.first_name} ${editMaster.last_name}`}
        />
      )}

      {/* Create modal */}
      {creatingMaster && (
        <MasterModal
          mode="create"
          master={null}
          onSubmit={handleCreateSubmit}
          onClose={() => setCreatingMaster(false)}
          title="Новый мастер"
        />
      )}
    </div>
  );
}
