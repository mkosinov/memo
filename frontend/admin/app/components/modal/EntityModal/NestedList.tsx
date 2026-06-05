'use client';

import React from 'react';
import { FieldRenderer } from './FieldRenderer';
import type { NestedListFieldConfig } from './types';

interface NestedListProps {
  field: NestedListFieldConfig;
  items: Record<string, unknown>[];
  onChange: (items: Record<string, unknown>[]) => void;
}

export function NestedList({ field, items, onChange }: NestedListProps) {
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
