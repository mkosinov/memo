'use client';

import React, { useMemo, useState } from 'react';
import type { TagResponse } from '@memo/api-client';
import { useUpdateTag, useCreateTag, useDeleteTag } from '@/hooks/useTagsMutations';
import { useUI } from '@/contexts/UIContext';
import { useTagsTable } from '@/contexts/TagsContext';
import { TagModal } from './TagModal';
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

// Single sortable key — matches the backend tags sort whitelist (just `tag`).
const COLUMNS: Column[] = [
  { key: 'tag', label: 'Тег', width: 'flex-1', defaultVisible: true },
];

// ─── Component ───────────────────────────────────────────────────────────

export function TagsTable() {
  // ─── Server pagination/sort state (TagsContext, #205 §5.2) ───────────────
  const {
    items,
    total,
    page,
    perPage,
    sortBy,
    sortOrder,
    isLoading,
    error,
    setPage,
    setPerPage,
    setSort,
    refetch,
  } = useTagsTable();

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
  // Search stays client-side (G1b Q1): it filters the currently loaded page
  // only — the temporary degradation until server ?q= lands in #212.
  const [search, setSearch] = useState('');

  // ─── Edit modal state ────────────────────────────────────────────────
  const [editTag, setEditTag] = useState<TagResponse | null>(null);

  // ─── Create modal state ─────────────────────────────────────────────
  const [creatingTag, setCreatingTag] = useState(false);

  // ─── Action dropdown state ───────────────────────────────────────────
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  // ─── Filtered data (client-side search over the loaded page) ───────────

  const filteredTags = useMemo(() => {
    return items.filter((tag) => {
      // Search filter (tag name contains)
      if (search) {
        const q = search.toLowerCase();
        if (!tag.tag.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [items, search]);

  // ─── Pagination (server-driven) ────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  // ─── Sort handler ────────────────────────────────────────────────────

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

  // ─── Edit handlers ───────────────────────────────────────────────────

  const handleEdit = async (data: Record<string, unknown>) => {
    if (!editTag) return;
    const payload: { tag?: string } = {};
    if (data.tag !== null && data.tag !== undefined) {
      payload.tag = String(data.tag);
    }
    try {
      await updateTag.mutateAsync({
        id: editTag.id,
        data: payload,
      });
      showToast('Тег обновлён');
      setEditTag(null);
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // ─── Create ─────────────────────────────────────────────────────────

  const handleCreateSubmit = async (data: Record<string, unknown>) => {
    try {
      await createTag.mutateAsync({ tag: String(data.tag ?? '') });
      showToast('Тег создан');
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // ─── Delete ─────────────────────────────────────────────────────────

  const handleDelete = async (tag: TagResponse) => {
    setOpenDropdownId(null);
    if (!window.confirm('Удалить тег?')) return;
    try {
      await deleteTag.mutateAsync(tag.id);
      showToast('Тег удалён');
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
      <div>
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
            {filteredTags.map((tag) => (
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
            {filteredTags.length === 0 && (
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
