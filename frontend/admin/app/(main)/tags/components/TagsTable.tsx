'use client';

import React, { useMemo, useState } from 'react';
import type { TagResponse } from '@memo/api-client';
import { useUpdateTag, useCreateTag, useDeleteTag } from '@/hooks/useTagsMutations';
import { useUI } from '@/contexts/UIContext';
import { useTagsTable } from '@/contexts/TagsContext';
import { TagModal } from './TagModal';
import { DataTable } from '@/app/components/shared/DataTable';
import { tagColumns, tagActions } from './tagColumns';
import { parseApiError } from '@/app/lib/api/parseApiError';

/**
 * Tags table — thin wiring wrapper over the shared DataTable (#139 T1).
 * All table mechanics (sort/pager/skeleton/LS/column-picker/action-menu)
 * live in <DataTable>; this file keeps only entity dialogs and mutations.
 */
export function TagsTable() {
  // Server pagination/sort/search state (TagsContext, #205 §5.2 + #139 §6.7)
  const tagsTable = useTagsTable();

  const updateTag = useUpdateTag();
  const createTag = useCreateTag();
  const deleteTag = useDeleteTag();
  const { showToast } = useUI();

  // ─── Modal state ────────────────────────────────────────────────────────
  const [editTag, setEditTag] = useState<TagResponse | null>(null);
  const [creatingTag, setCreatingTag] = useState(false);

  // ─── Handlers ───────────────────────────────────────────────────────────

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

  const handleCreateSubmit = async (data: Record<string, unknown>) => {
    try {
      await createTag.mutateAsync({ tag: String(data.tag ?? '') });
      showToast('Тег создан');
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // Delete keeps the §6.9 locked window.confirm flow (TagsTable.tsx:143-152)
  const handleDelete = async (tag: TagResponse) => {
    if (!window.confirm('Удалить тег?')) return;
    try {
      await deleteTag.mutateAsync(tag.id);
      showToast('Тег удалён');
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // §6.15 — memoize the factory outputs
  const columns = useMemo(() => tagColumns(), []);
  const actions = useMemo(
    () =>
      tagActions({
        onEdit: (tag) => setEditTag(tag),
        onDelete: (tag) => void handleDelete(tag),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- §6.15 stable identity
    [],
  );

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div>
      <DataTable<TagResponse>
        storageKey="tags-columns"
        columns={columns}
        tableState={tagsTable}
        actions={actions}
        onRowClick={setEditTag}
        emptyLabel="Теги не найдены"
        withSearch
        searchPlaceholder="Поиск тегов..."
        rowKey={(t) => t.id}
        rowTestId={(t) => `tag-row-${t.id}`}
        toolbarExtras={
          <button
            onClick={() => setCreatingTag(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            + Добавить тег
          </button>
        }
      />

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
