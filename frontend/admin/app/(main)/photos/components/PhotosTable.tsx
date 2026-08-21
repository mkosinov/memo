'use client';

import React, { useMemo, useState } from 'react';
import type { PhotoResponse } from '@memo/api-client';
import { useUpdatePhoto, useCreatePhoto, useDeletePhoto } from '@/hooks/usePhotosMutations';
import { useUI } from '@/contexts/UIContext';
import { usePhotosTable } from '@/contexts/PhotosContext';
import { PhotoModal } from './PhotoModal';
import { DataTable } from '@/app/components/shared/DataTable';
import { photoColumns, photoActions } from './photoColumns';
import { parseApiError } from '@/app/lib/api/parseApiError';

/**
 * Photos table — thin wiring wrapper over the shared DataTable (#139 T7).
 * All table mechanics (sort/pager/skeleton/LS/column-picker/action-menu/
 * search) live in <DataTable>; the list state comes from PhotosContext — an
 * interim CLIENT adapter over the unpaginated getPhotos() endpoint (#211
 * will swap in real server pagination without touching this file). Only
 * entity dialogs and mutations stay here.
 */
export function PhotosTable() {
  // Client-paginated list state (PhotosContext adapter, #139 T7)
  const photosTable = usePhotosTable();

  const updateMutation = useUpdatePhoto();
  const createMutation = useCreatePhoto();
  const deleteMutation = useDeletePhoto();
  const { showToast } = useUI();

  // ─── Modal state ────────────────────────────────────────────────────────
  const [editPhoto, setEditPhoto] = useState<PhotoResponse | null>(null);
  const [creatingPhoto, setCreatingPhoto] = useState(false);

  // ─── Handlers (verbatim pre-#139) ───────────────────────────────────────

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
    try {
      await updateMutation.mutateAsync({
        id: editPhoto.id,
        data: payload,
      });
      showToast('Фото обновлено');
      setEditPhoto(null);
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  const handleCreateSubmit = async (data: Record<string, unknown>) => {
    const tags = (data.tags as Array<{ id: string; tag: string }>) || [];
    try {
      await createMutation.mutateAsync({
        filename: String(data.filename ?? ''),
        visitor_id: String(data.visitor_id ?? ''),
        service_id: String(data.service_id ?? ''),
        activity_id: String(data.activity_id ?? ''),
        is_public: Boolean(data.is_public),
        tag_ids: tags.map(t => t.id),
      });
      showToast('Фото создано');
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  const handleDelete = async (photo: PhotoResponse) => {
    // Delete keeps the §6.9 locked window.confirm flow (pre-#139 PhotosTable)
    if (!window.confirm('Удалить фото?')) return;
    try {
      await deleteMutation.mutateAsync(photo.id);
      showToast('Фото удалено');
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // §6.15 — memoize the factory outputs
  const columns = useMemo(() => photoColumns(), []);
  const actions = useMemo(
    () =>
      photoActions({
        onEdit: (p) => setEditPhoto(p),
        onDelete: (p) => void handleDelete(p),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- §6.15 stable identity
    [],
  );

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div>
      <DataTable<PhotoResponse>
        storageKey="photos-columns"
        columns={columns}
        tableState={photosTable}
        actions={actions}
        onRowClick={setEditPhoto}
        withSearch
        searchPlaceholder="Поиск фото..."
        rowKey={(p) => p.id}
        rowTestId={(p) => `photo-row-${p.id}`}
        // Pre-#139 row classes were `border-b cursor-pointer transition-colors
        // hover:opacity-80`; the shared DataTable renders the base three, the
        // hover style is entity-parity and comes through rowClassName.
        rowClassName={() => 'hover:opacity-80'}
        toolbarExtras={
          <button
            onClick={() => setCreatingPhoto(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            + Добавить фото
          </button>
        }
      />

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
