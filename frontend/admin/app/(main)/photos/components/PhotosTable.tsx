'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPhotos } from '@memo/api-client';
import type { PhotoResponse } from '@memo/api-client';
import { useUpdatePhoto, useCreatePhoto, useDeletePhoto } from '@/hooks/usePhotosMutations';
import { useUI } from '@/contexts/UIContext';
import { PhotoModal } from './PhotoModal';
import { ColumnPicker } from '@/app/components/shared/ColumnPicker';
import { ErrorState } from '@/app/components/error';
import { parseApiError } from '@/app/lib/api/parseApiError';

// ─── Column definitions ──────────────────────────────────────────────────

interface Column {
  key: string;
  label: string;
  width?: string;
  defaultVisible?: boolean;
}

const COLUMNS: Column[] = [
  { key: 'preview', label: 'Превью', width: 'w-[80px]', defaultVisible: true },
  { key: 'filename', label: 'Файл', width: 'flex-1', defaultVisible: true },
  { key: 'visitor', label: 'Посетитель', width: 'w-[150px]', defaultVisible: true },
  { key: 'service', label: 'Услуга', width: 'w-[150px]', defaultVisible: false },
  { key: 'activity', label: 'Активность', width: 'w-[150px]', defaultVisible: false },
  { key: 'is_public', label: 'Публичное', width: 'w-[100px]', defaultVisible: true },
  { key: 'status', label: 'Статус', width: 'w-[100px]', defaultVisible: true },
];

// ─── Component ───────────────────────────────────────────────────────────

export function PhotosTable() {
  const { data: photos = [], isLoading, error, refetch } = useQuery<PhotoResponse[]>({
    queryKey: ['photos'],
    queryFn: getPhotos,
  });

  const updateMutation = useUpdatePhoto();
  const createMutation = useCreatePhoto();
  const deleteMutation = useDeletePhoto();
  const { showToast } = useUI();

  // ─── Column visibility state ───────────────────────────────────────
  const [visibleKeys, setVisibleKeys] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('photos-columns');
      if (stored) return JSON.parse(stored);
    } catch {
      // ignore
    }
    return COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);
  });

  const VISIBLE_COLUMNS = COLUMNS.filter((c) => visibleKeys.includes(c.key));

  // ─── Filter state ──────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  // ─── Sort state ────────────────────────────────────────────────────
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // ─── Edit modal state ──────────────────────────────────────────────
  const [editPhoto, setEditPhoto] = useState<PhotoResponse | null>(null);

  // ─── Create modal state ────────────────────────────────────────────
  const [creatingPhoto, setCreatingPhoto] = useState(false);

  // ─── Action dropdown state ─────────────────────────────────────────
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [search, status]);

  // ─── Filtered data ─────────────────────────────────────────────────

  const filteredPhotos = useMemo(() => {
    return photos.filter((photo) => {
      if (search) {
        const q = search.toLowerCase();
        if (!photo.filename.toLowerCase().includes(q)) return false;
      }
      if (status === 'active' && !photo.is_active) return false;
      if (status === 'archived' && photo.is_active) return false;
      return true;
    });
  }, [photos, search, status]);

  // ─── Sorted data ───────────────────────────────────────────────────

  const sortedPhotos = useMemo(() => {
    if (!sortField) return filteredPhotos;
    const sorted = [...filteredPhotos];
    sorted.sort((a, b) => {
      const aVal = a[sortField as keyof PhotoResponse];
      const bVal = b[sortField as keyof PhotoResponse];
      let cmp = 0;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        cmp = aVal.localeCompare(bVal, 'ru');
      } else if (typeof aVal === 'boolean' && typeof bVal === 'boolean') {
        cmp = aVal === bVal ? 0 : aVal ? 1 : -1;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredPhotos, sortField, sortDir]);

  // ─── Pagination ────────────────────────────────────────────────────

  const paginatedPhotos = useMemo(() => {
    return sortedPhotos.slice(page * pageSize, (page + 1) * pageSize);
  }, [sortedPhotos, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(sortedPhotos.length / (pageSize || 10)));

  // ─── Sort handler ──────────────────────────────────────────────────

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

  // ─── Edit handlers ─────────────────────────────────────────────────

  const handleEdit = async (data: Record<string, unknown>) => {
    if (!editPhoto) return;
    const payload: Record<string, unknown> = {};
    if (data.filename !== null && data.filename !== undefined) {
      payload.filename = String(data.filename);
    }
    if (data.visitor_id !== null && data.visitor_id !== undefined) {
      payload.visitor_id = String(data.visitor_id) || null;
    }
    if (data.service_id !== null && data.service_id !== undefined) {
      payload.service_id = String(data.service_id) || null;
    }
    if (data.activity_id !== null && data.activity_id !== undefined) {
      payload.activity_id = String(data.activity_id) || null;
    }
    if (data.is_public !== null && data.is_public !== undefined) {
      payload.is_public = Boolean(data.is_public);
    }
    if (data.tags !== null && data.tags !== undefined) {
      const tags = (data.tags as Array<{ id: string; tag: string }>) || [];
      payload.tag_ids = tags.map(t => t.id);
    }
    await updateMutation.mutateAsync({
      id: editPhoto.id,
      data: payload,
    });
    showToast('Фото обновлено');
    setEditPhoto(null);
  };

  // ─── Create ────────────────────────────────────────────────────────

  const handleCreateSubmit = async (data: Record<string, unknown>) => {
    const tags = (data.tags as Array<{ id: string; tag: string }>) || [];
    await createMutation.mutateAsync({
      filename: String(data.filename ?? ''),
      visitor_id: String(data.visitor_id ?? ''),
      service_id: String(data.service_id ?? ''),
      activity_id: String(data.activity_id ?? ''),
      is_public: Boolean(data.is_public),
      tag_ids: tags.map(t => t.id),
    });
    showToast('Фото создано');
  };

  // ─── Delete ────────────────────────────────────────────────────────

  const handleDelete = async (photo: PhotoResponse) => {
    setOpenDropdownId(null);
    if (!window.confirm('Удалить фото?')) return;
    await deleteMutation.mutateAsync(photo.id);
    showToast('Фото удалено');
  };

  // ─── Error ───────────────────────────────────────────────────────

  if (error) {
    return (
      <ErrorState
        error={error}
        onRetry={refetch}
      />
    );
  }

  // ─── Loading ───────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="px-4 py-12 text-center text-sm" style={{ color: 'var(--ink-light)' }}>
        Загрузка...
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────

  return (
    <div>
      {/* Filters */}
      <div
        className="p-4 border-b flex items-center justify-between"
        style={{ borderColor: 'var(--line)' }}
      >
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск фото..."
            className="rounded-lg border px-3 py-2 text-sm"
            style={{
              borderColor: 'var(--line)',
              backgroundColor: 'var(--white)',
              color: 'var(--ink)',
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="text-xs px-2 py-1 rounded"
              style={{ color: 'var(--ink-light)' }}
            >
              ✕
            </button>
          )}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border px-2 py-2 text-sm"
            style={{
              borderColor: 'var(--line)',
              backgroundColor: 'var(--white)',
              color: 'var(--ink-mid)',
            }}
          >
            <option value="">Все статусы</option>
            <option value="active">Активен</option>
            <option value="archived">Архив</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <ColumnPicker
            columns={COLUMNS.map((c) => ({ key: c.key, label: c.label }))}
            visibleKeys={visibleKeys}
            onChange={setVisibleKeys}
            storageKey="photos-columns"
          />
          <button
            onClick={() => setCreatingPhoto(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            + Добавить фото
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
                  {col.label}
                  {sortIcon(col.key)}
                </th>
              ))}
              <th
                className="w-[60px]"
                style={{ color: 'var(--ink-light)' }}
              />
            </tr>
          </thead>
          <tbody>
            {paginatedPhotos.map((photo) => (
              <tr
                key={photo.id}
                onClick={() => setEditPhoto(photo)}
                className="border-b cursor-pointer transition-colors hover:opacity-80"
                style={{ borderColor: 'var(--line)' }}
                data-testid={`photo-row-${photo.id}`}
              >
                {/* Preview */}
                {visibleKeys.includes('preview') && (
                  <td className="px-4 py-3">
                    <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center">
                      {photo.filename ? (
                        <img
                          src={photo.filename}
                          alt={photo.filename}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <span className="text-gray-400 text-xs">Нет фото</span>
                      )}
                    </div>
                  </td>
                )}

                {/* Filename */}
                {visibleKeys.includes('filename') && (
                  <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--ink)' }}>
                    {photo.filename}
                  </td>
                )}

                {/* Visitor */}
                {visibleKeys.includes('visitor') && (
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink-mid)' }}>
                    {photo.visitor_id || '—'}
                  </td>
                )}

                {/* Service */}
                {visibleKeys.includes('service') && (
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink-mid)' }}>
                    {photo.service_id || '—'}
                  </td>
                )}

                {/* Activity */}
                {visibleKeys.includes('activity') && (
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink-mid)' }}>
                    {photo.activity_id || '—'}
                  </td>
                )}

                {/* is_public */}
                {visibleKeys.includes('is_public') && (
                  <td className="px-4 py-3 text-sm">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        photo.is_public
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {photo.is_public ? 'Да' : 'Нет'}
                    </span>
                  </td>
                )}

                {/* Status */}
                {visibleKeys.includes('status') && (
                  <td className="px-4 py-3 text-sm">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        photo.is_active
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {photo.is_active ? 'Активен' : 'Архив'}
                    </span>
                  </td>
                )}

                {/* Actions */}
                <td className="px-4 py-3 text-center relative">
                  <div className="flex items-center justify-end gap-2">
                    <div className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenDropdownId(openDropdownId === photo.id ? null : photo.id);
                        }}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-sm transition-colors"
                        style={{ color: 'var(--ink-light)' }}
                        aria-label="Действия"
                      >
                        ⋯
                      </button>
                      {openDropdownId === photo.id && (
                        <div
                          className="absolute right-0 top-full mt-1 z-10 border rounded-lg shadow-lg py-1 min-w-[160px]"
                          style={{
                            borderColor: 'var(--line)',
                            backgroundColor: 'var(--white)',
                          }}
                          data-testid={`dropdown-${photo.id}`}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditPhoto(photo);
                              setOpenDropdownId(null);
                            }}
                            className="w-full text-left px-3 py-2 text-sm transition-colors hover:opacity-80"
                            style={{ color: 'var(--ink)' }}
                          >
                            Редактировать
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(photo);
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
            {paginatedPhotos.length === 0 && (
              <tr>
                <td
                  colSpan={VISIBLE_COLUMNS.length + 1}
                  className="px-4 py-12 text-center text-sm"
                  style={{ color: 'var(--ink-light)' }}
                >
                  Фото не найдены
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
          </select>
          <span>{sortedPhotos.length} всего</span>
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
      {editPhoto && (
        <PhotoModal
          mode="edit"
          photo={editPhoto}
          onSubmit={handleEdit}
          onClose={() => setEditPhoto(null)}
          title="Редактирование фото"
          subtitle={editPhoto.filename}
        />
      )}

      {/* Create modal */}
      {creatingPhoto && (
        <PhotoModal
          mode="create"
          photo={null}
          onSubmit={handleCreateSubmit}
          onClose={() => setCreatingPhoto(false)}
          title="Новое фото"
        />
      )}
    </div>
  );
}
