'use client';

import React, { useId } from 'react';
import { TagsSelect } from './TagsSelect';
import type { FieldConfig } from './types';

interface FieldRendererProps {
  field: FieldConfig;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  error?: string;
}

export function FieldRenderer({ field, value, onChange, error }: FieldRendererProps) {
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

    case 'select':
      return (
        <div className="flex flex-col gap-1">
          {labelEl}
          <select
            id={inputId}
            value={(value as string) ?? ''}
            onChange={(e) => onChange(field.key, e.target.value)}
            className={baseInputClasses}
            style={baseStyle}
            aria-describedby={ariaDescribedBy}
          >
            <option value="">Выберите...</option>
            {field.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {errorEl}
        </div>
      );

    case 'tags':
      return (
        <div className="flex flex-col gap-1">
          {labelEl}
          <TagsSelect
            selected={((value as { id: string; name: string }[]) ?? [])}
            fetchTags={field.fetchTags}
            onChange={(tags) => onChange(field.key, tags)}
          />
        </div>
      );

    default:
      return null;
  }
}
