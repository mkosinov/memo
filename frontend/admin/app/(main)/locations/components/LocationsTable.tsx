'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getLocations } from '@memo/api-client';
import type { LocationResponse } from '@memo/api-client';
import { useUpdateLocation } from '@/hooks/useLocationsMutations';
import type { LocationUpdate } from '@memo/api-client';
import { useUI } from '@/contexts/UIContext';
import { EntityModal } from '@/app/components/modal/EntityModal';
import { LocationFilters } from './LocationFilters';
import { LOCATION_FIELDS } from './locationFields';

// ─── Column definitions ──────────────────────────────────────────────────

interface Column {
  key: string;
  label: string;
  width?: string;
  hidden?: boolean;
}

const COLUMNS: Column[] = [
  { key: 'name', label: 'Название', width: 'flex-1' },
  { key: 'capacity', label: 'Вместимость', width: 'w-[100px]' },
  { key: 'address', label: 'Адрес', width: 'flex-1' },
  { key: 'location_hint', label: 'Подсказка', width: 'w-[150px]' },
  { key: 'description', label: 'Описание', hidden: true },
  { key: 'is_active', label: 'Статус', hidden: true },
  { key: 'yandex_map_url', label: 'Карта', hidden: true },
  { key: 'created_at', label: 'Создано', hidden: true },
];

const VISIBLE_COLUMNS = COLUMNS.filter((c) => !c.hidden);

// ─── Component ───────────────────────────────────────────────────────────

export function LocationsTable() {
  const { data: locations = [], isLoading } = useQuery<LocationResponse[]>({
    queryKey: ['locations'],
    queryFn: getLocations,
  });

  const updateLocation = useUpdateLocation();
  const { showToast } = useUI();

  // ─── Filter state ────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  // ─── Sort state ──────────────────────────────────────────────────────
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // ─── Edit modal state ────────────────────────────────────────────────
  const [editLocation, setEditLocation] = useState<LocationResponse | null>(null);

  // ─── Action dropdown state ───────────────────────────────────────────
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [search, status]);

  // ─── Filtered data ───────────────────────────────────────────────────

  const filteredLocations = useMemo(() => {
    return locations.filter((loc) => {
      // Search filter (name or address contains)
      if (search) {
        const q = search.toLowerCase();
        const nameMatch = loc.name.toLowerCase().includes(q);
        const addrMatch = (loc.address ?? '').toLowerCase().includes(q);
        if (!nameMatch && !addrMatch) return false;
      }
      // Status filter
      if (status === 'active' && !loc.is_active) return false;
      if (status === 'archived' && loc.is_active) return false;
      return true;
    });
  }, [locations, search, status]);

  // ─── Sorted data ─────────────────────────────────────────────────────

  const sortedLocations = useMemo(() => {
    if (!sortField) return filteredLocations;
    const sorted = [...filteredLocations];
    sorted.sort((a, b) => {
      const aVal = a[sortField as keyof LocationResponse];
      const bVal = b[sortField as keyof LocationResponse];
      let cmp = 0;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        cmp = aVal.localeCompare(bVal, 'ru');
      } else if (typeof aVal === 'number' && typeof bVal === 'number') {
        cmp = aVal - bVal;
      } else if (typeof aVal === 'boolean' && typeof bVal === 'boolean') {
        cmp = aVal === bVal ? 0 : aVal ? -1 : 1;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredLocations, sortField, sortDir]);

  // ─── Pagination ──────────────────────────────────────────────────────

  const paginatedLocations = useMemo(() => {
    return sortedLocations.slice(page * pageSize, (page + 1) * pageSize);
  }, [sortedLocations, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(sortedLocations.length / (pageSize || 10)));

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
    if (!editLocation) return;
    // Strip null values to match LocationUpdate (string | undefined, not null)
    const payload: LocationUpdate = {};
    for (const [key, val] of Object.entries(data)) {
      if (val !== null && val !== undefined) {
        (payload as Record<string, unknown>)[key] = val;
      }
    }
    await updateLocation.mutateAsync({
      id: editLocation.id,
      data: payload,
    });
    showToast('Локация обновлена');
    setEditLocation(null);
  };

  // ─── Archive / Restore ───────────────────────────────────────────────

  const handleToggleActive = async (loc: LocationResponse) => {
    await updateLocation.mutateAsync({
      id: loc.id,
      data: { is_active: !loc.is_active } as Record<string, unknown>,
    });
    showToast(loc.is_active ? 'Локация архивирована' : 'Локация восстановлена');
    setOpenDropdownId(null);
  };

  // ─── Loading / Empty ─────────────────────────────────────────────────

  if (isLoading) {
    return <div className="px-4 py-12 text-center text-sm" style={{ color: 'var(--ink-light)' }}>Загрузка...</div>;
  }

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div>
      {/* Filters */}
      <div className="p-4 border-b" style={{ borderColor: 'var(--line)' }}>
        <LocationFilters
          search={search}
          status={status}
          onSearchChange={setSearch}
          onStatusChange={setStatus}
          onReset={() => { setSearch(''); setStatus(''); }}
        />
      </div>

      {/* Table */}
      <div className="overflow-auto">
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
            {paginatedLocations.map((loc) => (
              <tr
                key={loc.id}
                onClick={() => setEditLocation(loc)}
                className="border-b cursor-pointer transition-colors hover:opacity-80"
                style={{ borderColor: 'var(--line)' }}
                data-testid={`location-row-${loc.id}`}
              >
                {/* Name */}
                <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--ink)' }}>
                  {loc.name}
                </td>

                {/* Capacity */}
                <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink-mid)' }}>
                  {loc.capacity}
                </td>

                {/* Address */}
                <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink-mid)' }}>
                  {loc.address ?? '—'}
                </td>

                {/* Location Hint */}
                <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink-light)' }}>
                  {loc.location_hint ?? '—'}
                </td>

                {/* Actions */}
                <td className="px-4 py-3 text-center relative">
                  <div className="flex items-center justify-center gap-2">
                    {/* Map link icon */}
                    {loc.yandex_map_url && (
                      <a
                        href={loc.yandex_map_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs transition-colors"
                        style={{ color: 'var(--brand)' }}
                        aria-label="Карта"
                        onClick={(e) => e.stopPropagation()}
                      >
                        🗺
                      </a>
                    )}

                    {/* Actions dropdown */}
                    <div className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenDropdownId(openDropdownId === loc.id ? null : loc.id);
                        }}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-sm transition-colors"
                        style={{ color: 'var(--ink-light)' }}
                        aria-label="Действия"
                      >
                        ⋯
                      </button>
                      {openDropdownId === loc.id && (
                        <div
                          className="absolute right-0 top-full mt-1 z-10 border rounded-lg shadow-lg py-1 min-w-[160px]"
                          style={{
                            borderColor: 'var(--line)',
                            backgroundColor: 'var(--white)',
                          }}
                          data-testid={`dropdown-${loc.id}`}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleActive(loc);
                            }}
                            className="w-full text-left px-3 py-2 text-sm transition-colors hover:opacity-80"
                            style={{ color: 'var(--ink)' }}
                          >
                            {loc.is_active ? 'В архив' : 'Восстановить'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </td>
              </tr>
            ))}
            {paginatedLocations.length === 0 && (
              <tr>
                <td
                  colSpan={VISIBLE_COLUMNS.length + 1}
                  className="px-4 py-12 text-center text-sm"
                  style={{ color: 'var(--ink-light)' }}
                >
                  Локации не найдены
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
          <span>{sortedLocations.length} всего</span>
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
      {editLocation && (
        <EntityModal
          mode="edit"
          entity={editLocation}
          fields={LOCATION_FIELDS}
          onSubmit={handleEdit}
          onClose={() => setEditLocation(null)}
          title="Редактирование локации"
          subtitle={editLocation.name}
        />
      )}
    </div>
  );
}
