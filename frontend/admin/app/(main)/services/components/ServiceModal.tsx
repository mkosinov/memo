'use client';

import React, { useState, useEffect, useCallback, useId } from 'react';
import {
  SERVICE_FIELDS,
  type ServiceFieldConfig,
} from './serviceFields';

export interface ServiceModalProps {
  mode: 'create' | 'edit';
  service: Record<string, unknown> | null;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
  title: string;
  subtitle?: string;
}

/* ── Local inline field renderer ─────────────────────────────────── */

function useBaseInputClasses() {
  const baseId = useId();
  return { baseId };
}

interface FieldRendererProps {
  field: ServiceFieldConfig;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  error?: string;
}

function FieldRenderer({ field, value, onChange, error }: FieldRendererProps) {
  const { baseId } = useBaseInputClasses();
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

    default:
      return null;
  }
}

/* ── Local nested list for tariffs ───────────────────────────────── */

interface NestedListProps {
  field: Extract<ServiceFieldConfig, { type: 'nested-list' }>;
  items: Record<string, unknown>[];
  onChange: (items: Record<string, unknown>[]) => void;
}

function NestedList({ field, items, onChange }: NestedListProps) {
  const addItem = () => {
    const newItem: Record<string, unknown> = {};
    field.itemFields.forEach((f) => {
      newItem[f.key] = f.type === 'number' ? 0 : '';
    });
    onChange([...items, newItem]);
  };

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, key: string, value: unknown) => {
    const updated = items.map((item, i) =>
      i === index ? { ...item, [key]: value } : item,
    );
    onChange(updated);
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
        {field.label}
      </label>
      {items.length === 0 && (
        <div className="text-xs py-2" style={{ color: 'var(--ink-light)' }}>
          {field.emptyText}
        </div>
      )}
      {items.map((item, index) => (
        <div
          key={index}
          className="rounded-lg border p-3 relative"
          style={{ borderColor: 'var(--line)', backgroundColor: 'var(--surface)' }}
        >
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-medium" style={{ color: 'var(--ink-mid)' }}>
              {field.itemLabel} {index + 1}
            </span>
            <button
              onClick={() => removeItem(index)}
              className="text-xs hover:text-red-500"
              style={{ color: 'var(--ink-light)' }}
              aria-label={`Удалить ${field.itemLabel}`}
            >
              🗑
            </button>
          </div>
          <div className="space-y-2">
            {field.itemFields.map((itemField) => (
              <FieldRenderer
                key={itemField.key}
                field={itemField}
                value={item[itemField.key]}
                onChange={(key, val) => updateItem(index, key, val)}
              />
            ))}
          </div>
        </div>
      ))}
      <button
        onClick={addItem}
        className="text-xs font-medium self-start px-3 py-1 rounded-lg border border-dashed transition-colors hover:bg-brand/5"
        style={{ borderColor: 'var(--brand)', color: 'var(--brand)' }}
      >
        {field.addButtonText}
      </button>
    </div>
  );
}

/* ── ServiceModal ────────────────────────────────────────────────── */

export function ServiceModal({
  mode,
  service,
  onSubmit,
  onClose,
  title,
  subtitle,
}: ServiceModalProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>(() => {
    if (!service) return {};
    const initial: Record<string, unknown> = {};
    SERVICE_FIELDS.forEach((f) => {
      initial[f.key] =
        service[f.key] ?? (f.type === 'number' ? 0 : f.type === 'nested-list' ? [] : '');
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
    SERVICE_FIELDS.forEach((field) => {
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
    // Cross-field: min_age <= max_age
    const minAge = formData['min_age'] as number | undefined;
    const maxAge = formData['max_age'] as number | undefined;
    if (minAge !== undefined && maxAge !== undefined && minAge > maxAge) {
      newErrors['min_age'] = 'Не может быть больше возраста до';
      newErrors['max_age'] = 'Не может быть меньше возраста от';
    }
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
        className="relative bg-white rounded-xl shadow-2xl w-full max-w-[800px] mx-4 flex flex-col overflow-hidden"
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
          {SERVICE_FIELDS.map((field) => {
            if (field.type === 'nested-list') {
              return (
                <NestedList
                  key={field.key}
                  field={field}
                  items={(formData[field.key] as Record<string, unknown>[]) ?? []}
                  onChange={(items) => handleChange(field.key, items)}
                />
              );
            }
            return (
              <FieldRenderer
                key={field.key}
                field={field}
                value={formData[field.key]}
                onChange={handleChange}
                error={errors[field.key]}
              />
            );
          })}
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
