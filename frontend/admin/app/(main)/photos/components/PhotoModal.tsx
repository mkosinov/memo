'use client';

import React, { useState, useEffect, useCallback, useId } from 'react';
import { PHOTO_FIELDS, type PhotoFieldConfig } from './photoFields';
import SearchableSelect from '@/app/components/shared/SearchableSelect';
import { searchVisitors, searchServices, searchActivities } from '@memo/api-client';

export interface PhotoModalProps {
  mode: 'create' | 'edit';
  photo: Record<string, unknown> | null;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
  title: string;
  subtitle?: string;
}

/* ── Local inline field renderer ─────────────────────────────────── */

interface FieldRendererProps {
  field: PhotoFieldConfig;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  error?: string;
}

function FieldRenderer({ field, value, onChange, error }: FieldRendererProps) {
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

  if (field.type === 'searchable') {
    // Map field keys to search functions
    const searchFn = field.key === 'visitor_id' 
      ? searchVisitors 
      : field.key === 'service_id' 
        ? searchServices 
        : searchActivities;

    return (
      <div className="flex flex-col gap-1">
        <SearchableSelect
          value={(value as string) ?? null}
          onChange={(uuid) => onChange(field.key, uuid)}
          onSearch={searchFn}
          label={field.label}
          displayField={field.displayField}
          subtitleField={field.subtitleField}
          placeholder={field.placeholder}
          required={field.required}
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
      initial[f.key] = photo[f.key] ?? '';
    });
    initial.is_public = photo.is_public ?? false;
    return initial;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = useCallback((key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
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
    try {
      await onSubmit(formData);
      onClose();
    } catch {
      // Toast handled by caller
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
      <div
        className="relative bg-white rounded-xl shadow-2xl w-full max-w-[600px] mx-4 flex flex-col overflow-hidden"
        style={{ maxHeight: '85vh' }}
      >
        {/* Header */}
        <div className="flex justify-between items-start px-6 pt-6 pb-4">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
              {title}
            </h2>
            {subtitle && (
              <p className="text-sm mt-0.5" style={{ color: 'var(--ink-light)' }}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:opacity-80"
            style={{ backgroundColor: 'var(--surface)', color: 'var(--ink-light)' }}
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-4">
          {PHOTO_FIELDS.map((field) => (
            <FieldRenderer
              key={field.key}
              field={field}
              value={formData[field.key]}
              onChange={handleChange}
              error={errors[field.key]}
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

        {/* Footer */}
        <div
          className="flex justify-end gap-2 px-6 py-4 border-t"
          style={{ borderColor: 'var(--line)' }}
        >
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
      </div>
    </div>
  );
}
