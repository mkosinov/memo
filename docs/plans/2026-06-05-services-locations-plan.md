# Services & Locations Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin pages for managing services (`/services`) and locations (`/locations`) with CRUD operations via generic EntityModal, accessible from Menubar.

**Architecture:** Generic `EntityModal<T>` component with field configs. Two table pages (services, locations) following the `/records` pattern. API client extended with CRUD mutations. React Query hooks for cache invalidation.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS, React Query, Zod, Vitest, Playwright

---

## File Structure

```
frontend/admin/
├── app/
│   ├── (main)/
│   │   ├── services/
│   │   │   ├── page.tsx                    # ServicesPage
│   │   │   └── components/
│   │   │       ├── ServicesTable.tsx        # Table with sorting/filtering/pagination
│   │   │       ├── ServiceFilters.tsx       # Search + tags + status filter
│   │   │       └── ColumnPicker.tsx         # Generic column visibility dropdown
│   │   └── locations/
│   │       ├── page.tsx                    # LocationsPage
│   │       └── components/
│   │           ├── LocationsTable.tsx
│   │           └── LocationFilters.tsx
│   └── components/
│       ├── modal/
│       │   └── EntityModal/
│       │       ├── index.tsx               # Generic EntityModal<T>
│       │       ├── FieldRenderer.tsx        # Renders single field by config
│       │       ├── NestedList.tsx           # Renders nested-list (tariffs)
│       │       └── TagsSelect.tsx           # Tags multi-select
│       └── layout/
│           └── Menubar.tsx                 # MODIFIED: add settings nav items
├── hooks/
│   ├── useServicesMutations.ts             # create/update/delete service
│   └── useLocationsMutations.ts            # create/update/delete location
├── __tests__/
│   ├── EntityModal.test.tsx
│   ├── ServicesTable.test.tsx
│   ├── LocationsTable.test.tsx
│   └── helpers/
│       ├── mockData.ts                     # EXISTING: add service/location fixtures
│       └── mockContexts.ts                 # EXISTING: no changes needed
└── e2e/
    ├── services-crud.spec.ts
    ├── locations-crud.spec.ts
    └── entity-modal.spec.ts

packages/api-client/src/
├── endpoints.ts                            # MODIFIED: add CRUD functions
└── schemas.ts                              # MODIFIED: add create/update schemas
```

---

## Task 1: API Client — Schemas & Endpoints (trivial)

**Files:**
- `packages/api-client/src/schemas.ts` — ADD `ServiceCreateSchema`, `ServiceUpdateSchema`, `LocationCreateSchema`, `LocationUpdateSchema`, `TagResponseSchema`
- `packages/api-client/src/endpoints.ts` — ADD `createService`, `updateService`, `deleteService`, `createLocation`, `updateLocation`, `deleteLocation`, `getTags`
- `packages/api-client/src/index.ts` — re-export new functions/types

**Steps:**

1. Open `packages/api-client/src/schemas.ts`. After the existing `TagResponseSchema`, add:

```ts
// ─── Tag ───────────────────────────────────────────────────────────────────
export const TagResponseSchema = z.object({
  id: z.string(),
  tag: z.string(),
});
export type TagResponse = z.infer<typeof TagResponseSchema>;

// ─── Service Create/Update ─────────────────────────────────────────────────
export const TariffCreateSchema = z.object({
  title: z.string(),
  description: z.string().optional().default(''),
  price: z.number().min(0),
});
export type TariffCreate = z.infer<typeof TariffCreateSchema>;

export const ServiceCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional().default(''),
  image_url: z.string().optional().default(''),
  specialty: z.string().optional().default(''),
  min_age: z.number().min(0).max(18).default(0),
  max_age: z.number().min(0).max(18).default(18),
  duration: z.number().min(15).max(480),
  record_info: z.string().optional().default(''),
  material_hint: z.string().optional().default(''),
  tariffs: z.array(TariffCreateSchema).default([]),
  tag_ids: z.array(z.string()).default([]),
});
export type ServiceCreate = z.infer<typeof ServiceCreateSchema>;

export const ServiceUpdateSchema = ServiceCreateSchema.partial();
export type ServiceUpdate = z.infer<typeof ServiceUpdateSchema>;

export const LocationCreateSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().optional().default(''),
  description: z.string().optional().default(''),
  capacity: z.number().min(1).max(500),
  yandex_map_url: z.string().optional().default(''),
  review_url: z.string().optional().default(''),
  record_info: z.string().optional().default(''),
  image_url: z.string().optional().default(''),
  location_hint: z.string().optional().default(''),
  tag_ids: z.array(z.string()).default([]),
});
export type LocationCreate = z.infer<typeof LocationCreateSchema>;

export const LocationUpdateSchema = LocationCreateSchema.partial();
export type LocationUpdate = z.infer<typeof LocationUpdateSchema>;
```

2. Remove the old `TagResponseSchema` definition if it exists (replace with the one above).

3. Open `packages/api-client/src/endpoints.ts`. Add at the end:

```ts
// ─── Tags ──────────────────────────────────────────────────────────────────
export async function getTags(): Promise<TagResponse[]> {
  return api('/api/v1/tags', z.array(TagResponseSchema));
}

// ─── Services CRUD ─────────────────────────────────────────────────────────
export async function createService(data: ServiceCreate): Promise<ServiceResponse> {
  return api('/api/v1/services', ServiceResponseSchema, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateService(id: string, data: ServiceUpdate): Promise<ServiceResponse> {
  return api(`/api/v1/services/${id}`, ServiceResponseSchema, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteService(id: string): Promise<void> {
  await api(`/api/v1/services/${id}`, z.any(), { method: 'DELETE' });
}

// ─── Locations CRUD ────────────────────────────────────────────────────────
export async function createLocation(data: LocationCreate): Promise<LocationResponse> {
  return api('/api/v1/locations', LocationResponseSchema, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateLocation(id: string, data: LocationUpdate): Promise<LocationResponse> {
  return api(`/api/v1/locations/${id}`, LocationResponseSchema, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteLocation(id: string): Promise<void> {
  await api(`/api/v1/locations/${id}`, z.any(), { method: 'DELETE' });
}
```

4. Add imports to endpoints.ts: `ServiceCreate`, `ServiceUpdate`, `LocationCreate`, `LocationUpdate`, `TagResponse` from `./schemas`.

5. Open `packages/api-client/src/index.ts`. Add re-exports for all new types and functions.

6. Run `cd packages/api-client && npx tsc --noEmit` to verify types compile.

7. Commit: `git add packages/api-client/ && git commit -m "feat(api-client): add CRUD endpoints for services, locations, and tags"`

---

## Task 2: React Query Mutation Hooks (trivial)

**Files:**
- `frontend/admin/hooks/useServicesMutations.ts` — CREATE
- `frontend/admin/hooks/useLocationsMutations.ts` — CREATE

**Steps:**

1. Create `frontend/admin/hooks/useServicesMutations.ts`:

```ts
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createService, updateService, deleteService } from '@memo/api-client';
import type { ServiceCreate, ServiceUpdate } from '@memo/api-client';

export function useCreateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ServiceCreate) => createService(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['services'] }),
  });
}

export function useUpdateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ServiceUpdate }) => updateService(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['services'] }),
  });
}

export function useDeleteService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteService(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['services'] }),
  });
}
```

2. Create `frontend/admin/hooks/useLocationsMutations.ts` — same pattern with `createLocation`, `updateLocation`, `deleteLocation`, queryKey `['locations']`.

3. Run `cd frontend/admin && npx tsc --noEmit` to verify.

4. Commit: `git add frontend/admin/hooks/ && git commit -m "feat(admin): add React Query mutation hooks for services and locations"`

---

## Task 3: EntityModal — Generic Component (standard)

**Files:**
- `frontend/admin/app/components/modal/EntityModal/index.tsx` — CREATE
- `frontend/admin/app/components/modal/EntityModal/FieldRenderer.tsx` — CREATE
- `frontend/admin/app/components/modal/EntityModal/NestedList.tsx` — CREATE
- `frontend/admin/app/components/modal/EntityModal/TagsSelect.tsx` — CREATE
- `frontend/admin/__tests__/EntityModal.test.tsx` — CREATE

**Steps:**

1. Create `FieldRenderer.tsx` — renders a single field based on `FieldConfig`:

```tsx
'use client';
import React from 'react';
import { TagsSelect } from './TagsSelect';

interface FieldRendererProps {
  field: FieldConfig;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  error?: string;
}

export function FieldRenderer({ field, value, onChange, error }: FieldRendererProps) {
  const baseInputClasses = 'w-full rounded-lg border px-3 py-2 text-sm transition-colors';
  const baseStyle = {
    borderColor: error ? 'var(--danger)' : 'var(--line)',
    backgroundColor: 'var(--white)',
    color: 'var(--ink)',
  };

  switch (field.type) {
    case 'text':
      return (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: 'var(--ink-light)' }}>
            {field.label}{field.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
          <input
            type="text"
            value={(value as string) ?? ''}
            onChange={(e) => onChange(field.key, e.target.value)}
            placeholder={field.placeholder}
            disabled={field.disabled}
            className={baseInputClasses}
            style={baseStyle}
          />
          {error && <span className="text-xs" style={{ color: 'var(--danger)' }}>{error}</span>}
        </div>
      );

    case 'number':
      return (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: 'var(--ink-light)' }}>
            {field.label}{field.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={(value as number) ?? ''}
              onChange={(e) => onChange(field.key, e.target.value === '' ? '' : Number(e.target.value))}
              min={field.min}
              max={field.max}
              className={baseInputClasses}
              style={{ ...baseStyle, width: '120px' }}
            />
            {field.suffix && <span className="text-xs" style={{ color: 'var(--ink-light)' }}>{field.suffix}</span>}
          </div>
          {error && <span className="text-xs" style={{ color: 'var(--danger)' }}>{error}</span>}
        </div>
      );

    case 'textarea':
      return (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: 'var(--ink-light)' }}>
            {field.label}{field.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
          <textarea
            value={(value as string) ?? ''}
            onChange={(e) => onChange(field.key, e.target.value)}
            placeholder={field.placeholder}
            rows={field.rows ?? 3}
            className={baseInputClasses}
            style={{ ...baseStyle, resize: 'vertical' }}
          />
          {error && <span className="text-xs" style={{ color: 'var(--danger)' }}>{error}</span>}
        </div>
      );

    case 'select':
      return (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: 'var(--ink-light)' }}>
            {field.label}{field.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
          <select
            value={(value as string) ?? ''}
            onChange={(e) => onChange(field.key, e.target.value)}
            className={baseInputClasses}
            style={baseStyle}
          >
            <option value="">Выберите...</option>
            {field.options.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {error && <span className="text-xs" style={{ color: 'var(--danger)' }}>{error}</span>}
        </div>
      );

    case 'tags':
      return (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: 'var(--ink-light)' }}>{field.label}</label>
          <TagsSelect
            selected={((value as string[]) ?? []).map((id) => ({ id, name: id }))}
            fetchTags={field.fetchTags}
            onChange={(tags) => onChange(field.key, tags.map((t) => t.id))}
          />
        </div>
      );

    default:
      return null;
  }
}
```

2. Create `TagsSelect.tsx` — multi-select with tag chips:

```tsx
'use client';
import React, { useState, useEffect } from 'react';

interface Tag { id: string; name: string }

interface TagsSelectProps {
  selected: Tag[];
  fetchTags: () => Promise<Tag[]>;
  onChange: (tags: Tag[]) => void;
}

export function TagsSelect({ selected, fetchTags, onChange }: TagsSelectProps) {
  const [available, setAvailable] = useState<Tag[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetchTags().then(setAvailable).catch(() => {});
  }, [fetchTags]);

  const toggle = (tag: Tag) => {
    const isSelected = selected.some((t) => t.id === tag.id);
    onChange(isSelected ? selected.filter((t) => t.id !== tag.id) : [...selected, tag]);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-1">
        {selected.map((tag) => (
          <span key={tag.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-brand/10 text-brand">
            {tag.name}
            <button onClick={() => toggle(tag)} className="hover:text-red-500" aria-label={`Удалить тег ${tag.name}`}>×</button>
          </span>
        ))}
        <button onClick={() => setOpen(!open)} className="text-xs px-2 py-0.5 rounded-full border border-dashed" style={{ borderColor: 'var(--line)', color: 'var(--ink-light)' }}>
          + Тег
        </button>
      </div>
      {open && (
        <div className="flex flex-wrap gap-1 p-2 rounded-lg border" style={{ borderColor: 'var(--line)', backgroundColor: 'var(--surface)' }}>
          {available.filter((t) => !selected.some((s) => s.id === t.id)).map((tag) => (
            <button key={tag.id} onClick={() => toggle(tag)} className="text-xs px-2 py-0.5 rounded-full border hover:bg-brand/10" style={{ borderColor: 'var(--line)' }}>
              {tag.name}
            </button>
          ))}
          {available.length === 0 && <span className="text-xs" style={{ color: 'var(--ink-light)' }}>Нет тегов</span>}
        </div>
      )}
    </div>
  );
}
```

3. Create `NestedList.tsx` — for tariffs:

```tsx
'use client';
import React from 'react';
import { FieldRenderer } from './FieldRenderer';
import type { FieldConfig } from '../EntityModal';

interface NestedListProps {
  label: string;
  items: Record<string, unknown>[];
  itemFields: FieldConfig[];
  itemLabel: string;
  addButtonText: string;
  emptyText: string;
  onChange: (items: Record<string, unknown>[]) => void;
  errors?: Record<number, Record<string, string>>;
}

export function NestedList({ label, items, itemFields, itemLabel, addButtonText, emptyText, onChange, errors }: NestedListProps) {
  const addItem = () => {
    const newItem: Record<string, unknown> = {};
    itemFields.forEach((f) => { newItem[f.key] = f.type === 'number' ? 0 : ''; });
    onChange([...items, newItem]);
  };

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, key: string, value: unknown) => {
    const updated = items.map((item, i) => i === index ? { ...item, [key]: value } : item);
    onChange(updated);
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>{label}</label>
      {items.length === 0 && (
        <div className="text-xs py-2" style={{ color: 'var(--ink-light)' }}>{emptyText}</div>
      )}
      {items.map((item, index) => (
        <div key={index} className="rounded-lg border p-3 relative" style={{ borderColor: 'var(--line)', backgroundColor: 'var(--surface)' }}>
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-medium" style={{ color: 'var(--ink-mid)' }}>{itemLabel} {index + 1}</span>
            <button onClick={() => removeItem(index)} className="text-xs hover:text-red-500" style={{ color: 'var(--ink-light)' }} aria-label={`Удалить ${itemLabel}`}>
              🗑
            </button>
          </div>
          <div className="space-y-2">
            {itemFields.map((field) => (
              <FieldRenderer
                key={field.key}
                field={field}
                value={item[field.key]}
                onChange={(key, val) => updateItem(index, key, val)}
                error={errors?.[index]?.[field.key]}
              />
            ))}
          </div>
        </div>
      ))}
      <button onClick={addItem} className="text-xs font-medium self-start px-3 py-1 rounded-lg border border-dashed transition-colors hover:bg-brand/5" style={{ borderColor: 'var(--brand)', color: 'var(--brand)' }}>
        {addButtonText}
      </button>
    </div>
  );
}
```

4. Create `EntityModal/index.tsx` — the main modal component:

```tsx
'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { FieldRenderer } from './FieldRenderer';
import { NestedList } from './NestedList';
import type { FieldConfig } from './types';

export type { FieldConfig };

export interface EntityModalProps<T> {
  mode: 'create' | 'edit';
  entity: T | null;
  fields: FieldConfig[];
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
  title: string;
  subtitle?: string;
  width?: 'default' | 'wide';
}

export function EntityModal<T>({ mode, entity, fields, onSubmit, onClose, title, subtitle, width = 'default' }: EntityModalProps<T>) {
  const [formData, setFormData] = useState<Record<string, unknown>>(() => {
    if (!entity) return {};
    const initial: Record<string, unknown> = {};
    fields.forEach((f) => { initial[f.key] = (entity as Record<string, unknown>)[f.key] ?? (f.type === 'number' ? 0 : ''); });
    return initial;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [nestedErrors, setNestedErrors] = useState<Record<number, Record<string, string>>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const maxW = width === 'wide' ? 'max-w-[800px]' : 'max-w-[600px]';

  const handleChange = useCallback((key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
    setErrors((prev) => { const next = { ...prev }; delete next[key]; return next; });
  }, []);

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};
    fields.forEach((field) => {
      if ('required' in field && field.required) {
        const val = formData[field.key];
        if (val === undefined || val === null || val === '' || (field.type === 'number' && val === 0 && field.min === undefined)) {
          newErrors[field.key] = 'Обязательное поле';
        }
      }
      if (field.type === 'number') {
        const val = formData[field.key] as number;
        if (field.min !== undefined && val < field.min) newErrors[field.key] = `Минимум: ${field.min}`;
        if (field.max !== undefined && val > field.max) newErrors[field.key] = `Максимум: ${field.max}`;
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
    } catch (err) {
      // Toast handled by caller
    } finally {
      setIsSubmitting(false);
    }
  };

  // Dirty check on close
  const handleClose = useCallback(() => {
    if (isDirty) {
      if (!window.confirm('Есть несохранённые изменения. Закрыть?')) return;
    }
    onClose();
  }, [isDirty, onClose]);

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleClose]);

  // beforeunload
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (isDirty) e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={handleClose} />
      <div className={`relative bg-white rounded-xl shadow-2xl w-full ${maxW} mx-4 flex flex-col overflow-hidden`} style={{ maxHeight: '85vh' }}>
        {/* Header */}
        <div className="flex justify-between items-start px-6 pt-6 pb-4">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>{title}</h2>
            {subtitle && <p className="text-sm mt-0.5" style={{ color: 'var(--ink-light)' }}>{subtitle}</p>}
          </div>
          <button onClick={handleClose} className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:opacity-80" style={{ backgroundColor: 'var(--surface)', color: 'var(--ink-light)' }} aria-label="Закрыть">
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
                  label={field.label}
                  items={(formData[field.key] as Record<string, unknown>[]) ?? []}
                  itemFields={field.itemFields}
                  itemLabel={field.itemLabel}
                  addButtonText={field.addButtonText}
                  emptyText={field.emptyText}
                  onChange={(items) => handleChange(field.key, items)}
                  errors={nestedErrors}
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
        <div className="flex justify-end gap-2 px-6 py-4 border-t" style={{ borderColor: 'var(--line)' }}>
          <button onClick={handleClose} className="px-4 py-2 text-sm rounded-lg border transition-colors" style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}>
            Отмена
          </button>
          <button onClick={handleSubmit} disabled={isSubmitting} className="px-4 py-2 text-sm rounded-lg text-white transition-colors disabled:opacity-50" style={{ backgroundColor: 'var(--brand)' }}>
            {isSubmitting ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

5. Create `EntityModal/types.ts`:

```ts
export interface TextFieldConfig {
  type: 'text';
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}

export interface NumberFieldConfig {
  type: 'number';
  key: string;
  label: string;
  min?: number;
  max?: number;
  required?: boolean;
  suffix?: string;
}

export interface TextareaFieldConfig {
  type: 'textarea';
  key: string;
  label: string;
  rows?: number;
  placeholder?: string;
}

export interface SelectFieldConfig {
  type: 'select';
  key: string;
  label: string;
  options: { value: string; label: string }[];
  required?: boolean;
}

export interface TagsFieldConfig {
  type: 'tags';
  key: string;
  label: string;
  fetchTags: () => Promise<{ id: string; name: string }[]>;
}

export interface NestedListFieldConfig {
  type: 'nested-list';
  key: string;
  label: string;
  itemLabel: string;
  itemFields: (TextFieldConfig | NumberFieldConfig | TextareaFieldConfig)[];
  addButtonText: string;
  emptyText: string;
}

export type FieldConfig = TextFieldConfig | NumberFieldConfig | TextareaFieldConfig | SelectFieldConfig | TagsFieldConfig | NestedListFieldConfig;
```

6. Write unit tests in `__tests__/EntityModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EntityModal } from '@/app/components/modal/EntityModal';
import type { FieldConfig } from '@/app/components/modal/EntityModal/types';

const textField: FieldConfig = { type: 'text', key: 'name', label: 'Название', required: true };
const numberField: FieldConfig = { type: 'number', key: 'capacity', label: 'Вместимость', min: 1, max: 100, required: true };
const textareaField: FieldConfig = { type: 'textarea', key: 'description', label: 'Описание', rows: 3 };

describe('EntityModal', () => {
  it('renders all field types', () => {
    render(<EntityModal mode="create" entity={null} fields={[textField, numberField, textareaField]} onSubmit={vi.fn()} onClose={vi.fn()} title="Тест" />);
    expect(screen.getByLabelText(/Название/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Вместимость/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Описание/)).toBeInTheDocument();
  });

  it('pre-fills form in edit mode', () => {
    render(<EntityModal mode="edit" entity={{ name: 'Студия', capacity: 20, description: 'Описание' }} fields={[textField, numberField, textareaField]} onSubmit={vi.fn()} onClose={vi.fn()} title="Тест" />);
    expect(screen.getByLabelText(/Название/)).toHaveValue('Студия');
    expect(screen.getByLabelText(/Вместимость/)).toHaveValue(20);
  });

  it('validates required fields on submit', async () => {
    const onSubmit = vi.fn();
    render(<EntityModal mode="create" entity={null} fields={[textField]} onSubmit={onSubmit} onClose={vi.fn()} title="Тест" />);
    fireEvent.click(screen.getByText('Сохранить'));
    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());
    expect(screen.getByText('Обязательное поле')).toBeInTheDocument();
  });

  it('calls onSubmit with correct data', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<EntityModal mode="create" entity={null} fields={[textField]} onSubmit={onSubmit} onClose={vi.fn()} title="Тест" />);
    fireEvent.change(screen.getByLabelText(/Название/), { target: { value: 'Новая услуга' } });
    fireEvent.click(screen.getByText('Сохранить'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ name: 'Новая услуга' }));
  });

  it('calls onClose on overlay click', () => {
    const onClose = vi.fn();
    render(<EntityModal mode="create" entity={null} fields={[]} onSubmit={vi.fn()} onClose={onClose} title="Тест" />);
    fireEvent.click(screen.getByRole('dialog'));
    // Note: overlay click handler is on the backdrop div
  });

  it('shows dirty check on close', () => {
    const onClose = vi.fn();
    window.confirm = vi.fn(() => false);
    render(<EntityModal mode="create" entity={null} fields={[textField]} onSubmit={vi.fn()} onClose={onClose} title="Тест" />);
    fireEvent.change(screen.getByLabelText(/Название/), { target: { value: 'test' } });
    fireEvent.click(screen.getByText('Отмена'));
    expect(window.confirm).toHaveBeenCalledWith('Есть несохранённые изменения. Закрыть?');
  });
});
```

7. Run `cd frontend/admin && npm run test -- --run EntityModal` to verify tests pass.

8. Commit: `git add frontend/admin/app/components/modal/EntityModal/ frontend/admin/__tests__/EntityModal.test.tsx && git commit -m "feat(admin): add generic EntityModal with field configs, nested list, tags"`

---

## Task 4: Services Page — Table & Filters (standard)

**Files:**
- `frontend/admin/app/(main)/services/page.tsx` — CREATE
- `frontend/admin/app/(main)/services/components/ServicesTable.tsx` — CREATE
- `frontend/admin/app/(main)/services/components/ServiceFilters.tsx` — CREATE
- `frontend/admin/app/(main)/services/components/ColumnPicker.tsx` — CREATE
- `frontend/admin/__tests__/ServicesTable.test.tsx` — CREATE

**Steps:**

1. Create `ColumnPicker.tsx` — reusable column visibility dropdown:

```tsx
'use client';
import React, { useState, useRef, useEffect } from 'react';

interface Column {
  key: string;
  label: string;
}

interface ColumnPickerProps {
  columns: Column[];
  visibleKeys: string[];
  onChange: (keys: string[]) => void;
  storageKey: string;
}

export function ColumnPicker({ columns, visibleKeys, onChange, storageKey }: ColumnPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (key: string) => {
    const next = visibleKeys.includes(key) ? visibleKeys.filter((k) => k !== key) : [...visibleKeys, key];
    onChange(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors" style={{ color: 'var(--ink-light)' }} aria-label="Настроить колонки">
        ⚙️
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-10 rounded-lg border shadow-lg p-2 min-w-[180px]" style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}>
          {columns.map((col) => (
            <label key={col.key} className="flex items-center gap-2 px-2 py-1 text-sm cursor-pointer hover:bg-surface rounded">
              <input type="checkbox" checked={visibleKeys.includes(col.key)} onChange={() => toggle(col.key)} className="rounded" />
              <span style={{ color: 'var(--ink)' }}>{col.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
```

2. Create `ServiceFilters.tsx`:

```tsx
'use client';
import React from 'react';

interface ServiceFiltersProps {
  search: string;
  status: string;
  onSearchChange: (v: string) => void;
  onStatusChange: (v: string) => void;
  onReset: () => void;
}

export function ServiceFilters({ search, status, onSearchChange, onStatusChange, onReset }: ServiceFiltersProps) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={{ color: 'var(--ink-light)' }}>Поиск</label>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Название..."
          className="rounded-lg border px-2 py-1.5 text-xs"
          style={{ borderColor: 'var(--line)', color: 'var(--ink-mid)', backgroundColor: 'var(--white)' }}
          aria-label="Поиск по названию"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={{ color: 'var(--ink-light)' }}>Статус</label>
        <select
          value={status}
          onChange={(e) => onStatusChange(e.target.value)}
          className="rounded-lg border px-2 py-1.5 text-xs"
          style={{ borderColor: 'var(--line)', color: 'var(--ink-mid)', backgroundColor: 'var(--white)' }}
          aria-label="Фильтр по статусу"
        >
          <option value="active">Активные</option>
          <option value="">Все</option>
          <option value="archived">Архив</option>
        </select>
      </div>
      <button onClick={onReset} className="px-3 py-1.5 text-xs font-medium transition-colors rounded-lg" style={{ color: 'var(--brand)', border: '1px solid var(--brand)' }}>
        Сбросить
      </button>
    </div>
  );
}
```

3. Create `ServicesTable.tsx` — full table with sorting, filtering, pagination, column picker:

```tsx
'use client';
import React, { useMemo, useState } from 'react';
import { useServices } from '@/hooks/useServices';
import { useDeleteService } from '@/hooks/useServicesMutations';
import { useUI } from '@/contexts/UIContext';
import { ServiceFilters } from './ServiceFilters';
import { ColumnPicker } from './ColumnPicker';
import { EntityModal } from '@/app/components/modal/EntityModal';
import { SERVICE_FIELDS } from './serviceFields';
import type { ServiceResponse } from '@memo/api-client';

// ... sorting, pagination, formatDuration, formatAge helpers (follow RecordsTable pattern)

const ALL_COLUMNS = [
  { key: 'title', label: 'Название' },
  { key: 'duration', label: 'Длительность' },
  { key: 'age', label: 'Возраст' },
  { key: 'material_hint', label: 'Материал' },
  { key: 'tariffs', label: 'Тарифы' },
  { key: 'specialty', label: 'Специализация' },
  { key: 'tags', label: 'Теги' },
  { key: 'is_active', label: 'Статус' },
  { key: 'created_at', label: 'Дата создания' },
];

const DEFAULT_VISIBLE = ['title', 'duration', 'age', 'material_hint', 'tariffs'];

export function ServicesTable() {
  const { data: services = [], isLoading } = useServices();
  const deleteService = useDeleteService();
  const { showToast } = useUI();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('services-column-visibility') || 'null') ?? DEFAULT_VISIBLE; } catch { return DEFAULT_VISIBLE; }
  });
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [editService, setEditService] = useState<ServiceResponse | null>(null);

  // Filter + sort + paginate (follow RecordsTable pattern)
  const filteredServices = useMemo(() => { /* filter by search + status */ }, [services, search, status]);
  const sortedServices = useMemo(() => { /* sort by sortField */ }, [filteredServices, sortField, sortDir]);
  const paginatedServices = useMemo(() => { /* slice for pagination */ }, [sortedServices, page, pageSize]);

  const handleArchive = async (service: ServiceResponse) => {
    try {
      await deleteService.mutateAsync(service.id);
      showToast(service.is_active ? 'Услуга перемещена в архив' : 'Услуга восстановлена', 'success');
    } catch { showToast('Ошибка', 'error'); }
  };

  return (
    <div>
      {/* Filters row */}
      <div className="flex items-center justify-between mb-4">
        <ServiceFilters search={search} status={status} onSearchChange={setSearch} onStatusChange={setStatus} onReset={() => { setSearch(''); setStatus('active'); }} />
        <ColumnPicker columns={ALL_COLUMNS} visibleKeys={visibleColumns} onChange={setVisibleColumns} storageKey="services-column-visibility" />
      </div>
      {/* Table */}
      {/* ... follow RecordsTable pattern with sortable headers, paginated rows */}
      {/* Each row: click → setEditService, "⋯" button → archive/restore */}
      {/* Edit modal */}
      {editService && <EntityModal mode="edit" entity={editService} fields={SERVICE_FIELDS} onSubmit={...} onClose={() => setEditService(null)} title="Редактирование услуги" width="wide" />}
    </div>
  );
}
```

4. Create `serviceFields.tsx` — field config for services (from spec Section 5):

```tsx
import type { FieldConfig } from '@/app/components/modal/EntityModal/types';

export const SERVICE_FIELDS: FieldConfig[] = [
  { type: 'text', key: 'title', label: 'Название', required: true, placeholder: 'Мастер-класс по рисованию' },
  { type: 'textarea', key: 'description', label: 'Описание', rows: 3, placeholder: 'Описание услуги...' },
  { type: 'text', key: 'specialty', label: 'Специализация', placeholder: 'Живопись, Графика...' },
  { type: 'number', key: 'duration', label: 'Длительность', required: true, min: 15, max: 480, suffix: 'мин' },
  { type: 'number', key: 'min_age', label: 'Возраст от', min: 0, max: 18, suffix: 'лет' },
  { type: 'number', key: 'max_age', label: 'Возраст до', min: 0, max: 18, suffix: 'лет' },
  { type: 'text', key: 'material_hint', label: 'Материал', placeholder: 'Что להביא с собой' },
  { type: 'text', key: 'record_info', label: 'Информация для записи', placeholder: 'Инструкция для клиента' },
  { type: 'text', key: 'image_url', label: 'Картинка URL', placeholder: 'https://...' },
  { type: 'nested-list', key: 'tariffs', label: 'Тарифы', itemLabel: 'Тариф', addButtonText: '+ Добавить тариф', emptyText: 'Нет тарифов',
    itemFields: [
      { type: 'text', key: 'title', label: 'Название', required: true, placeholder: 'Взрослый' },
      { type: 'number', key: 'price', label: 'Цена', required: true, min: 0, suffix: '₽' },
      { type: 'text', key: 'description', label: 'Описание', placeholder: 'Описание тарифа' },
    ]
  },
];
```

5. Create `page.tsx`:

```tsx
'use client';
import React, { useState } from 'react';
import { ServicesTable } from './components/ServicesTable';
import { EntityModal } from '@/app/components/modal/EntityModal';
import { SERVICE_FIELDS } from './components/serviceFields';
import { useCreateService } from '@/hooks/useServicesMutations';
import { useUI } from '@/contexts/UIContext';

export default function ServicesPage() {
  const [showCreate, setShowCreate] = useState(false);
  const createService = useCreateService();
  const { showToast } = useUI();

  const handleCreate = async (data: Record<string, unknown>) => {
    await createService.mutateAsync(data as any);
    showToast('Услуга создана', 'success');
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>Управление услугами</h1>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2 text-sm rounded-lg text-white transition-colors" style={{ backgroundColor: 'var(--brand)' }}>
          + Добавить услугу
        </button>
      </div>
      <div className="rounded-xl border p-4" style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}>
        <ServicesTable />
      </div>
      {showCreate && <EntityModal mode="create" entity={null} fields={SERVICE_FIELDS} onSubmit={handleCreate} onClose={() => setShowCreate(false)} title="Новая услуга" subtitle="Заполните данные услуги" width="wide" />}
    </div>
  );
}
```

6. Write tests in `__tests__/ServicesTable.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ServicesTable } from '@/app/(main)/services/components/ServicesTable';

// Mock hooks
vi.mock('@/hooks/useServices', () => ({ useServices: vi.fn() }));
vi.mock('@/hooks/useServicesMutations', () => ({ useDeleteService: vi.fn() }));
vi.mock('@/contexts/UIContext', () => ({ useUI: vi.fn() }));

// Tests: renders rows, sorts, filters, pagination, archive button
```

7. Run tests, commit: `git add frontend/admin/app/\(main\)/services/ frontend/admin/__tests__/ServicesTable.test.tsx && git commit -m "feat(admin): add services page with table, filters, column picker, and CRUD"`

---

## Task 5: Locations Page — Table & Filters (small)

**Files:**
- `frontend/admin/app/(main)/locations/page.tsx` — CREATE
- `frontend/admin/app/(main)/locations/components/LocationsTable.tsx` — CREATE
- `frontend/admin/app/(main)/locations/components/LocationFilters.tsx` — CREATE
- `frontend/admin/app/(main)/locations/components/locationFields.tsx` — CREATE
- `frontend/admin/__tests__/LocationsTable.test.tsx` — CREATE

**Steps:** Same pattern as Task 4, adapted for locations (fewer fields, no nested-list).

1. Create `locationFields.tsx`:

```tsx
import type { FieldConfig } from '@/app/components/modal/EntityModal/types';

export const LOCATION_FIELDS: FieldConfig[] = [
  { type: 'text', key: 'name', label: 'Название', required: true, placeholder: 'Студия на Тверской' },
  { type: 'text', key: 'address', label: 'Адрес', placeholder: 'ул. Тверская, д. 1' },
  { type: 'textarea', key: 'description', label: 'Описание', rows: 3, placeholder: 'Описание локации...' },
  { type: 'number', key: 'capacity', label: 'Вместимость', required: true, min: 1, max: 500, suffix: 'чел.' },
  { type: 'text', key: 'location_hint', label: 'Подсказка', placeholder: 'Как найти, проход и т.д.' },
  { type: 'text', key: 'record_info', label: 'Информация для записи', placeholder: 'Инструкция для клиента' },
  { type: 'text', key: 'yandex_map_url', label: 'Яндекс.Карты', placeholder: 'https://yandex.ru/maps/...' },
  { type: 'text', key: 'review_url', label: 'Ссылка на отзыв', placeholder: 'https://...' },
  { type: 'text', key: 'image_url', label: 'Картинка URL', placeholder: 'https://...' },
];
```

2. Create `LocationsTable.tsx` — follows ServicesTable pattern with columns: name, capacity, address, location_hint.

3. Create `LocationFilters.tsx` — search by name/address + status filter.

4. Create `page.tsx` — same structure as services page.

5. Write tests, run, commit: `git commit -m "feat(admin): add locations page with table, filters, and CRUD"`

---

## Task 6: Menubar Update (trivial)

**Files:**
- `frontend/admin/app/components/layout/Menubar.tsx` — MODIFY
- `frontend/admin/__tests__/Menubar.test.tsx` — MODIFY

**Steps:**

1. Open `Menubar.tsx`. Add SVG icon components after existing icons:

```tsx
function PackageIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

function MapPinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
```

2. Add to `ICON_MAP`: `package: PackageIcon, mapPin: MapPinIcon`.

3. After `ArtistLegend` component, add settings items:

```tsx
const SETTINGS_ITEMS = [
  { label: 'Услуги', icon: 'package', href: '/services' },
  { label: 'Локации', icon: 'mapPin', href: '/locations' },
] as const;
```

4. In the Menubar render, after `ArtistLegend` and a separator, render settings items using the same `Link` pattern as nav items.

5. Update `Menubar.test.tsx` to verify new items render.

6. Run tests, commit: `git commit -m "feat(admin): add services and locations links to Menubar"`

---

## Task 7: E2E Tests (standard)

**Files:**
- `frontend/admin/e2e/services-crud.spec.ts` — CREATE
- `frontend/admin/e2e/locations-crud.spec.ts` — CREATE
- `frontend/admin/e2e/entity-modal.spec.ts` — CREATE

**Steps:**

1. Create `services-crud.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('Services CRUD', () => {
  test('navigate to services page', async ({ page }) => {
    await page.goto('/services');
    await expect(page.getByText('Управление услугами')).toBeVisible();
    await expect(page.getByText('+ Добавить услугу')).toBeVisible();
  });

  test('create a new service', async ({ page }) => {
    await page.goto('/services');
    await page.click('text=+ Добавить услугу');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.fill('input[placeholder*="Мастер-класс"]', 'Тестовый мастер-класс');
    await page.fill('input[type="number"][min="15"]', '90');
    await page.click('text=Сохранить');
    await expect(page.getByText('Услуга создана')).toBeVisible();
  });

  test('edit a service', async ({ page }) => {
    await page.goto('/services');
    await page.locator('tr[data-testid]').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    // Modify and save
  });

  test('archive a service', async ({ page }) => {
    await page.goto('/services');
    // Click "⋯" button → "В архив"
    // Verify row greyed
  });

  test('column picker toggles columns', async ({ page }) => {
    await page.goto('/services');
    await page.click('[aria-label="Настроить колонки"]');
    // Toggle a column, verify it appears/disappears
  });
});
```

2. Create `locations-crud.spec.ts` — same pattern for locations.

3. Create `entity-modal.spec.ts`:

```ts
test.describe('EntityModal', () => {
  test('validates required fields', async ({ page }) => {
    await page.goto('/services');
    await page.click('text=+ Добавить услугу');
    await page.click('text=Сохранить');
    await expect(page.getByText('Обязательное поле')).toBeVisible();
  });

  test('dirty check on close', async ({ page }) => {
    await page.goto('/services');
    await page.click('text=+ Добавить услугу');
    await page.fill('input[placeholder*="Мастер-класс"]', 'Тест');
    page.on('dialog', (dialog) => dialog.dismiss());
    await page.click('text=Отмена');
    // Verify dialog appeared
  });

  test('nested list add/remove tariffs', async ({ page }) => {
    await page.goto('/services');
    await page.click('text=+ Добавить услугу');
    await page.click('text=+ Добавить тариф');
    await expect(page.getByText('Тариф 1')).toBeVisible();
    // Fill tariff fields, remove, verify
  });
});
```

4. Run `cd frontend/admin && npx playwright test` to verify E2E tests pass.

5. Commit: `git commit -m "test(admin): add E2E tests for services, locations, and EntityModal"`

---

## Task 8: Final Verification (auto)

**Steps:**

1. Run full test suite: `cd frontend/admin && npm run test:all` (vitest + playwright)
2. Run type check: `cd frontend/admin && npx tsc --noEmit`
3. Run lint: `cd frontend/admin && npx next lint`
4. Verify build: `cd frontend/admin && npm run build`
5. All pass → mark tasks complete in TodoWrite
6. Update scratchpad

---

## Dependencies & Sequencing

| Task | Depends on | Can parallel with |
|------|-----------|-------------------|
| 1. API Client | — | — |
| 2. Mutation Hooks | Task 1 | — |
| 3. EntityModal | — | Tasks 1-2 |
| 4. Services Page | Tasks 1, 2, 3 | Task 5 |
| 5. Locations Page | Tasks 1, 2, 3 | Task 4 |
| 6. Menubar | — | Tasks 1-5 |
| 7. E2E Tests | Tasks 4, 5, 6 | — |
| 8. Final Verification | All | — |
