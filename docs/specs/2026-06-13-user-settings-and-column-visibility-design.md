# User Settings + DayView Column Visibility

**Date:** 2026-06-13
**Scope:** Backend CRUD for user settings, frontend sync, DayView column visibility via filters, DnD reorder, pin removal
**Branch:** `feat/photo-searchable-select`

## Problem Statement

1. No persistent user settings (theme, language, column order)
2. DayView column visibility is disconnected from filters — filters hide activities but columns are auto-computed
3. Pin feature is redundant — filters already control what the user sees
4. Column reorder (DnD) state is lost on page navigation (stored in React useState)

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Backend user_settings table (not just localStorage) | Multi-device sync, single source of truth |
| localStorage as frontend cache | Fast reads, offline support, backend is source of truth |
| Filters = column visibility | Natural UX — user selects masters they want to see |
| Remove pin feature | Redundant with filter-based visibility |
| Full CRUD (GET/POST/PUT/DELETE) | Standard REST, soft delete via is_active |

## Visual Compliance Checks

- [ ] Pin buttons are removed from DayView column headers
- [ ] Column headers show only masters/locations selected in filter
- [ ] Empty filter shows all columns
- [ ] Column reorder via Cmd+drag persists across page navigation
- [ ] Column reorder persists across browser refresh

---

## 1. Backend — UserSettings

### 1.1 Model

```python
# backend/src/models/user_settings.py

class UserSettings(AbstractModel):
    __tablename__ = "user_settings"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), unique=True, nullable=False,
    )
    theme: Mapped[str] = mapped_column(String(10), default="light")
    language: Mapped[str] = mapped_column(String(5), default="ru")
    column_order_masters: Mapped[str] = mapped_column(
        Text, default="[]",  # JSON array of master IDs
    )
    column_order_locations: Mapped[str] = mapped_column(
        Text, default="[]",  # JSON array of location IDs
    )
```

Inherits from `AbstractModel`: `id` (UUID), `created_at`, `updated_at`, `is_active`.

### 1.2 Schema

```python
# backend/src/schemas/user_settings.py

class UserSettingsResponse(BaseModel):
    id: str
    user_id: str
    theme: str
    language: str
    column_order_masters: list[str]
    column_order_locations: list[str]
    created_at: datetime
    updated_at: datetime

class UserSettingsCreate(BaseModel):
    user_id: str
    theme: str = "light"
    language: str = "ru"
    column_order_masters: list[str] = []
    column_order_locations: list[str] = []

class UserSettingsUpdate(BaseModel):
    theme: str | None = None
    language: str | None = None
    column_order_masters: list[str] | None = None
    column_order_locations: list[str] | None = None
```

### 1.3 Repository

```python
# backend/src/repositories/user_settings.py

class UserSettingsRepository:
    async def get_by_user(self, user_id: str) -> UserSettings | None
    async def create(self, data: UserSettingsCreate) -> UserSettings
    async def update(self, id: str, data: UserSettingsUpdate) -> UserSettings
    async def soft_delete(self, id: str) -> None  # sets is_active = False
```

### 1.4 Service

```python
# backend/src/services/user_settings.py

class UserSettingsService:
    async def get(self, user_id: str) -> UserSettings | None
    async def get_or_create(self, user_id: str) -> UserSettings
    async def create(self, data: UserSettingsCreate) -> UserSettings
    async def update(self, user_id: str, data: UserSettingsUpdate) -> UserSettings
    async def delete(self, user_id: str) -> None
```

### 1.5 API Endpoints

```python
# backend/src/api/v1/user_settings.py

router = APIRouter(prefix="/user-settings", tags=["user-settings"])

@router.get("/", response_model=UserSettingsResponse)
async def get_settings(user_id: str, session=Depends(get_session)):
    """Get settings for user. Creates defaults if none exist."""

@router.post("/", response_model=UserSettingsResponse, status_code=201)
async def create_settings(data: UserSettingsCreate, session=Depends(get_session)):
    """Create new settings for user."""

@router.put("/", response_model=UserSettingsResponse)
async def update_settings(user_id: str, data: UserSettingsUpdate, session=Depends(get_session)):
    """Update settings for user."""

@router.delete("/{id}", status_code=204)
async def delete_settings(id: str, session=Depends(get_session)):
    """Soft delete settings (sets is_active = False)."""
```

### 1.6 Migration

Alembic migration to create `user_settings` table with:
- All AbstractModel fields (id, created_at, updated_at, is_active)
- user_id FK → users.id, unique
- theme, language, column_order_masters, column_order_locations

---

## 2. Frontend — UserSettings Context

### 2.1 API Client

Add to `packages/api-client/src/endpoints.ts`:

```typescript
export const userSettingsEndpoints = {
  get: (userId: string) => api.get(`/user-settings?user_id=${userId}`),
  create: (data: UserSettingsCreate) => api.post('/user-settings', data),
  update: (userId: string, data: UserSettingsUpdate) => api.put(`/user-settings?user_id=${userId}`, data),
  delete: (id: string) => api.delete(`/user-settings/${id}`),
};
```

### 2.2 Context

```typescript
// frontend/admin/contexts/UserSettingsContext.tsx

interface UserSettings {
  theme: 'light' | 'dark';
  language: 'ru' | 'en';
  columnOrderMasters: string[];
  columnOrderLocations: string[];
}

interface UserSettingsContextType {
  settings: UserSettings;
  updateSettings: (partial: Partial<UserSettings>) => void;
  getColumnOrder: (mode: 'masters' | 'locations') => string[];
  setColumnOrder: (mode: 'masters' | 'locations', order: string[]) => void;
}
```

### 2.3 Data Flow

```
App init:
  1. Read localStorage('user-settings')
  2. If empty → GET API → save to localStorage
  3. Provide to context

User changes settings:
  1. Update context state (immediate)
  2. Update localStorage (immediate)
  3. Debounced PUT API (300ms)

Page reload:
  1. Read localStorage → instant
  2. Background GET API → sync if changed on another device
```

### 2.4 localStorage Key

`memo-user-settings` — JSON string of `UserSettings`.

---

## 3. DayView — Filter = Column Visibility

### 3.1 Columns Memo Logic

**Current:**
```typescript
if (showAllColumns) return allMasters;
// filter active + pinned
```

**New:**
```typescript
// Empty filter = all columns (ordered by user settings or backend sortOrder)
if (filterMasterIds.length === 0) {
  const order = getColumnOrder('masters');
  return order.length > 0
    ? order.map(id => allMasters.find(m => m.id === id)).filter(Boolean)
    : allMasters;
}
// Filter selected = only those columns
return filterMasterIds
  .map(id => allMasters.find(m => m.id === id))
  .filter(Boolean);
```

Same logic for locations mode.

### 3.2 DnD Column Reorder

- Cmd/Alt + drag header → reorder columns
- `onColumnDrop(draggedId, targetId)`:
  1. Compute new order
  2. `setColumnOrder('masters', newOrder)` → updates context + localStorage + debounced API
  3. Columns re-render in new order

### 3.3 Pin Removal

Remove from DayView:
- `usePinnedColumns` import and hook call
- `pinnedMasterIds`, `pinnedLocationIds` in columns memo
- Pin buttons in `ScheduleColumnHeader`

Remove files:
- `hooks/usePinnedColumns.ts`
- `__tests__/usePinnedColumns.test.ts`

Remove from ScheduleContext:
- `showAllColumns` state and related logic

---

## 4. WeekView — No Changes

Filters already hide activities in WeekView (ScheduleContext line 464-465). WeekView shows 7 day columns regardless of filters. No changes needed.

---

## 5. What Gets Deleted

| File/Code | Action |
|-----------|--------|
| `hooks/usePinnedColumns.ts` | Delete file |
| `__tests__/usePinnedColumns.test.ts` | Delete file |
| Pin buttons in DayView column headers | Remove JSX |
| `showAllColumns` in ScheduleContext | Remove state + expose |
| `showAllColumnsTemp` in DayView | Remove state (kostyl) |
| `usePinnedColumns` tests in DayView.test.tsx | Remove test cases |
| Pin-related test IDs (`pin-m1`, etc.) | Remove from tests |

---

## 6. Testing Strategy

- **Backend:** Unit tests for repository, service, API endpoints
- **Frontend unit:** UserSettingsContext tests, updated DayView tests
- **E2E:** 
  - Filter controls column visibility in DayView
  - Column reorder persists across page navigation
  - Column reorder persists across browser refresh
  - Pin buttons are gone
