'use client';

import React, { useState, useEffect, useCallback, useId } from 'react';
import {
  LOCATION_FIELDS,
  type LocationFieldConfig,
} from './locationFields';
import { Modal } from '@/app/components/shared/modal/Modal';

export interface LocationModalProps {
  location: Record<string, unknown> | null;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
  title: string;
  subtitle?: string;
}

/* ── Local inline field renderer ─────────────────────────────────── */

interface FieldRendererProps {
  field: LocationFieldConfig;
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

  const labelEl = (
    <label
      htmlFor={inputId}
      className="text-xs font-medium"
      style={{ color: 'var(--ink-light)' }}
    >
      {field.label}
      {'required' in field && field.required && (
        <span className="text-red-500 ml-0.5">*</span>
      )}
    </label>
  );

  const errorEl = error ? (
    <span className="text-xs" style={{ color: 'var(--danger)' }} id={errorId}>
      {error}
    </span>
  ) : null;

  const ariaDescribedBy = error ? errorId : undefined;

  switch (field.type) {
    case 'text':
      return (
        <div className="flex flex-col gap-1">
          {labelEl}
          <input
            id={inputId}
            type="text"
            value={(value as string) ?? ''}
            onChange={(e) => onChange(field.key, e.target.value)}
            placeholder={field.placeholder}
            disabled={field.disabled}
            className={baseInputClasses}
            style={baseStyle}
            aria-describedby={ariaDescribedBy}
          />
          {errorEl}
        </div>
      );

    case 'number':
      return (
        <div className="flex flex-col gap-1">
          {labelEl}
          <div className="flex items-center gap-2">
            <input
              id={inputId}
              type="number"
              value={(value as number) ?? ''}
              onChange={(e) =>
                onChange(field.key, e.target.value === '' ? '' : Number(e.target.value))
              }
              min={field.min}
              max={field.max}
              className={baseInputClasses}
              style={{ ...baseStyle, width: '120px' }}
              aria-describedby={ariaDescribedBy}
            />
            {field.suffix && (
              <span className="text-xs" style={{ color: 'var(--ink-light)' }}>
                {field.suffix}
              </span>
            )}
          </div>
          {errorEl}
        </div>
      );

    case 'textarea':
      return (
        <div className="flex flex-col gap-1">
          {labelEl}
          <textarea
            id={inputId}
            value={(value as string) ?? ''}
            onChange={(e) => onChange(field.key, e.target.value)}
            placeholder={field.placeholder}
            rows={field.rows ?? 3}
            className={baseInputClasses}
            style={{ ...baseStyle, resize: 'vertical' }}
            aria-describedby={ariaDescribedBy}
          />
          {errorEl}
        </div>
      );

    // GH #601 §2.6: switch button verbatim from ActivityForm `toggle-private`
    // — role="switch" + aria-checked, direct binding (checked = value).
    case 'boolean': {
      const checked = Boolean(value);
      return (
        <div className="flex flex-col gap-1">
          {labelEl}
          <button
            id={inputId}
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(field.key, !checked)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              checked ? 'bg-brand' : 'bg-ink-faint'
            }`}
            data-testid={field.testId ?? `toggle-${field.key}`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                checked ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
          {errorEl}
        </div>
      );
    }

    default:
      return null;
  }
}

/* ── LocationModal ───────────────────────────────────────────────── */

export function LocationModal({
  location,
  onSubmit,
  onClose,
  title,
  subtitle,
}: LocationModalProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    LOCATION_FIELDS.forEach((f) => {
      if (!location) {
        // Create mode: only the boolean carries a non-empty default (true —
        // GH #601 §2.6); text/number stay unset so the create UX (empty
        // inputs, required-field errors) is unchanged.
        if (f.type === 'boolean') initial[f.key] = true;
        return;
      }
      // Edit mode: nullish fallback — a boolean field defaults to `true`,
      // NOT the non-number empty string ('' would leave the switch as a
      // string and 422 the strict payload).
      initial[f.key] =
        location[f.key] ?? (f.type === 'boolean' ? true : f.type === 'number' ? 0 : '');
    });
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
    LOCATION_FIELDS.forEach((field) => {
      if ('required' in field && field.required) {
        const val = formData[field.key];
        if (val === undefined || val === null || val === '') {
          newErrors[field.key] = 'Обязательное поле';
        }
      }
      if (field.type === 'number') {
        const rawVal = formData[field.key];
        if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
          const val = Number(rawVal);
          if (!isNaN(val)) {
            if (field.min !== undefined && val < field.min) {
              newErrors[field.key] = `Минимум: ${field.min}`;
            }
            if (field.max !== undefined && val > field.max) {
              newErrors[field.key] = `Максимум: ${field.max}`;
            }
          }
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
    <div className="fixed inset-0 z-[var(--z-popover)] flex items-center justify-center" role="dialog" aria-modal="true">
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
          {LOCATION_FIELDS.map((field) => (
            <FieldRenderer
              key={field.key}
              field={field}
              value={formData[field.key]}
              onChange={handleChange}
              error={errors[field.key]}
            />
          ))}
        </div>
      </Modal>
    </div>
  );
}
