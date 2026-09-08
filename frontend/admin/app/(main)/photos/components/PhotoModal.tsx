'use client';

import React, { useState, useEffect, useCallback, useMemo, useId } from 'react';
import { PHOTO_FIELDS, type PhotoFieldConfig } from './photoFields';
import RemoteSearchSelect from '@/app/components/shared/RemoteSearchSelect';
import { Combobox, type ComboboxOption } from '@/app/components/shared/Combobox';
import { Modal } from '@/app/components/shared/modal/Modal';
import {
  getClientsPaged,
  getServices,
  getActivities,
  getTags,
} from '@memo/api-client';
import type { PhotoResponse } from '@memo/api-client';
import { useLocationsRaw } from '@/hooks/useLocations';
import { formatActivityLabel } from '@/lib/utils';

export interface PhotoModalProps {
  mode: 'create' | 'edit';
  photo: PhotoResponse | null;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
  title: string;
  subtitle?: string;
}

/** The four mutually-exclusive owner slots (GH #211 §6.2). */
const OWNER_KEYS = ['client_id', 'service_id', 'activity_id', 'location_id'] as const;

/* ── Local inline field renderer ─────────────────────────────────── */

interface FieldRendererProps {
  field: PhotoFieldConfig;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  error?: string;
  /** Combobox options — supplied by the modal (dictionary-backed). */
  selectOptions?: ComboboxOption[];
  /** Locations map feeding the canonical activity label (spec §7.7). */
  locationTitleMap?: Map<string, { title: string }>;
  /** Remount key for searchable fields — bumped when the owner is cleared
   *  by its mutually-exclusive pair, so the typeahead drops its stale label. */
  remountKey?: number;
}

function FieldRenderer({
  field,
  value,
  onChange,
  error,
  selectOptions,
  locationTitleMap,
  remountKey,
}: FieldRendererProps) {
  const baseId = useId();
  const inputId = `${baseId}-${field.key}`;
  const errorId = `${baseId}-${field.key}-error`;

  const baseInputClasses = 'w-full rounded-lg border px-3 py-2 text-sm transition-colors';
  const baseStyle = {
    borderColor: error ? 'var(--danger)' : 'var(--line)',
    backgroundColor: 'var(--white)',
    color: 'var(--ink)',
  };

  const errorEl = error ? (
    <span className="text-xs" style={{ color: 'var(--danger)' }} id={errorId}>
      {error}
    </span>
  ) : null;

  const ariaDescribedBy = error ? errorId : undefined;

  if (field.type === 'tags') {
    // Tags field - multi-select with search
    const selectedTags = (value as Array<{ id: string; tag: string }>) || [];
    const selectedTagIds = selectedTags.map(t => t.id);
    
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={{ color: 'var(--ink-light)' }}>
          {field.label}
        </label>
        <div className="flex flex-wrap gap-2 mb-2">
          {selectedTags.map(tag => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800"
            >
              {tag.tag}
              <button
                type="button"
                onClick={() => {
                  const newTags = selectedTags.filter(t => t.id !== tag.id);
                  onChange(field.key, newTags);
                }}
                className="hover:text-blue-600"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <RemoteSearchSelect
          value={null}
          onChange={() => {}}
          onSelectItem={(item) => {
            if (!selectedTagIds.includes(item.id as string)) {
              onChange(field.key, [...selectedTags, { id: item.id, tag: item.tag }]);
            }
          }}
          onSearch={async (q) => (await getTags({ q, per_page: 10 })).items}
          label=""
          displayField="tag"
          placeholder={field.placeholder || 'Добавить тег...'}
          minChars={2}
        />
      </div>
    );
  }

  if (field.type === 'searchable') {
    // Map field keys to search functions (GH #211: client/service/activity —
    // visitor_id is gone; owners are mutually exclusive, no auto-fill).
    // RemoteSearchSelect's SearchItem shape: { id: string; [key: string]: unknown }.
    let searchFn: (q: string) => Promise<Array<{ id: string; [key: string]: unknown }>>;

    if (field.key === 'client_id') {
      // Photo pickers always request active clients only (spec §7.3).
      searchFn = async (q: string) =>
        (await getClientsPaged({ q, per_page: 10, status: 'active' })).items.map((c) => ({
          ...c,
          name: c.name || 'Дорогой гость',
        }));
    } else if (field.key === 'service_id') {
      searchFn = async (q: string) => (await getServices({ q, per_page: 10 })).items;
    } else {
      // activity_id — options carry THE canonical label (spec §7.7):
      // «dd.mm.yyyy HH:mm — Локация — Услуга» via formatActivityLabel; the
      // modal's useLocationsRaw() map feeds it (no extra fetch). No subtitle,
      // no datetime-only special case — options AND the selected value render
      // the same label.
      const titleMap = locationTitleMap ?? new Map<string, { title: string }>();
      searchFn = async (q: string) => {
        const res = await getActivities({ q, per_page: 10 });
        return res.items.map((a) => ({ ...a, label: formatActivityLabel(a, titleMap) }));
      };
    }

    return (
      <div className="flex flex-col gap-1">
        <RemoteSearchSelect
          key={remountKey ?? 0}
          value={(value as string) ?? null}
          onChange={(uuid) => onChange(field.key, uuid)}
          onSearch={searchFn}
          label={field.label}
          displayField={field.displayField}
          placeholder={field.placeholder}
          required={field.required}
          minChars={2}
        />
        {errorEl}
      </div>
    );
  }

  if (field.type === 'select') {
    // GH #214 row 9: native <select> → Combobox. Keeps today's exact
    // '' → null boundary mapping (`e.target.value || null` → `v || null`).
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={{ color: 'var(--ink-light)' }}>
          {field.label}
          {field.required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        <Combobox
          clearLabel={field.emptyLabel}
          value={(value as string) ?? ''}
          options={selectOptions ?? []}
          onChange={(v) => onChange(field.key, v || null)}
          className={baseInputClasses}
          ariaLabel={field.label}
        />
        {errorEl}
      </div>
    );
  }

  const labelEl = (
    <label
      htmlFor={inputId}
      className="text-xs font-medium"
      style={{ color: 'var(--ink-light)' }}
    >
      {field.label}
      {field.required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );

  return (
    <div className="flex flex-col gap-1">
      {labelEl}
      <input
        id={inputId}
        type="text"
        value={(value as string) ?? ''}
        onChange={(e) => onChange(field.key, e.target.value)}
        placeholder={field.placeholder}
        className={baseInputClasses}
        style={baseStyle}
        aria-describedby={ariaDescribedBy}
      />
      {errorEl}
    </div>
  );
}

/* ── PhotoModal ───────────────────────────────────────────────────── */

export function PhotoModal({
  mode,
  photo,
  onSubmit,
  onClose,
  title,
  subtitle,
}: PhotoModalProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>(() => {
    if (!photo) return {};
    const initial: Record<string, unknown> = {};
    PHOTO_FIELDS.forEach((f) => {
      if (f.type === 'tags') {
        initial[f.key] = photo.tags || [];
      } else {
        initial[f.key] = (photo as Record<string, unknown>)[f.key] ?? '';
      }
    });
    initial.is_public = photo.is_public ?? false;
    return initial;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Remount counters for the searchable owner fields — bumped when the
  // mutually-exclusive pair clears a selection, so the typeahead re-renders
  // without its stale selectedLabel (PhotosFilters resetKey precedent).
  const [fieldRemount, setFieldRemount] = useState<Record<string, number>>({});

  // Locations dictionary — useLocationsRaw (#140: shared ['locations'] key,
  // so inside PhotosContext this is a cache hit, no extra fetch). Feeds BOTH
  // the «Локация» select options and the canonical activity label (§7.7).
  const { data: locations = [] } = useLocationsRaw();

  const locationOptions = useMemo(
    () =>
      locations.map((l) => ({
        value: l.id,
        label: l.name,
        searchText: `${l.name} ${l.short_title ?? ''}`.trim(),
      })),
    [locations],
  );

  // formatActivityLabel's contract is Map<string, { title }> — adapt the
  // LocationResponse list (locations carry `name`, not `title`).
  const locationTitleMap = useMemo(() => {
    const map = new Map<string, { title: string }>();
    locations.forEach((l) => map.set(l.id, { title: l.name }));
    return map;
  }, [locations]);

  const handleChange = useCallback((key: string, value: unknown) => {
    setFormData((prev) => {
      const next = { ...prev, [key]: value };
      // Mutually-exclusive owner pair (GH #211 §6.2): picking an activity
      // clears the selected service and vice versa — no auto-fill. Done in
      // the change handler (not effects) so the pair can never ping-pong.
      if (key === 'activity_id' && value && prev.service_id) {
        next.service_id = null;
      } else if (key === 'service_id' && value && prev.activity_id) {
        next.activity_id = null;
      }
      return next;
    });
    // The cleared counterpart must remount so its typeahead drops the stale
    // selected label (functional update — stable callback identity).
    // Bumping even when the pair was already empty is harmless: the remount
    // of a clean typeahead changes nothing visible.
    if (key === 'activity_id' || key === 'service_id') {
      const other = key === 'activity_id' ? 'service_id' : 'activity_id';
      setFieldRemount((prev) => ({ ...prev, [other]: (prev[other] ?? 0) + 1 }));
    }
    setIsDirty(true);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};
    PHOTO_FIELDS.forEach((field) => {
      if (field.required) {
        const val = formData[field.key];
        if (val === undefined || val === null || val === '') {
          newErrors[field.key] = 'Обязательное поле';
        }
      }
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  const handleSubmit = async () => {
    if (!validate()) return;
    setIsSubmitting(true);
    // Owners travel as null (never '') — matches PhotoCreate/PhotoUpdate and
    // lets the server's ≥2-owner 422 surface through the existing catch.
    const payload: Record<string, unknown> = { ...formData };
    OWNER_KEYS.forEach((k) => {
      payload[k] = typeof payload[k] === 'string' && payload[k] !== '' ? payload[k] : null;
    });
    try {
      await onSubmit(payload);
      onClose();
    } catch {
      // Toast handled by caller; modal stays open so the error is actionable
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = useCallback(() => {
    if (isDirty) {
      if (!window.confirm('Есть несохранённые изменения. Закрыть?')) return;
    }
    onClose();
  }, [isDirty, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={handleClose}
      />
      <Modal
        title={title}
        context={subtitle}
        onClose={handleClose}
        footer={
          <div className="flex justify-end gap-2">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm rounded-lg border transition-colors"
              style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
            >
              Отмена
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm rounded-lg text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              {isSubmitting ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        }
      >
        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-4">
          {/* Image preview */}
          {mode === 'edit' && photo?.filename && (
            <div className="rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center" style={{ maxHeight: '300px' }}>
              <img
                src={photo.filename}
                alt={photo.filename}
                className="max-w-full max-h-[300px] object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
          )}

          {PHOTO_FIELDS.map((field) => (
            <FieldRenderer
              key={field.key}
              field={field}
              value={formData[field.key]}
              onChange={handleChange}
              error={errors[field.key]}
              selectOptions={locationOptions}
              locationTitleMap={locationTitleMap}
              remountKey={fieldRemount[field.key]}
            />
          ))}

          {/* is_public toggle */}
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium" style={{ color: 'var(--ink-light)' }}>
              Публичное фото
            </label>
            <button
              type="button"
              onClick={() => handleChange('is_public', !formData.is_public)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                formData.is_public ? 'bg-brand' : 'bg-gray-300'
              }`}
              role="switch"
              aria-checked={!!formData.is_public}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  formData.is_public ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
