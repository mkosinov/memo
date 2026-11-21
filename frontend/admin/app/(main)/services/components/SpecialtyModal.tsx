'use client';

import React, { useState, useEffect, useCallback, useId } from 'react';
import { SPECIALTY_FIELDS, type SpecialtyFieldConfig } from './specialtyFields';
import { Modal } from '@/app/components/shared/modal/Modal';

export interface SpecialtyModalProps {
  /** The row being edited (null in create mode). */
  specialty: Record<string, unknown> | null;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
  title: string;
  subtitle?: string;
}

/* ── Local inline field renderer (PositionModal precedent) ────────── */

interface FieldRendererProps {
  field: SpecialtyFieldConfig;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  error?: string;
}

function FieldRenderer({ field, value, onChange, error }: FieldRendererProps) {
  const baseId = useId();
  const inputId = `${baseId}-${field.key}`;
  const errorId = `${baseId}-${field.key}-error`;

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

  const errorEl = error ? (
    <span className="text-xs" style={{ color: 'var(--danger)' }} id={errorId}>
      {error}
    </span>
  ) : null;

  return (
    <div className="flex flex-col gap-1">
      {labelEl}
      <input
        id={inputId}
        type="text"
        value={(value as string) ?? ''}
        onChange={(e) => onChange(field.key, e.target.value)}
        placeholder={field.placeholder}
        className="w-full rounded-lg border px-3 py-2 text-sm transition-colors"
        style={{
          borderColor: error ? 'var(--danger)' : 'var(--line)',
          backgroundColor: 'var(--white)',
          color: 'var(--ink)',
        }}
        aria-describedby={error ? errorId : undefined}
      />
      {errorEl}
    </div>
  );
}

/* ── SpecialtyModal ───────────────────────────────────────────────── */

export function SpecialtyModal({
  specialty,
  onSubmit,
  onClose,
  title,
  subtitle,
}: SpecialtyModalProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>(() => {
    if (!specialty) return {};
    const initial: Record<string, unknown> = {};
    SPECIALTY_FIELDS.forEach((f) => {
      initial[f.key] = specialty[f.key] ?? '';
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
    SPECIALTY_FIELDS.forEach((field) => {
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
      // Toast handled by caller — the modal stays open so the user can fix
      // the title (e.g. a 409 SPECIALTY_TITLE_TAKEN case-variant collision).
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
    <div
      className="fixed inset-0 z-[var(--z-popover)] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={handleClose} />
      <Modal
        title={title}
        context={subtitle}
        onClose={handleClose}
        size="small"
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
        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-4">
          {SPECIALTY_FIELDS.map((field) => (
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
