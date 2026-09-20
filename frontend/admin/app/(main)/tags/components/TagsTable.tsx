'use client';

import React, { useCallback, useMemo, useState } from 'react';
import type { DependencyNode, TagResponse } from '@memo/api-client';
import { ApiError } from '@memo/api-client';
import { useUpdateTag, useCreateTag, useDeleteTag } from '@/hooks/useTagsMutations';
import { useUI } from '@/contexts/UIContext';
import { useTagsTable } from '@/contexts/TagsContext';
import { TagModal } from './TagModal';
import { DataTable } from '@/app/components/shared/DataTable';
import { DeleteDialog } from '@/app/components/DeleteDialog';
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
  const { showToast } = useUI();

  // ─── Modal state ────────────────────────────────────────────────────────
  const [editTag, setEditTag] = useState<TagResponse | null>(null);
  const [creatingTag, setCreatingTag] = useState(false);

  // Delete — GH #318 (spec §3 D5): deferred flow, mirrors RecordsTable.
  // removeTag dry-runs (pure preview): a clean 204 removes the row
  // optimistically + enqueues the deferred delete (5s undo window, commit =
  // resolveDeleteTag); a 409 WITH the dependency tree rejects here → park
  // the tree + open DeleteDialog (the row stays visible). Any other error
  // keeps the error toast. Toasts on success come from the pending stack
  // («Удалено. Отменить» with the countdown ring) — not a success toast.
  const { removeTag, removeTagResolved } = useDeleteTag();
  const [deleteTarget, setDeleteTarget] = useState<{
    tag: TagResponse;
    deps: DependencyNode[];
  } | null>(null);

  const handleDelete = useCallback(async (tag: TagResponse) => {
    try {
      await removeTag(tag);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.dependencies) {
        setDeleteTarget({ tag, deps: err.dependencies });
        return;
      }
      // D5: non-409 dry-run errors keep their EXISTING toast surface —
      // parseApiError maps status/code to the established russian texts
      // («Не найдено» on 404 — error-messages.spec.ts Scenario 2).
      showToast(
        err instanceof Error
          ? parseApiError(err).message
          : 'Не удалось удалить. Попробуйте ещё раз.',
        'error',
      );
    }
  }, [removeTag, showToast]);

  // ─── Handlers ───────────────────────────────────────────────────────────

  const handleEdit = async (data: Record<string, unknown>) => {
    if (!editTag) return;
    const payload: { title?: string } = {};
    if (data.title !== null && data.title !== undefined) {
      payload.title = String(data.title);
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
      await createTag.mutateAsync({ title: String(data.title ?? '') });
      showToast('Тег создан');
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // §6.15 — memoize the factory outputs; handleDelete is a stable
  // useCallback (removeTag identity is stable), so the actions memo
  // recomputes only when it actually changes.
  const columns = useMemo(() => tagColumns(), []);
  const actions = useMemo(
    () =>
      tagActions({
        onEdit: (tag) => setEditTag(tag),
        onDelete: (tag) => void handleDelete(tag),
      }),
    [handleDelete],
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
        withSearch
        searchPlaceholder="Поиск тегов..."
        rowKey={(t) => t.id}
        rowTestId={(t) => `tag-row-${t.id}`}
        // Pre-#139 row classes were `border-b cursor-pointer transition-colors
        // hover:opacity-80`; the shared DataTable renders the base three, the
        // hover style is entity-parity and comes through rowClassName.
        rowClassName={() => 'hover:opacity-80'}
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
          subtitle={editTag.title}
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

      {/* Delete dialog — GH #318 (D5): opened on dry-run 409; the confirm
          enqueues the cascade deferred delete (enqueue is synchronous) and
          the dialog closes immediately via onDone. Tags never hit Mode B —
          the tag tree has no blocked deps (all 8 joins cascade). */}
      {deleteTarget && (
        <DeleteDialog
          entityName={deleteTarget.tag.title}
          entityType="tag"
          entityId={deleteTarget.tag.id}
          dependencies={deleteTarget.deps}
          onResolve={async (_id, resolutions) => {
            // D5: enqueue is synchronous — no await, the dialog closes at once.
            void removeTagResolved(deleteTarget.tag, resolutions, deleteTarget.deps);
          }}
          onArchive={async () => { /* tags have no archive flow — never Mode B */ }}
          onDone={() => setDeleteTarget(null)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
