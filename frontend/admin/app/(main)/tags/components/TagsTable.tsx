'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getTags } from '@memo/api-client';
import type { TagResponse } from '@memo/api-client';
import { useUpdateTag, useCreateTag, useDeleteTag } from '@/hooks/useTagsMutations';
import { useUI } from '@/contexts/UIContext';
import { TagModal } from './TagModal';
import { ColumnPicker } from '@/app/components/shared/ColumnPicker';

// ─── Column definitions ──────────────────────────────────────────────────

interface Column {
  key: string;
  label: string;
  width?: string;
  defaultVisible?: boolean;
}

const COLUMNS: Column[] = [
  { key: 'tag', label: 'Тег', width: 'flex-1', defaultVisible: true },
  { key: 'status', label: 'Статус', width: 'w-[100px]', defaultVisible: true },
];

// ─── Component ───────────────────────────────────────────────────────────

export function TagsTable() {
  const { data: tags = [], isLoading } = useQuery<TagResponse[]>({
    queryKey: ['tags'],
    queryFn: getTags,
  });

  const updateTag = useUpdateTag();
  const createTag = useCreateTag();
  const deleteTag = useDeleteTag();
  const { showToast } = useUI();

  // ─── Column visibility state ───────────────────────────────────────
  const [visibleKeys, setVisibleKeys] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('tags-columns');
      if (stored) return JSON.parse(stored);
    } catch {
      // ignore
    }
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
  const [editTag, setEditTag] = useState<TagResponse | null>(null);

  // ─── Create modal state ─────────────────────────────────────────────
  const [creatingTag, setCreatingTag] = useState(false);

  // ─── Action dropdown state ───────────────────────────────────────────
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [search, status]);

  // ─── Filtered data ───────────────────────────────────────────────────

  const filteredTags = useMemo(() => {
    return tags.filter((tag) => {
      // Search filter (tag name contains)
      if (search) {
        const q = search.toLowerCase();
        if (!tag.tag.toLowerCase().includes(q)) return false;
      }
      // Status filter (tags don't have is_active in response, but we can show them all)
      // For now, show all tags as the API only returns active ones
      return true;
    });
  }, [tags, search, status]);

  // ─── Sorted data ─────────────────────────────────────────────────────

  const sortedTags = useMemo(() => {
    if (!sortField) return filteredTags;
    const sorted = [...filteredTags];
    sorted.sort((a, b) => {
      const aVal = a[sortField as keyof TagResponse];
      const bVal = b[sortField as keyof TagResponse];
      let cmp = 0;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        cmp = aVal.localeCompare(bVal, 'ru');
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredTags, sortField, sortDir]);

  // ─── Pagination ──────────────────────────────────────────────────────

  const paginatedTags = useMemo(() => {
    return sortedTags.slice(page * pageSize, (page + 1) * pageSize);
  }, [sortedTags, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(sortedTags.length / (pageSize || 10)));

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
    if (!editTag) return;
    const payload: { tag?: string } = {};
    if (data.tag !== null && data.tag !== undefined) {
      payload.tag = String(data.tag);
    }
    await updateTag.mutateAsync({
      id: editTag.id,
      data: payload,
    });
    showToast('Тег обновлён');
    setEditTag(null);
  };

  // ─── Create ─────────────────────────────────────────────────────────

  const handleCreateSubmit = async (data: Record<string, unknown>) => {
    await createTag.mutateAsync({ tag: String(data.tag ?? '') });
    showToast('Тег создан');
  };

  // ─── Delete ─────────────────────────────────────────────────────────

  const handleDelete = async (tag: TagResponse) => {
    setOpenDropdownId(null);
    if (!window.confirm('Удалить тег?')) return;
    await deleteTag.mutateAsync(tag.id);
    showToast('Тег удалён');
  };

  // ─── Loading ─────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="px-4 py-12 text-center text-sm" style={{ color: 'var(--ink-light)' }}>
        Загрузка...
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────

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
            placeholder="Поиск тегов..."
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
        </div>
        <div className="flex items-center gap-2">
          <ColumnPicker
            columns={COLUMNS.map((c) => ({ key: c.key, label: c.label }))}
            visibleKeys={visibleKeys}
            onChange={setVisibleKeys}
            storageKey="tags-columns"
          />
          <button
            onClick={() => setCreatingTag(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            + Добавить тег
          </button>
        </div>
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
            {paginatedTags.map((tag) => (
              <tr
                key={tag.id}
                onClick={() => setEditTag(tag)}
                className="border-b cursor-pointer transition-colors hover:opacity-80"
                style={{ borderColor: 'var(--line)' }}
                data-testid={`tag-row-${tag.id}`}
              >
                {/* Tag name */}
                {visibleKeys.includes('tag') && (
                  <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--ink)' }}>
                    {tag.tag}
                  </td>
                )}

                {/* Status — tags from API are always active */}
                {visibleKeys.includes('status') && (
                  <td className="px-4 py-3 text-sm">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                      Активен
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
                          setOpenDropdownId(openDropdownId === tag.id ? null : tag.id);
                        }}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-sm transition-colors"
                        style={{ color: 'var(--ink-light)' }}
                        aria-label="Действия"
                      >
                        ⋯
                      </button>
                      {openDropdownId === tag.id && (
                        <div
                          className="absolute right-0 top-full mt-1 z-10 border rounded-lg shadow-lg py-1 min-w-[160px]"
                          style={{
                            borderColor: 'var(--line)',
                            backgroundColor: 'var(--white)',
                          }}
                          data-testid={`dropdown-${tag.id}`}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditTag(tag);
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
                              handleDelete(tag);
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
            {paginatedTags.length === 0 && (
              <tr>
                <td
                  colSpan={VISIBLE_COLUMNS.length + 1}
                  className="px-4 py-12 text-center text-sm"
                  style={{ color: 'var(--ink-light)' }}
                >
                  Теги не найдены
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
          <span>{sortedTags.length} всего</span>
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
      {editTag && (
        <TagModal
          mode="edit"
          tag={editTag}
          onSubmit={handleEdit}
          onClose={() => setEditTag(null)}
          title="Редактирование тега"
          subtitle={editTag.tag}
        />
      )}

      {/* Create modal */}
      {creatingTag && (
        <TagModal
          mode="create"
          tag={null}
          onSubmit={handleCreateSubmit}
          onClose={() => setCreatingTag(false)}
          title="Новый тег"
        />
      )}
    </div>
  );
}
