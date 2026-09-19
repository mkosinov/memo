'use client';

import React, { useState, useEffect, useCallback, useId } from 'react';
import {
  SERVICE_FIELDS,
  type ServiceFieldConfig,
} from './serviceFields';
import { Modal } from '@/app/components/shared/modal/Modal';
import { useMaterialsRaw } from '@/hooks/useMaterials';
import type { ServiceMaterialLink } from '@memo/api-client';

export interface ServiceModalProps {
  mode: 'create' | 'edit';
  service: Record<string, unknown> | null;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
  title: string;
  subtitle?: string;
}

/** UI-state material link: note is always a controlled string ('' = no note). */
interface MaterialLinkState {
  material_id: string;
  note: string;
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
              placeholder={field.placeholder}
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
  /** Composite-key errors (tariffs.<index>.<key>) from validate(). */
  itemErrors?: Record<string, string>;
}

function NestedList({ field, items, onChange, itemErrors }: NestedListProps) {
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
                error={itemErrors?.[`${index}.${itemField.key}`]}
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

/* ── Local materials multi-list (GH #223 spec §8) ───────────────── */

interface MaterialsFieldProps {
  field: Extract<ServiceFieldConfig, { type: 'materials' }>;
  value: MaterialLinkState[];
  onChange: (links: MaterialLinkState[]) => void;
}

/**
 * Checkbox multi-list of ACTIVE materials with a one-line note input under
 * each checked item. Options come from `useMaterialsRaw` (picker =
 * `/all?status=active`, domain-rules/materials.md). Selection order follows
 * the picker order (server: title ASC, id ASC) — the backend re-orders on
 * read anyway (spec §3.3), so no client-side sorting is needed.
 */
function MaterialsField({ field, value, onChange }: MaterialsFieldProps) {
  const baseId = useId();
  const { data: materials = [] } = useMaterialsRaw();

  const toggle = (materialId: string) => {
    if (value.some((l) => l.material_id === materialId)) {
      onChange(value.filter((l) => l.material_id !== materialId));
    } else {
      onChange([...value, { material_id: materialId, note: '' }]);
    }
  };

  const setNote = (materialId: string, note: string) => {
    onChange(value.map((l) => (l.material_id === materialId ? { ...l, note } : l)));
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium" style={{ color: 'var(--ink-light)' }}>
        {field.label}
      </label>
      {materials.length === 0 && (
        <div className="text-xs py-1" style={{ color: 'var(--ink-light)' }}>
          {field.emptyText}
        </div>
      )}
      <div className="flex flex-col gap-1">
        {materials.map((m) => {
          const link = value.find((l) => l.material_id === m.id);
          const checked = link !== undefined;
          const checkboxId = `${baseId}-mat-${m.id}`;
          const noteId = `${baseId}-mat-${m.id}-note`;
          return (
            <div
              key={m.id}
              className="rounded-lg border px-3 py-2"
              style={{ borderColor: 'var(--line)', backgroundColor: 'var(--surface)' }}
              data-testid={`material-option-${m.id}`}
            >
              <div className="flex items-center gap-2">
                <input
                  id={checkboxId}
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(m.id)}
                  className="w-4 h-4 rounded border-gray-300 accent-[var(--brand)] cursor-pointer shrink-0"
                  data-testid={`material-checkbox-${m.id}`}
                />
                <label
                  htmlFor={checkboxId}
                  className="text-sm cursor-pointer select-none"
                  style={{ color: 'var(--ink)' }}
                >
                  {m.title}
                </label>
              </div>
              {checked && (
                <div className="mt-2 pl-6">
                  <input
                    id={noteId}
                    type="text"
                    value={link.note}
                    onChange={(e) => setNote(m.id, e.target.value)}
                    placeholder={field.notePlaceholder}
                    className="w-full rounded-lg border px-3 py-1.5 text-sm transition-colors"
                    style={{
                      borderColor: 'var(--line)',
                      backgroundColor: 'var(--white)',
                      color: 'var(--ink)',
                    }}
                    aria-label={`Заметка: ${m.title}`}
                    data-testid={`material-note-${m.id}`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── ServiceModal ────────────────────────────────────────────────── */

/** Read shape of a linked material on ServiceResponse (spec §5). */
interface ServiceMaterialRead {
  id: string;
  title: string;
  description: string;
  note: string | null;
}

/** Map `service.materials` (read) → checkbox multi-list state (GH #223 T5). */
function toMaterialLinkState(materials: unknown): MaterialLinkState[] {
  if (!Array.isArray(materials)) return [];
  return (materials as ServiceMaterialRead[]).map((m) => ({
    material_id: m.id,
    note: m.note ?? '',
  }));
}

/**
 * Map checkbox state → wire links (ServiceMaterialLink[]): empty notes are
 * omitted (note is optional; the server normalizes whitespace-only → NULL,
 * so the UI keeps raw input and does NOT trim client-side).
 */
function toMaterialLinks(state: MaterialLinkState[]): ServiceMaterialLink[] {
  return state.map((l) =>
    l.note === '' ? { material_id: l.material_id } : { material_id: l.material_id, note: l.note },
  );
}

/**
 * Split composite error keys for a nested list: errors stored as
 * `<listKey>.<index>.<itemKey>` → `{ '<index>.<itemKey>': text }` for the
 * list's item renderers.
 */
function errorsFrom(
  listValue: unknown,
  errors: Record<string, string>,
  listKey: string,
): Record<string, string> {
  const items = Array.isArray(listValue) ? listValue : [];
  const result: Record<string, string> = {};
  Object.entries(errors).forEach(([key, text]) => {
    if (key.startsWith(`${listKey}.`)) {
      const rest = key.slice(listKey.length + 1);
      const index = Number(rest.split('.', 1)[0]);
      if (!isNaN(index) && index >= 0 && index < items.length) {
        result[rest] = text;
      }
    }
  });
  return result;
}

export function ServiceModal({
  mode,
  service,
  onSubmit,
  onClose,
  title,
  subtitle,
}: ServiceModalProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>(() => {
    // GH #203: max_age is the one optional number — null means «без
    // ограничения», so it inits EMPTY, not 0. The empty-init list is fixed
    // explicitly (NOT by the `required` flag: min_age has no flag but keeps
    // its 0-init «с N лет» semantics).
    const DEFAULT_EMPTY_NUMBER_KEYS = ['max_age'];
    const initial: Record<string, unknown> = {};
    SERVICE_FIELDS.forEach((f) => {
      if (f.type === 'materials') {
        // Edit prefill: checked + note restored from service.materials
        // (create: no service → empty picker).
        initial[f.key] = toMaterialLinkState(service?.[f.key]);
        return;
      }
      initial[f.key] =
        service?.[f.key] ??
        (f.type === 'number'
          ? DEFAULT_EMPTY_NUMBER_KEYS.includes(f.key)
            ? ''
            : 0
          : f.type === 'nested-list'
            ? []
            : '');
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

    /** «Заполнено»: 0 is a VALID value — no truthy checks (GH #203). */
    const isFilled = (value: unknown) => value !== '' && value != null;

    const validateField = (field: (typeof SERVICE_FIELDS)[number], value: unknown, key: string) => {
      if ('required' in field && field.required) {
        if (!isFilled(value)) {
          newErrors[key] = 'Обязательное поле';
        }
      }
      if (field.type === 'number') {
        if (isFilled(value)) {
          const val = Number(value);
          if (!isNaN(val)) {
            if (field.min !== undefined && val < field.min) {
              newErrors[key] = `Минимум: ${field.min}`;
            }
            if (field.max !== undefined && val > field.max) {
              newErrors[key] = `Максимум: ${field.max}`;
            }
          }
        }
      }
    };

    SERVICE_FIELDS.forEach((field) => {
      if (field.type === 'nested-list') {
        // GH #203 rev4 «вариант B»: tariff items are validated against their
        // own itemFields configs (required + min/max — same mechanics as
        // top-level fields). Errors use composite keys (tariffs.<i>.<key>).
        const items = (formData[field.key] as Record<string, unknown>[]) ?? [];
        items.forEach((item, index) => {
          field.itemFields.forEach((itemField) => {
            validateField(itemField, item[itemField.key], `${field.key}.${index}.${itemField.key}`);
          });
        });
        return;
      }
      validateField(field, formData[field.key], field.key);
    });
    // Cross-field: min_age <= max_age — only when BOTH are filled; an empty
    // «до» (null max_age) must not trip the rule (the reported false error).
    const minAge = formData['min_age'];
    const maxAge = formData['max_age'];
    if (isFilled(minAge) && isFilled(maxAge) && Number(minAge) > Number(maxAge)) {
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
      // GH #223 T5: checkbox state → wire links ({material_id, note?}).
      // GH #203: '' → null ONLY for max_age (the one optional number; the
      // MyDataModal pattern — NOT generic, otherwise a cleared required field
      // could travel as null).
      const payload: Record<string, unknown> = {
        ...formData,
        max_age: formData['max_age'] === '' ? null : formData['max_age'],
        materials: toMaterialLinks((formData['materials'] as MaterialLinkState[]) ?? []),
      };
      await onSubmit(payload);
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
          {SERVICE_FIELDS.map((field) => {
            if (field.type === 'nested-list') {
              return (
                <NestedList
                  key={field.key}
                  field={field}
                  items={(formData[field.key] as Record<string, unknown>[]) ?? []}
                  onChange={(items) => handleChange(field.key, items)}
                  itemErrors={errorsFrom(formData[field.key] as unknown, errors, field.key)}
                />
              );
            }
            if (field.type === 'materials') {
              return (
                <MaterialsField
                  key={field.key}
                  field={field}
                  value={(formData[field.key] as MaterialLinkState[]) ?? []}
                  onChange={(links) => handleChange(field.key, links)}
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
      </Modal>
    </div>
  );
}
