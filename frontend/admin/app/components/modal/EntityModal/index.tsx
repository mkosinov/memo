'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FieldRenderer } from './FieldRenderer';
import { NestedList } from './NestedList';
import type { FieldConfig, NestedListFieldConfig } from './types';

export type { FieldConfig };

export interface EntityModalProps {
  mode: 'create' | 'edit';
  entity: Record<string, unknown> | null;
  fields: FieldConfig[];
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
  title: string;
  subtitle?: string;
  width?: 'default' | 'wide';
}

export function EntityModal({
  mode,
  entity,
  fields,
  onSubmit,
  onClose,
  title,
  subtitle,
  width = 'default',
}: EntityModalProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>(() => {
    if (!entity) return {};
    const initial: Record<string, unknown> = {};
    fields.forEach((f) => {
      initial[f.key] =
        entity[f.key] ?? (f.type === 'number' ? 0 : f.type === 'nested-list' ? [] : '');
    });
    return initial;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const maxW = width === 'wide' ? 'max-w-[800px]' : 'max-w-[600px]';

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
    fields.forEach((field) => {
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
  }, [fields, formData]);

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
        className={`relative bg-white rounded-xl shadow-2xl w-full ${maxW} mx-4 flex flex-col overflow-hidden`}
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
          {fields.map((field) => {
            if (field.type === 'nested-list') {
              return (
                <NestedList
                  key={field.key}
                  field={field as NestedListFieldConfig}
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
