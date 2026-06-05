# Design: Services & Locations Management

> Date: 2026-06-05
> Status: Draft
> Author: @architect

## Overview

Add admin pages for managing **services** (`/services`) and **locations** (`/locations`) with CRUD operations via generic EntityModal. Both pages follow the same pattern as `/records` — table with sorting/filtering + modal for create/edit.

**Motivation:** Backend already has full CRUD endpoints for services and locations. Frontend currently has zero management UI — services and locations are only consumed as read-only reference data in the schedule, stamp, and activity modal.

## Visual Compliance Checks

- [ ] "Услуги" link is visible in Menubar after artist legend
- [ ] "Локации" link is visible in Menubar after "Услуги"
- [ ] Clicking "Услуги" navigates to `/services` page
- [ ] Clicking "Локации" navigates to `/locations` page
- [ ] Services table renders with columns: Название, Длительность, Возраст, Материал, Тарифы
- [ ] Locations table renders with columns: Название, Вместимость, Адрес, Подсказка
- [ ] "Добавить услугу" button is visible above services table
- [ ] "Добавить локацию" button is visible above locations table
- [ ] Clicking a service row opens EntityModal in edit mode
- [ ] Clicking a location row opens EntityModal in edit mode
- [ ] EntityModal for service shows all fields: title, description, specialty, duration, min_age, max_age, image_url, record_info, material_hint, tariffs, tags
- [ ] EntityModal for location shows all fields: name, address, description, capacity, yandex_map_url, review_url, record_info, image_url, location_hint, tags
- [ ] Column picker dropdown is accessible via ⚙️ icon above table
- [ ] Soft-deleted items appear greyed out in table with "Архив" status
- [ ] Toast notification appears after successful create/update/delete

---

## 1. Navigation — Menubar Update

### Current state

`NAV_ITEMS` array in `Menubar.tsx` defines the navigation. Below it is `ArtistLegend`.

### Change

Add `SETTINGS_ITEMS` array after `ArtistLegend`. Reuse existing `isActive()` logic and `Link` pattern.

**Final menu order:**
```
Расписание
Записи
Клиенты
Чат
Мастера
─────────
[ArtistLegend — colored dots]
─────────
Услуги        ← NEW
Локации       ← NEW
```

**Implementation details:**
- Add `PackageIcon` SVG (for Услуги) and `MapPinIcon` SVG (for Локации) following existing SVG pattern
- Add `SETTINGS_ITEMS = [{ label: 'Услуги', icon: 'package', href: '/services' }, { label: 'Локации', icon: 'mapPin', href: '/locations' }]`
- Render settings items after `ArtistLegend` with same styling as nav items
- Add separator `<div className="border-t border-white/10 mx-3" />` between ArtistLegend and settings items

---

## 2. Services Page (`/services`)

### Route

`frontend/admin/app/(main)/services/page.tsx`

### Page structure

Follows `/records` pattern:
```
┌─────────────────────────────────────────┐
│ Управление услугами          [+ Добавить]│
├─────────────────────────────────────────┤
│ [🔍 Поиск] [Теги ▼] [⚙️ Колонки]       │
├─────────────────────────────────────────┤
│ Название | Длит. | Возраст | Материал | Тарифы│
│ ─────────────────────────────────────── │
│ строка 1                               │
│ строка 2 (серая, если is_active=false) │
│ ...                                    │
├─────────────────────────────────────────┤
│ Строк: 10 ▼ | 25 всего     ← 1 2 3 →  │
└─────────────────────────────────────────┘
```

### Table columns (default visible)

| Column | Field | Width | Sortable |
|--------|-------|-------|----------|
| Название | `title` | flex-1 | ✅ |
| Длительность | `duration` (min → "60 мин") | 100px | ✅ |
| Возраст | `min_age`–`max_age` | 100px | ✅ |
| Материал | `material_hint` | 150px | ✅ |
| Тарифы | computed from `tariffs[]` | 150px | ✅ |

### Additional columns (hidden by default, available in column picker)

| Column | Field |
|--------|-------|
| Специализация | `specialty` |
| Теги | `tags[].name` joined |
| Статус | `is_active` → "Активна" / "Архив" |
| Дата создания | `created_at` |

### Column picker

- Icon ⚙️ (gear) above table, right-aligned
- Click opens dropdown with checkboxes for each column
- Selection saved to `localStorage('services-column-visibility')`
- Default: title, duration, age, material_hint, tariffs visible

### Filters

- **Search:** text input, filters by `title` (case-insensitive contains)
- **Tags:** multi-select dropdown, filters by tag intersection
- **Status:** toggle "Все / Активные / Архив" (default: Активные)

### Row click

Opens `EntityModal` in `edit` mode with the service data.

### "Добавить услугу" button

Opens `EntityModal` in `create` mode with empty form.

### Soft delete

- Button "⋯" (three dots) at the end of each row → dropdown menu with "В архив" / "Восстановить"
- Sets `is_active = false` (archive) or `true` (restore)
- Row becomes greyed when archived, status shows "Архив"
- Default filter shows only active items; toggle "Все" to see archived
- No hard delete in UI

---

## 3. Locations Page (`/locations`)

### Route

`frontend/admin/app/(main)/locations/page.tsx`

### Table columns (default visible)

| Column | Field | Width | Sortable |
|--------|-------|-------|----------|
| Название | `name` | flex-1 | ✅ |
| Вместимость | `capacity` | 100px | ✅ |
| Адрес | `address` | flex-1 | ✅ |
| Подсказка | `location_hint` | 150px | ✅ |

### Additional columns (hidden by default)

| Column | Field |
|--------|-------|
| Описание | `description` |
| Статус | `is_active` |
| Яндекс.Карты | `yandex_map_url` (icon link) |
| Дата создания | `created_at` |

### Filters

- **Search:** text input, filters by `name` or `address`
- **Status:** toggle "Все / Активные / Архив"

### Row click / Add button / Soft delete

Same pattern as services.

---

## 4. Generic EntityModal

### Location

`frontend/admin/app/components/modal/EntityModal.tsx`

### Props

```tsx
interface EntityModalProps<T extends Record<string, unknown>> {
  mode: 'create' | 'edit'
  entity: T | null
  fields: FieldConfig<T>[]
  onSubmit: (data: Partial<T>) => Promise<void>
  onClose: () => void
  title: string
  subtitle?: string
 width?: 'default' | 'wide'  // default=max-w-[600px], wide=max-w-[800px]
}
```

### FieldConfig types

```tsx
type FieldConfig<T> =
  | TextFieldConfig
  | NumberFieldConfig
  | TextareaFieldConfig
  | SelectFieldConfig
  | TagsFieldConfig
  | NestedListFieldConfig<T>

interface TextFieldConfig {
  type: 'text'
  key: keyof T & string
  label: string
  placeholder?: string
  required?: boolean
  disabled?: boolean
}

interface NumberFieldConfig {
  type: 'number'
  key: keyof T & string
  label: string
  min?: number
  max?: number
  required?: boolean
  suffix?: string  // "мин", "чел." etc.
}

interface TextareaFieldConfig {
  type: 'textarea'
  key: keyof T & string
  label: string
  rows?: number
  placeholder?: string
}

interface SelectFieldConfig {
  type: 'select'
  key: keyof T & string
  label: string
  options: { value: string; label: string }[]
  required?: boolean
}

interface TagsFieldConfig {
  type: 'tags'
  key: keyof T & string
  label: string
  fetchTags: () => Promise<{ id: string; name: string }[]>
}

interface NestedListFieldConfig<T> {
  type: 'nested-list'
  key: keyof T & string
  label: string
  itemLabel: string
  itemFields: FieldConfig<unknown>[]
  addButtonText: string
  emptyText: string
}
```

### Visual layout

```
┌──────────────────────────────────────────────┐
│ [X]                                         │
│                                              │
│  Новая услуга                                │
│  Заполните данные услуги                      │
│                                              │
│  ┌─ Основная информация ──────────────────┐  │
│  │ Название*  [________________________]  │  │
│  │ Описание   [________________________]  │  │
│  │            [________________________]  │  │
│  │ Специализация [_____________________]  │  │
│  │ Длительность* [______] мин             │  │
│  │ Возраст от [___] до [___]             │  │
│  │ Материал    [________________________] │  │
│  │ Инфо для записи [____________________] │  │
│  │ Картинка URL [_______________________] │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌─ Тарифы ───────────────────────────────┐  │
│  │ ┌──────────────────────────────────┐   │  │
│  │ │ Взрослый     Цена: [____]₽      │   │  │
│  │ │ Описание     [_______________]   │   │  │
│  │ │                          [🗑]    │   │  │
│  │ └──────────────────────────────────┘   │  │
│  │ ┌──────────────────────────────────┐   │  │
│  │ │ Детский      Цена: [____]₽      │   │  │
│  │ │ Описание     [_______________]   │   │  │
│  │ │                          [🗑]    │   │  │
│  │ └──────────────────────────────────┘   │  │
│  │ [+ Добавить тариф]                     │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌─ Теги ─────────────────────────────────┐  │
│  │ [masterclass] [children] [family] [+]  │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ─────────────────────────────────────────── │
│              [Отмена]  [Сохранить]           │
└──────────────────────────────────────────────┘
```

### Behavior

- **Create mode:** empty form, submit creates new entity
- **Edit mode:** pre-filled form, submit updates entity
- **Validation:** required fields checked on submit, inline error messages
- **Loading state:** submit button shows spinner during API call
- **Error handling:** toast on API error, form stays open for retry
- **Close:** clicking overlay or ✕ closes modal (with confirmation if form is dirty)
- **Dirty check:** if user modified fields and tries to close → confirm dialog "Есть несохранённые изменения. Закрыть?"

### Nested list (Tariffs)

- Each item rendered as a collapsible card with inline fields
- "+ Добавить тариф" button at bottom
- Delete button (🗑) on each item
- Minimum 0 items (all can be deleted)
- No drag-to-reorder (tariffs don't need ordering)

---

## 5. Service Modal — Field Config

```tsx
const SERVICE_FIELDS: FieldConfig<ServiceResponse>[] = [
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
  { type: 'tags', key: 'tags', label: 'Теги', fetchTags: getTags },
]
```

**Width:** `'wide'` (800px) — service modal has many fields.

---

## 6. Location Modal — Field Config

```tsx
const LOCATION_FIELDS: FieldConfig<LocationResponse>[] = [
  { type: 'text', key: 'name', label: 'Название', required: true, placeholder: 'Студия на Тверской' },
  { type: 'text', key: 'address', label: 'Адрес', placeholder: 'ул. Тверская, д. 1' },
  { type: 'textarea', key: 'description', label: 'Описание', rows: 3, placeholder: 'Описание локации...' },
  { type: 'number', key: 'capacity', label: 'Вместимость', required: true, min: 1, max: 500, suffix: 'чел.' },
  { type: 'text', key: 'location_hint', label: 'Подсказка', placeholder: 'Как найти, проход и т.д.' },
  { type: 'text', key: 'record_info', label: 'Информация для записи', placeholder: 'Инструкция для клиента' },
  { type: 'text', key: 'yandex_map_url', label: 'Яндекс.Карты', placeholder: 'https://yandex.ru/maps/...' },
  { type: 'text', key: 'review_url', label: 'Ссылка на отзыв', placeholder: 'https://...' },
  { type: 'text', key: 'image_url', label: 'Картинка URL', placeholder: 'https://...' },
  { type: 'tags', key: 'tags', label: 'Теги', fetchTags: getTags },
]
```

**Width:** `'default'` (600px).

---

## 7. API Client Additions

### `packages/api-client/src/endpoints.ts`

Add to existing file:

```tsx
// Services CRUD
export async function createService(data: ServiceCreate): Promise<ServiceResponse> { ... }
export async function updateService(id: string, data: ServiceUpdate): Promise<ServiceResponse> { ... }
export async function deleteService(id: string): Promise<void> { ... }

// Locations CRUD
export async function createLocation(data: LocationCreate): Promise<LocationResponse> { ... }
export async function updateLocation(id: string, data: LocationUpdate): Promise<LocationResponse> { ... }
export async function deleteLocation(id: string): Promise<void> { ... }

// Tags (if not exists)
export async function getTags(): Promise<TagResponse[]> { ... }
```

### `packages/api-client/src/schemas.ts`

Add `ServiceCreate`, `ServiceUpdate`, `LocationCreate`, `LocationUpdate` schemas (mirroring backend Pydantic schemas).

### React Query hooks

New file: `frontend/admin/hooks/useServicesMutations.ts`

```tsx
export function useCreateService()  // mutation + invalidate ['services']
export function useUpdateService()  // mutation + invalidate ['services']
export function useDeleteService()  // mutation + invalidate ['services']
```

New file: `frontend/admin/hooks/useLocationsMutations.ts`

```tsx
export function useCreateLocation()
export function useUpdateLocation()
export function useDeleteLocation()
```

---

## 8. Edge Cases & Input Validation

### Service fields

| Field | Edge cases | Validation |
|-------|-----------|------------|
| title | Empty, whitespace-only, 200+ chars, special chars | Required, max 200 |
| duration | 0, negative, >480 (8h), non-integer | Required, 15–480 |
| min_age | Greater than max_age, negative, >18 | Must be ≤ max_age |
| max_age | Less than min_age, >18 | Must be ≥ min_age |
| tariffs | Empty array (valid), duplicate titles, price=0, negative price | Price ≥ 0 |
| tags | Nonexistent tag IDs, empty selection | Valid tag IDs only |
| image_url | Invalid URL, empty string (treat as null) | Optional, valid URL if provided |
| material_hint | Very long text (500+ chars) | Max 500 chars |

### Location fields

| Field | Edge cases | Validation |
|-------|-----------|------------|
| name | Empty, duplicate names, 200+ chars | Required, max 200 |
| capacity | 0, negative, >500 | Required, 1–500 |
| yandex_map_url | Invalid URL | Optional, valid URL if provided |
| address | Empty (allowed), very long | Max 500 chars |

### Modal behavior edge cases

- Double-click submit → debounce, single request
- Network error → toast + form stays open
- 409 Conflict (duplicate name) → inline error on the field
- Entity deleted by another session → toast "Элемент был удалён" + close modal
- Form dirty + browser navigation → `beforeunload` warning
- Escape key → close with dirty check

---

## 9. Testing Strategy

### Unit tests (Vitest + Testing Library)

**EntityModal:**
- Renders all field types correctly (text, number, textarea, select, tags, nested-list)
- Pre-fills form in edit mode
- Shows empty form in create mode
- Validates required fields on submit
- Validates number min/max bounds
- Validates min_age ≤ max_age cross-field
- Shows inline errors for invalid fields
- Adds/removes items in nested-list (tariffs)
- Calls onSubmit with correct data shape
- Calls onClose on overlay click
- Calls onClose on ✕ click
- Shows dirty-check confirmation on close
- Disables submit button during loading
- Shows error toast on API failure

**ServicesTable:**
- Renders rows from service data
- Sorts by each column (asc/desc)
- Filters by search text (case-insensitive)
- Filters by tags
- Filters by status (active/archived)
- Column picker shows/hides columns
- Column visibility persists in localStorage
- Clicking row calls onRowClick
- Archived rows styled differently
- Empty state "Услуги не найдены"
- Pagination works correctly

**LocationsTable:**
- Same patterns as ServicesTable with location-specific fields

**Input edge cases (all inputs):**
- Empty string submission
- Whitespace-only input
- Maximum length exceeded
- Special characters (<script>, quotes, backslashes)
- Copy-paste large content
- Rapid typing (debounce)
- Negative numbers where not allowed
- Decimal numbers in integer fields
- Unicode characters (emoji, Cyrillic, CJK)

### E2E tests (Playwright)

**Visual compliance:**
- `/services` page renders with correct layout
- `/locations` page renders with correct layout
- EntityModal for service renders all fields
- EntityModal for location renders all fields
- Column picker dropdown renders correctly
- Tables have correct column headers

**Service CRUD scenario:**
1. Navigate to `/services`
2. Click "+ Добавить услугу"
3. Fill all required fields (title, duration)
4. Add 2 tariffs
5. Add tags
6. Click "Сохранить"
7. Verify toast "Услуга создана"
8. Verify new row appears in table
9. Click on the new row
10. Verify modal opens with pre-filled data
11. Change title and duration
12. Click "Сохранить"
13. Verify toast "Услуга обновлена"
14. Verify table shows updated data
15. Click row → "В архив"
16. Verify row greyed out
17. Restore from archive
18. Verify row active again

**Location CRUD scenario:**
1. Navigate to `/locations`
2. Click "+ Добавить локацию"
3. Fill name, address, capacity
4. Save → verify in table
5. Edit → change capacity
6. Save → verify update
7. Archive → verify greyed
8. Restore → verify active

**Validation scenario:**
1. Open service modal (create)
2. Click "Сохранить" without filling → verify required errors
3. Enter duration=0 → verify min error
4. Enter min_age=15, max_age=5 → verify cross-field error
5. Enter title with 201 chars → verify max length error
6. Fill valid data → verify errors clear

**Edge case scenarios:**
1. Open modal → type in fields → click ✕ → verify dirty check dialog
2. Open modal → type → press Escape → verify dirty check
3. Open modal → submit → verify loading state on button
4. Open modal → submit with network error → verify toast + form stays open
5. Open modal → double-click submit rapidly → verify only one request sent

---

## 10. File Structure

```
frontend/admin/
├── app/
│   ├── (main)/
│   │   ├── services/
│   │   │   ├── page.tsx              # ServicesPage
│   │   │   └── components/
│   │   │       ├── ServicesTable.tsx  # Table with sorting/filtering
│   │   │       └── ServiceFilters.tsx # Search + tags + status filter
│   │   └── locations/
│   │       ├── page.tsx              # LocationsPage
│   │       └── components/
│   │           ├── LocationsTable.tsx
│   │           └── LocationFilters.tsx
│   └── components/
│       ├── modal/
│       │   └── EntityModal/
│       │       ├── index.tsx          # Generic EntityModal
│       │       ├── FieldRenderer.tsx   # Renders single field by config
│       │       ├── NestedList.tsx      # Renders nested-list (tariffs)
│       │       └── TagsSelect.tsx      # Tags multi-select
│       └── layout/
│           └── Menubar.tsx            # Add settings nav items
├── hooks/
│   ├── useServicesMutations.ts        # create/update/delete service
│   └── useLocationsMutations.ts       # create/update/delete location
├── __tests__/
│   ├── EntityModal.test.tsx
│   ├── ServicesTable.test.tsx
│   ├── LocationsTable.test.tsx
│   └── Menubar.test.tsx              # Update existing test
└── e2e/
    ├── services-crud.spec.ts
    ├── locations-crud.spec.ts
    └── entity-modal.spec.ts

packages/api-client/src/
├── endpoints.ts                       # Add CRUD functions
└── schemas.ts                         # Add create/update schemas
```

---

## 11. Dependencies & Sequencing

1. **API client first** — add CRUD endpoints + schemas (no UI dependency)
2. **EntityModal** — generic component, testable independently
3. **Services page** — depends on EntityModal + API client
4. **Locations page** — same dependencies, can be done in parallel with services
5. **Menubar update** — independent, can be done anytime
6. **E2E tests** — after all pages are working

## 12. What's NOT in scope

- Hard delete (only soft-delete via is_active)
- Bulk operations (multi-select delete/archive)
- Drag-to-reorder tariffs
- Image upload (only URL input)
- Tag management UI (tags are created via API or separate admin)
- Integration with records/clients pages (future phase)
