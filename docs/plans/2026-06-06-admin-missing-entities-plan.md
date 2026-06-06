# Admin Missing Entities: Masters, Tags, Photos, Materials + Location Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CRUD admin pages for Masters, Tags, Photos; add Materials CRUD to backend + edit within Services; fix missing Location fields in admin.

**Architecture:** Follow post-refactor patterns — each entity has its own co-located Modal with local FieldRenderer, local field config types, and entity-specific mutation hooks. No shared EntityModal (it was deleted in the unification refactor).

**Tech Stack:** FastAPI, SQLAlchemy async, Pydantic v2, Next.js App Router, TanStack React Query, Zod schemas, Tailwind CSS

---

## Post-Refactor Patterns (MUST follow)

After the unification refactor, the admin uses these patterns:

### Page structure (`app/(main)/{entity}/page.tsx`)
Minimal wrapper — just heading + table component:
```tsx
export default function XxxPage() {
  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)' }}>Управление Xxx</h1>
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}>
        <XxxTable />
      </div>
    </div>
  );
}
```

### Table component (`components/XxxTable.tsx`)
- Uses `useQuery` to fetch data directly (no context wrapper)
- Imports entity-specific mutation hooks from `@/hooks/useXxxMutations`
- Local `Column` interface with `key/label/width/hidden`
- Filter state: `search`, `status`
- Sort state: `sortField`, `sortDir`
- Pagination: `page`, `pageSize`
- Modal state: `editXxx` (for edit), `creatingXxx` (for create)
- Action dropdown: `openDropdownId`
- Renders entity-specific modal for edit/create

### Modal component (`components/XxxModal.tsx`)
Self-contained modal with **local inline FieldRenderer**:
- Props: `mode: 'create' | 'edit'`, entity data, `onSubmit`, `onClose`, `title`, `subtitle?`
- Local `FieldRenderer` function component (switch on field.type: text/number/textarea)
- Local field config types (TextFieldConfig, NumberFieldConfig, TextareaFieldConfig)
- Validation loop over fields
- Dirty check with `window.confirm`
- Escape key listener

### Field config (`components/xxxFields.tsx`)
Pure data file with local TypeScript interfaces (NOT imported from shared):
```tsx
interface TextFieldConfig { type: 'text'; key: string; label: string; placeholder?: string; required?: boolean; disabled?: boolean; }
interface NumberFieldConfig { type: 'number'; key: string; label: string; min?: number; max?: number; required?: boolean; suffix?: string; }
interface TextareaFieldConfig { type: 'textarea'; key: string; label: string; rows?: number; placeholder?: string; }
export type XxxFieldConfig = TextFieldConfig | NumberFieldConfig | TextareaFieldConfig;
```

### Mutation hooks (`hooks/useXxxMutations.ts`)
Three hooks using `useMutation` + `useQueryClient`:
```tsx
export function useCreateXxx() { ... invalidateQueries(['xxx']) }
export function useUpdateXxx() { ... invalidateQueries(['xxx']) }
export function useDeleteXxx() { ... invalidateQueries(['xxx']) }
```

---

## Scope

5 independent work streams, each shippable alone:

| Stream | Backend | Frontend | Priority |
|--------|---------|----------|----------|
| A. Masters CRUD page | Already done (router exists) | New page | High |
| B. Tags CRUD page | Add PUT/DELETE to router | New page | High |
| C. Photos CRUD page | Add full CRUD router + service | New page | High |
| D. Materials CRUD + Services edit | Add router + service | Edit within Services page | Medium |
| E. ColumnPicker shared | None | Extract + add to all 5 tables | Low |

---

## File Map

### New files to create

```
# Backend
backend/src/api/v1/materials.py          # D: new router
backend/src/services/material.py         # D: new service factory
backend/tests/test_api_materials.py      # D: tests

# Frontend — Admin: Masters
frontend/admin/app/(main)/masters/page.tsx
frontend/admin/app/(main)/masters/components/MastersTable.tsx
frontend/admin/app/(main)/masters/components/MasterModal.tsx
frontend/admin/app/(main)/masters/components/masterFields.tsx
frontend/admin/app/(main)/masters/components/MasterFilters.tsx
frontend/admin/hooks/useMastersMutations.ts

# Frontend — Admin: Tags
frontend/admin/app/(main)/tags/page.tsx
frontend/admin/app/(main)/tags/components/TagsTable.tsx
frontend/admin/app/(main)/tags/components/TagModal.tsx
frontend/admin/app/(main)/tags/components/tagFields.tsx
frontend/admin/hooks/useTagsMutations.ts

# Frontend — Admin: Photos
frontend/admin/app/(main)/photos/page.tsx
frontend/admin/app/(main)/photos/components/PhotosTable.tsx
frontend/admin/app/(main)/photos/components/PhotoModal.tsx
frontend/admin/app/(main)/photos/components/photoFields.tsx
frontend/admin/hooks/usePhotosMutations.ts
```

### Existing files to modify

```
# Backend
backend/src/api/v1/tags.py               # B: add PUT /{id} and DELETE /{id}
backend/src/main.py                      # D: register materials router

# Frontend — API Client
packages/api-client/src/schemas.ts       # A,B,C,D: add Create/Update schemas
packages/api-client/src/endpoints.ts     # A,B,C,D: add CRUD functions

# Frontend — Admin
frontend/admin/app/components/layout/Menubar.tsx  # A,B,C: fix masters href, add tags/photos links
frontend/admin/app/components/shared/ColumnPicker.tsx   # E: extract from services (NEW)
frontend/admin/app/(main)/services/components/ColumnPicker.tsx  # E: re-export
frontend/admin/app/(main)/locations/components/LocationsTable.tsx  # E: add ColumnPicker
frontend/admin/app/(main)/clients/components/ClientsTable.tsx     # E: add ColumnPicker
frontend/admin/app/(main)/records/components/RecordsTable.tsx     # E: add ColumnPicker
```

---

## Stream A: Masters CRUD Page

Backend router already exists at `backend/src/api/v1/masters.py` with full CRUD (GET list, GET by id, POST, PUT, DELETE). No backend changes needed.

### Task A1: API Client — Master CRUD functions

**File:** `packages/api-client/src/schemas.ts`

- [ ] Add after `MasterResponseSchema`:
```typescript
export const MasterCreateSchema = z.object({
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  position: z.enum(['мастер', 'администратор']),
  specialty: z.enum(['живопись', 'керамика']),
  avatar_url: z.string().optional().default(''),
});
export type MasterCreate = z.infer<typeof MasterCreateSchema>;

export const MasterUpdateSchema = MasterCreateSchema.partial();
export type MasterUpdate = z.infer<typeof MasterUpdateSchema>;
```

**File:** `packages/api-client/src/endpoints.ts`

- [ ] Add after existing `getMaster`:
```typescript
export async function createMaster(data: MasterCreate): Promise<MasterResponse> {
  return api('/api/v1/masters', MasterResponseSchema, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateMaster(id: string, data: MasterUpdate): Promise<MasterResponse> {
  return api(`/api/v1/masters/${id}`, MasterResponseSchema, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteMaster(id: string): Promise<void> {
  await api(`/api/v1/masters/${id}`, z.any(), { method: 'DELETE' });
}
```
- [ ] Add imports: `MasterCreateSchema`, `MasterCreate`, `MasterUpdate`

### Task A2: Mutation hooks

**File:** `frontend/admin/hooks/useMastersMutations.ts` (NEW)

- [ ] Create following the pattern from `useLocationsMutations.ts`:
  - `useCreateMaster()` — mutationFn calls `createMaster`, invalidates `['masters']`
  - `useUpdateMaster()` — mutationFn calls `updateMaster`, invalidates `['masters']`
  - `useDeleteMaster()` — mutationFn calls `deleteMaster`, invalidates `['masters']`

### Task A3: Master fields config

**File:** `frontend/admin/app/(main)/masters/components/masterFields.tsx` (NEW)

- [ ] Create with local field types (same pattern as `locationFields.tsx`):
  - `first_name` — text, required, placeholder "Иван"
  - `last_name` — text, required, placeholder "Иванов"
  - `color` — text, required, placeholder "#5B8C7A"
  - `position` — text, required, placeholder "мастер" (enum select not yet in pattern)
  - `specialty` — text, required, placeholder "живопись" (enum select not yet in pattern)
  - `avatar_url` — text, placeholder "https://..."

### Task A4: Master filters

**File:** `frontend/admin/app/(main)/masters/components/MasterFilters.tsx` (NEW)

- [ ] Create following `LocationFilters.tsx` pattern:
  - Props: `search`, `status`, `onSearchChange`, `onStatusChange`, `onReset`
  - Search by name, status filter (active/archived)

### Task A5: MasterModal component

**File:** `frontend/admin/app/(main)/masters/components/MasterModal.tsx` (NEW)

- [ ] Create following `LocationModal.tsx` pattern:
  - Local FieldRenderer (switch on text/number/textarea)
  - Props: `mode`, `master`, `onSubmit`, `onClose`, `title`, `subtitle?`
  - Form state, validation, dirty check, Escape handler
  - Same overlay/card structure as LocationModal

### Task A6: MastersTable component

**File:** `frontend/admin/app/(main)/masters/components/MastersTable.tsx` (NEW)

- [ ] Create following `LocationsTable.tsx` pattern:
  - Columns: Имя (first_name + last_name), Специальность, Должность, Цвет (swatch), Аватар (image thumbnail), Статус
  - Sort by: first_name, specialty, position, created_at
  - Filters: search, status
  - Pagination (pageSize 20)
  - Actions: Edit (opens MasterModal), Archive/Restore toggle
  - Use `getMasters()` via `useQuery<MasterResponse[]>` for data

### Task A7: Masters page shell

**File:** `frontend/admin/app/(main)/masters/page.tsx` (NEW)

- [ ] Create minimal wrapper following `locations/page.tsx`:
  - Heading "Управление мастерами"
  - `<MastersTable />` inside card div

### Task A8: Update sidebar navigation

**File:** `frontend/admin/app/components/layout/Menubar.tsx`

- [ ] Change `{ label: 'Мастера', icon: 'palette', href: '#' }` to `{ label: 'Мастера', icon: 'palette', href: '/masters' }`

---

## Stream B: Tags CRUD Page

Backend has GET + POST only. Need to add PUT + DELETE.

### Task B1: Backend — extend tags router

**File:** `backend/src/api/v1/tags.py`

- [ ] Add PUT and DELETE endpoints:
```python
from fastapi import APIRouter, Depends, HTTPException

@router.put("/{tag_id}", response_model=TagResponse)
async def update_tag(
    tag_id: str,
    data: TagCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> TagResponse:
    tag = await service.update(db_session=session, id=tag_id, data=data)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    return tag

@router.delete("/{tag_id}", status_code=204)
async def delete_tag(
    tag_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> None:
    deleted = await service.delete(db_session=session, id=tag_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Tag not found")
```

### Task B2: Backend — tests for tags CRUD

**File:** `backend/tests/test_api_tags.py` (extend existing)

- [ ] Test GET /tags returns list
- [ ] Test POST /tags creates tag
- [ ] Test PUT /{id} updates tag
- [ ] Test DELETE /{id} soft-deletes tag

### Task B3: API Client — Tag CRUD functions

**File:** `packages/api-client/src/schemas.ts`

- [ ] Add:
```typescript
export const TagCreateSchema = z.object({
  tag: z.string().min(1).max(100),
});
export type TagCreate = z.infer<typeof TagCreateSchema>;

export const TagUpdateSchema = TagCreateSchema.partial();
export type TagUpdate = z.infer<typeof TagUpdateSchema>;
```

**File:** `packages/api-client/src/endpoints.ts`

- [ ] Add after existing `getTags`:
```typescript
export async function createTag(data: TagCreate): Promise<TagResponse> {
  return api('/api/v1/tags', TagResponseSchema, { method: 'POST', body: JSON.stringify(data) });
}
export async function updateTag(id: string, data: TagUpdate): Promise<TagResponse> {
  return api(`/api/v1/tags/${id}`, TagResponseSchema, { method: 'PUT', body: JSON.stringify(data) });
}
export async function deleteTag(id: string): Promise<void> {
  await api(`/api/v1/tags/${id}`, z.any(), { method: 'DELETE' });
}
```

### Task B4: Tags mutation hooks

**File:** `frontend/admin/hooks/useTagsMutations.ts` (NEW)

- [ ] Create `useCreateTag`, `useUpdateTag`, `useDeleteTag`

### Task B5: Tag fields config

**File:** `frontend/admin/app/(main)/tags/components/tagFields.tsx` (NEW)

- [ ] Create with local types:
  - `tag` — text, required, placeholder "VIP, Постоянный клиент..."

### Task B6: TagModal component

**File:** `frontend/admin/app/(main)/tags/components/TagModal.tsx` (NEW)

- [ ] Create following LocationModal pattern (simple — only one text field)

### Task B7: TagsTable component

**File:** `frontend/admin/app/(main)/tags/components/TagsTable.tsx` (NEW)

- [ ] Simple table (tags are simple — just one field):
  - Columns: Тег, Статус
  - Sort by: tag, created_at
  - Filters: search, status
  - Actions: Edit, Delete (with confirmation)

### Task B8: Tags page shell

**File:** `frontend/admin/app/(main)/tags/page.tsx` (NEW)

- [ ] Heading "Управление тегами" + `<TagsTable />`

### Task B9: Add Tags to sidebar

**File:** `frontend/admin/app/components/layout/Menubar.tsx`

- [ ] Add `{ label: 'Теги', icon: 'tag', href: '/tags' }` to SETTINGS_ITEMS
- [ ] Add SVG icon for tag (or use text emoji as placeholder)

---

## Stream C: Photos CRUD Page

Backend needs full CRUD (currently read-only).

### Task C1: Backend — Photo schemas (create/update)

**File:** `backend/src/schemas/photo.py`

- [ ] Add:
```python
class PhotoCreate(BaseModel):
    filename: str
    visitor_id: str | None = None
    service_id: str | None = None
    activity_id: str | None = None
    is_public: bool = False

class PhotoUpdate(BaseModel):
    filename: str | None = None
    visitor_id: str | None = None
    service_id: str | None = None
    activity_id: str | None = None
    is_public: bool | None = None
```

### Task C2: Backend — Photo service

**File:** `backend/src/services/photo.py` (NEW)

- [ ] Create service factory following `location.py` pattern:
```python
from functools import lru_cache
from src.repositories.generic import get_generic_repository
from src.models.photo import Photo
from src.schemas.photo import PhotoCreate, PhotoResponse, PhotoUpdate
from src.services.generic import GenericService

@lru_cache
def get_photo_service() -> GenericService[PhotoCreate, PhotoUpdate, PhotoResponse]:
    return GenericService(get_generic_repository(), Photo, PhotoResponse)
```

### Task C3: Backend — Photo router (full CRUD)

**File:** `backend/src/api/v1/photos.py`

- [ ] Keep existing `GET /web` endpoint (public photos)
- [ ] Add full CRUD endpoints following locations pattern:
  - `GET /` — list all active photos (admin view)
  - `GET /{photo_id}` — get single photo
  - `POST /` — create photo (201)
  - `PUT /{photo_id}` — update photo
  - `DELETE /{photo_id}` — soft-delete photo (204)

### Task C4: Backend — tests for photos CRUD

**File:** `backend/tests/test_api_photos.py` (extend existing)

- [ ] Test GET / returns all active photos
- [ ] Test POST / creates photo
- [ ] Test PUT /{id} updates photo
- [ ] Test DELETE /{id} soft-deletes
- [ ] Test GET /web still returns only public photos

### Task C5: API Client — Photo CRUD + schemas

**File:** `packages/api-client/src/schemas.ts`

- [ ] Add:
```typescript
export const PhotoCreateSchema = z.object({
  filename: z.string().min(1),
  visitor_id: z.string().optional().default(''),
  service_id: z.string().optional().default(''),
  activity_id: z.string().optional().default(''),
  is_public: z.boolean().default(false),
});
export type PhotoCreate = z.infer<typeof PhotoCreateSchema>;

export const PhotoUpdateSchema = PhotoCreateSchema.partial();
export type PhotoUpdate = z.infer<typeof PhotoUpdateSchema>;
```

**File:** `packages/api-client/src/endpoints.ts`

- [ ] Add: `getPhotos`, `createPhoto`, `updatePhoto`, `deletePhoto`

### Task C6: Photos mutation hooks

**File:** `frontend/admin/hooks/usePhotosMutations.ts` (NEW)

- [ ] Create `useCreatePhoto`, `useUpdatePhoto`, `useDeletePhoto`

### Task C7: Photo fields config

**File:** `frontend/admin/app/(main)/photos/components/photoFields.tsx` (NEW)

- [ ] Create:
  - `filename` — text, required
  - `is_public` — text, placeholder "true / false"
  - Note: visitor_id, service_id, activity_id are optional FKs — text inputs for now

### Task C8: PhotoModal component

**File:** `frontend/admin/app/(main)/photos/components/PhotoModal.tsx` (NEW)

- [ ] Create following LocationModal pattern

### Task C9: PhotosTable component

**File:** `frontend/admin/app/(main)/photos/components/PhotosTable.tsx` (NEW)

- [ ] Columns: Превью (img thumbnail), Файл, Привязка, Публичное, Статус
- [ ] Sort, filter, pagination, edit/delete actions

### Task C10: Photos page shell

**File:** `frontend/admin/app/(main)/photos/page.tsx` (NEW)

- [ ] Heading "Управление фото" + `<PhotosTable />`

### Task C11: Add Photos to sidebar

**File:** `frontend/admin/app/components/layout/Menubar.tsx`

- [ ] Add `{ label: 'Фото', icon: 'image', href: '/photos' }` to SETTINGS_ITEMS

---

## Stream D: Materials CRUD + Services Integration

Backend has model + schemas but no router/service. Need full CRUD backend + UI within Services page.

### Task D1: Backend — Material service

**File:** `backend/src/services/material.py` (NEW)

- [ ] Create service factory:
```python
from functools import lru_cache
from src.repositories.generic import get_generic_repository
from src.models.material import Material
from src.schemas.material import MaterialCreate, MaterialResponse, MaterialUpdate
from src.services.generic import GenericService

@lru_cache
def get_material_service() -> GenericService[MaterialCreate, MaterialUpdate, MaterialResponse]:
    return GenericService(get_generic_repository(), Material, MaterialResponse)
```

### Task D2: Backend — Material router

**File:** `backend/src/api/v1/materials.py` (NEW)

- [ ] Create full CRUD router following locations pattern:
  - `GET /` — list all active materials
  - `GET /{material_id}` — get single
  - `POST /` — create (201)
  - `PUT /{material_id}` — update
  - `DELETE /{material_id}` — soft-delete (204)

### Task D3: Backend — register materials router

**File:** `backend/src/main.py`

- [ ] Add import and registration:
```python
from src.api.v1 import materials as materials_router
app.include_router(materials_router.router, prefix="/api/v1/materials")
```

### Task D4: Backend — tests for materials CRUD

**File:** `backend/tests/test_api_materials.py` (NEW)

- [ ] Standard CRUD tests

### Task D5: API Client — Material CRUD + schemas

**File:** `packages/api-client/src/schemas.ts`

- [ ] Add `MaterialCreateSchema`, `MaterialUpdateSchema`, `MaterialResponseSchema`

**File:** `packages/api-client/src/endpoints.ts`

- [ ] Add `getMaterials`, `createMaterial`, `updateMaterial`, `deleteMaterial`

### Task D6: Materials mutation hooks

**File:** `frontend/admin/hooks/useMaterialsMutations.ts` (NEW)

- [ ] Create `useCreateMaterial`, `useUpdateMaterial`, `useDeleteMaterial`

### Task D7: Materials section in Services page

**File:** `frontend/admin/app/(main)/services/page.tsx`

- [ ] Add a "Материалы" toggle button next to the services heading
- [ ] When clicked, swap `<ServicesTable />` with `<MaterialsTable />`

### Task D8: MaterialsTable + MaterialModal

**File:** `frontend/admin/app/(main)/services/components/MaterialsTable.tsx` (NEW)

- [ ] Columns: Название, Описание, Статус, Действия
- [ ] Inline CRUD using MaterialModal

**File:** `frontend/admin/app/(main)/services/components/MaterialModal.tsx` (NEW)

- [ ] Following LocationModal pattern, fields: title (text, required), description (textarea, required)

---

## Stream E: Shared ColumnPicker + Configurable Column Visibility

ServicesTable already has a ColumnPicker component. Goal: extract it to shared, add to all tables, keep current visible columns as defaults.

### Task E1: Extract ColumnPicker to shared components

**File:** `frontend/admin/app/components/shared/ColumnPicker.tsx` (NEW)

- [ ] Copy from `frontend/admin/app/(main)/services/components/ColumnPicker.tsx`
- [ ] No changes needed — it's already generic (accepts `columns: Column[]`, `visibleKeys`, `onChange`, `storageKey`)

**File:** `frontend/admin/app/(main)/services/components/ColumnPicker.tsx`

- [ ] Replace contents with re-export:
```typescript
export { ColumnPicker } from '@/app/components/shared/ColumnPicker';
```

### Task E2: Add ColumnPicker to LocationsTable

**File:** `frontend/admin/app/(main)/locations/components/LocationsTable.tsx`

- [ ] Import `ColumnPicker` from `@/app/components/shared/ColumnPicker`
- [ ] Add `defaultVisible` to each column in `COLUMNS`:
  - `name` — defaultVisible: true
  - `capacity` — defaultVisible: true
  - `address` — defaultVisible: true
  - `location_hint` — defaultVisible: true
  - `description` — defaultVisible: false
  - `is_active` — defaultVisible: false
  - `yandex_map_url` — defaultVisible: false
  - `created_at` — defaultVisible: false
- [ ] Add state: `visibleKeys` initialized from localStorage or defaults
- [ ] Filter `VISIBLE_COLUMNS` based on `visibleKeys`
- [ ] Add `<ColumnPicker>` in the filter bar next to the "Добавить" button
- [ ] Render cells conditionally based on visible columns (add `<td>` for each hidden column)

### Task E3: Add ColumnPicker to ClientsTable

**File:** `frontend/admin/app/(main)/clients/components/ClientsTable.tsx`

- [ ] Import `ColumnPicker` from `@/app/components/shared/ColumnPicker`
- [ ] Add `defaultVisible` to each column in `COLUMNS`:
  - `name` — defaultVisible: true
  - `phone` — defaultVisible: true
  - `visits_count` — defaultVisible: true
  - `last_visit` — defaultVisible: true
  - `total_paid` — defaultVisible: true
- [ ] Add state: `visibleKeys` initialized from `localStorage.getItem('clients-columns')` or defaults
- [ ] Filter `COLUMNS` by `visibleKeys` before rendering `<thead>`
- [ ] Render `<td>` cells conditionally based on visible columns
- [ ] Add `<ColumnPicker>` in the filter bar area (next to reset button)

### Task E4: Add ColumnPicker to RecordsTable

**File:** `frontend/admin/app/(main)/records/components/RecordsTable.tsx`

- [ ] Import `ColumnPicker` from `@/app/components/shared/ColumnPicker`
- [ ] Define column list with keys and defaults (all currently visible by default):
  - `date` — "Дата / Время", defaultVisible: true
  - `client` — "Клиент", defaultVisible: true
  - `guests` — "Гостей", defaultVisible: true
  - `service` — "Услуга", defaultVisible: true
  - `master` — "Мастер", defaultVisible: true
  - `location` — "Локация", defaultVisible: true
  - `status` — "Статус", defaultVisible: true
  - `total` — "Сумма", defaultVisible: true
  - `payment` — "Оплата", defaultVisible: true
- [ ] Add state: `visibleKeys` initialized from `localStorage.getItem('records-columns')` or defaults
- [ ] Wrap `<table>` with a div that includes `<ColumnPicker>` in the top-right
- [ ] Render `<th>` and `<td>` conditionally based on visible columns

### Task E5: Add ColumnPicker to future tables

When creating MastersTable, TagsTable, PhotosTable — include ColumnPicker from the start:
- MastersTable: defaultVisible — first_name, last_name, specialty, position, is_active
- TagsTable: defaultVisible — tag, is_active (simple table, may not need picker)
- PhotosTable: defaultVisible — filename, is_public, is_active

---

## Execution Order

Recommended sequence (each stream can be done independently):

1. **Stream E** (ColumnPicker shared) — smallest, enables configurability for all tables
2. **Stream B** (Tags) — backend + frontend, enables tag management
3. **Stream A** (Masters) — backend done, frontend only
4. **Stream D** (Materials) — backend + frontend integration
5. **Stream C** (Photos) — most complex, needs full CRUD backend

---

## Verification

After each stream:

1. **Backend:** Run `pytest backend/tests/test_api_{entity}.py` — all tests pass
2. **Frontend:** Run `cd frontend && npx tsc --noEmit` — no type errors
3. **Manual:** Open admin, navigate to new page, create/edit/archive/delete entity
4. **Lint:** Run `cd frontend && npm run lint` — no lint errors
