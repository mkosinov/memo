# User Settings + DayView Column Visibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent user settings (theme, language, column order) with backend CRUD + frontend localStorage sync. Make DayView column visibility controlled by existing filters. Remove pin feature.

**Architecture:** Backend CRUD for user_settings table (GenericRepository + GenericService pattern). Frontend UserSettingsContext syncs with localStorage + backend API. DayView columns memo reads filter state for visibility. useColumnReorder reads/writes column order from UserSettings.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, Next.js 14, React Context, localStorage, @dnd-kit

**Spec:** `docs/specs/2026-06-13-user-settings-and-column-visibility-design.md`

---

## File Structure

### Backend (new files)
| File | Responsibility |
|------|---------------|
| `backend/src/models/user_settings.py` | UserSettings ORM model |
| `backend/src/schemas/user_settings.py` | Pydantic schemas (Create, Update, Response) |
| `backend/src/api/v1/user_settings.py` | API endpoints (GET/POST/PUT/DELETE) |
| `backend/alembic/versions/xxxx_add_user_settings.py` | DB migration |

### Backend (modified files)
| File | Change |
|------|--------|
| `backend/src/models/__init__.py` | Export UserSettings |
| `backend/src/main.py` | Register user_settings router |

### Frontend (new files)
| File | Responsibility |
|------|---------------|
| `frontend/admin/contexts/UserSettingsContext.tsx` | Global settings state + localStorage + API sync |
| `frontend/admin/hooks/useUserSettings.ts` | Convenience hook for consuming settings |

### Frontend (modified files)
| File | Change |
|------|--------|
| `frontend/admin/app/components/schedule/DayView.tsx` | Filter = column visibility, remove pin, use UserSettings for order |
| `frontend/admin/app/components/layout/Topbar.tsx` | No changes needed (filters already work) |
| `packages/api-client/src/endpoints.ts` | Add userSettingsEndpoints |
| `packages/api-client/src/schemas.ts` | Add UserSettings schemas |

### Frontend (deleted files)
| File | Reason |
|------|--------|
| `frontend/admin/hooks/usePinnedColumns.ts` | Pin feature removed |
| `frontend/admin/__tests__/usePinnedColumns.test.ts` | Pin feature removed |

---

## Task 1: Create UserSettings Model + Migration

### Classification: small
### Required Docs
- `backend/src/models/abstract.py` — base model with UUID, timestamps, is_active
- `backend/src/models/user.py` — existing User model (FK target)

### Task Description
Create the UserSettings ORM model and Alembic migration.

### Steps

1. Create `backend/src/models/user_settings.py`:
```python
"""User settings ORM model — stores per-user preferences."""

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.models.abstract import AbstractModel


class UserSettings(AbstractModel):
    __tablename__ = "user_settings"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), unique=True, nullable=False,
    )
    theme: Mapped[str] = mapped_column(String(10), default="light")
    language: Mapped[str] = mapped_column(String(5), default="ru")
    column_order_masters: Mapped[str] = mapped_column(
        Text, default="[]",
    )
    column_order_locations: Mapped[str] = mapped_column(
        Text, default="[]",
    )
```

2. Update `backend/src/models/__init__.py` — add `UserSettings` to imports and `__all__`

3. Create migration `backend/alembic/versions/xxxx_add_user_settings.py`:
```python
"""Add user_settings table

Revision ID: <auto>
Create Date: <auto>
"""
from alembic import op
import sqlalchemy as sa

def upgrade() -> None:
    op.create_table(
        "user_settings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), unique=True, nullable=False),
        sa.Column("theme", sa.String(10), nullable=False, server_default="light"),
        sa.Column("language", sa.String(5), nullable=False, server_default="ru"),
        sa.Column("column_order_masters", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("column_order_locations", sa.Text(), nullable=False, server_default="[]"),
    )

def downgrade() -> None:
    op.drop_table("user_settings")
```

4. Run migration: `cd backend && alembic upgrade head`
5. Verify: `sqlite3 backend/memo.db ".schema user_settings"`
6. Commit: `feat: add UserSettings model and migration`

---

## Task 2: Create UserSettings Schemas

### Classification: trivial
### Required Docs
- `backend/src/schemas/master.py` — existing schema pattern

### Task Description
Create Pydantic schemas for UserSettings API.

### Steps

1. Create `backend/src/schemas/user_settings.py`:
```python
"""Pydantic schemas for UserSettings API."""

from datetime import datetime
from pydantic import BaseModel


class UserSettingsResponse(BaseModel):
    id: str
    user_id: str
    theme: str
    language: str
    column_order_masters: list[str]
    column_order_locations: list[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


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

2. Commit: `feat: add UserSettings Pydantic schemas`

---

## Task 3: Create UserSettings API Endpoints

### Classification: standard
### Required Docs
- `backend/src/api/v1/masters.py` — existing endpoint pattern
- `backend/src/services/generic.py` — GenericService pattern
- `backend/src/repositories/generic.py` — GenericRepository pattern

### Task Description
Create API endpoints for UserSettings CRUD. Use GenericService for standard operations, add custom `get_by_user_id` method.

### Steps

1. Create `backend/src/api/v1/user_settings.py`:
```python
"""User settings API endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.db import get_session
from src.models.user_settings import UserSettings
from src.repositories.generic import get_generic_repository
from src.schemas.user_settings import (
    UserSettingsCreate,
    UserSettingsResponse,
    UserSettingsUpdate,
)

router = APIRouter(tags=["user-settings"])

repo = get_generic_repository()


def _to_response(model: UserSettings) -> UserSettingsResponse:
    import json
    return UserSettingsResponse(
        id=model.id,
        user_id=model.user_id,
        theme=model.theme,
        language=model.language,
        column_order_masters=json.loads(model.column_order_masters),
        column_order_locations=json.loads(model.column_order_locations),
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


@router.get("/", response_model=UserSettingsResponse)
async def get_settings(user_id: str, session: AsyncSession = Depends(get_session)):
    """Get settings for user. Returns 404 if none exist."""
    from sqlalchemy import select
    stmt = select(UserSettings).where(
        UserSettings.user_id == user_id,
        UserSettings.is_active == True,
    )
    result = await session.execute(stmt)
    settings = result.scalar_one_or_none()
    if not settings:
        raise HTTPException(status_code=404, detail="No settings found for user")
    return _to_response(settings)


@router.post("/", response_model=UserSettingsResponse, status_code=201)
async def create_settings(
    data: UserSettingsCreate,
    session: AsyncSession = Depends(get_session),
):
    """Create new settings for user."""
    import json
    settings = UserSettings(
        user_id=data.user_id,
        theme=data.theme,
        language=data.language,
        column_order_masters=json.dumps(data.column_order_masters),
        column_order_locations=json.dumps(data.column_order_locations),
    )
    session.add(settings)
    await session.flush()
    await session.refresh(settings)
    return _to_response(settings)


@router.put("/", response_model=UserSettingsResponse)
async def update_settings(
    user_id: str,
    data: UserSettingsUpdate,
    session: AsyncSession = Depends(get_session),
):
    """Update settings for user."""
    import json
    from sqlalchemy import select
    stmt = select(UserSettings).where(
        UserSettings.user_id == user_id,
        UserSettings.is_active == True,
    )
    result = await session.execute(stmt)
    settings = result.scalar_one_or_none()
    if not settings:
        raise HTTPException(status_code=404, detail="No settings found for user")

    update_data = data.model_dump(exclude_unset=True)
    if "column_order_masters" in update_data:
        update_data["column_order_masters"] = json.dumps(update_data["column_order_masters"])
    if "column_order_locations" in update_data:
        update_data["column_order_locations"] = json.dumps(update_data["column_order_locations"])

    for key, value in update_data.items():
        setattr(settings, key, value)
    await session.flush()
    await session.refresh(settings)
    return _to_response(settings)


@router.delete("/{id}", status_code=204)
async def delete_settings(id: str, session: AsyncSession = Depends(get_session)):
    """Soft delete settings (sets is_active = False)."""
    deleted = await repo.delete(session, UserSettings, id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Settings not found")
```

2. Register router in `backend/src/main.py`:
```python
from src.api.v1.user_settings import router as user_settings_router
# ... in create_app():
app.include_router(user_settings_router, prefix="/api/v1/user-settings")
```

3. Test manually: `curl http://localhost:8000/api/v1/user-settings?user_id=test`
4. Commit: `feat: add UserSettings API endpoints`

---

## Task 4: Add api-client Endpoints for UserSettings

### Classification: small
### Required Docs
- `packages/api-client/src/endpoints.ts` — existing endpoint pattern
- `packages/api-client/src/schemas.ts` — existing schema pattern

### Task Description
Add frontend API client functions for UserSettings CRUD.

### Steps

1. Add schemas to `packages/api-client/src/schemas.ts`:
```typescript
// UserSettings
export const UserSettingsResponseSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  theme: z.enum(['light', 'dark']),
  language: z.enum(['ru', 'en']),
  column_order_masters: z.array(z.string()),
  column_order_locations: z.array(z.string()),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type UserSettingsResponse = z.infer<typeof UserSettingsResponseSchema>;

export const UserSettingsCreateSchema = z.object({
  user_id: z.string(),
  theme: z.enum(['light', 'dark']).default('light'),
  language: z.enum(['ru', 'en']).default('ru'),
  column_order_masters: z.array(z.string()).default([]),
  column_order_locations: z.array(z.string()).default([]),
});
export type UserSettingsCreate = z.infer<typeof UserSettingsCreateSchema>;

export const UserSettingsUpdateSchema = z.object({
  theme: z.enum(['light', 'dark']).optional(),
  language: z.enum(['ru', 'en']).optional(),
  column_order_masters: z.array(z.string()).optional(),
  column_order_locations: z.array(z.string()).optional(),
});
export type UserSettingsUpdate = z.infer<typeof UserSettingsUpdateSchema>;
```

2. Add endpoints to `packages/api-client/src/endpoints.ts`:
```typescript
import {
  UserSettingsResponseSchema,
  type UserSettingsResponse,
  type UserSettingsCreate,
  type UserSettingsUpdate,
} from './schemas';

// ─── User Settings ───────────────────────────────────────────────────────

export async function getUserSettings(userId: string): Promise<UserSettingsResponse> {
  return api(`/api/v1/user-settings?user_id=${userId}`, UserSettingsResponseSchema);
}

export async function createUserSettings(data: UserSettingsCreate): Promise<UserSettingsResponse> {
  return api('/api/v1/user-settings', UserSettingsResponseSchema, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateUserSettings(
  userId: string,
  data: UserSettingsUpdate,
): Promise<UserSettingsResponse> {
  return api(`/api/v1/user-settings?user_id=${userId}`, UserSettingsResponseSchema, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteUserSettings(id: string): Promise<void> {
  await api(`/api/v1/user-settings/${id}`, z.null(), { method: 'DELETE' });
}
```

3. Rebuild api-client: `cd packages/api-client && npm run build`
4. Commit: `feat: add UserSettings api-client endpoints`

---

## Task 5: Create UserSettingsContext + localStorage Sync

### Classification: standard
### Required Docs
- `frontend/admin/contexts/ScheduleContext.tsx` — existing context pattern
- `frontend/admin/contexts/UIContext.tsx` — existing context pattern

### Task Description
Create UserSettingsContext with localStorage + backend API sync.

### Steps

1. Create `frontend/admin/contexts/UserSettingsContext.tsx`:
```typescript
'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { getUserSettings, createUserSettings, updateUserSettings } from '@memo/api-client';

interface UserSettings {
  theme: 'light' | 'dark';
  language: 'ru' | 'en';
  columnOrderMasters: string[];
  columnOrderLocations: string[];
}

interface UserSettingsContextType {
  settings: UserSettings;
  updateSettings: (partial: Partial<UserSettings>) => void;
  setColumnOrder: (mode: 'masters' | 'locations', order: string[]) => void;
  ready: boolean;
}

const STORAGE_KEY = 'memo-user-settings';

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'light',
  language: 'ru',
  columnOrderMasters: [],
  columnOrderLocations: [],
};

// TODO: Replace with real user ID from auth context
const DEV_USER_ID = 'dev-user-001';

function loadFromStorage(): UserSettings | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveToStorage(settings: UserSettings) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

const UserSettingsContext = createContext<UserSettingsContextType | null>(null);

export function UserSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const mountedRef = useRef(true);

  // Load settings on mount
  useEffect(() => {
    mountedRef.current = true;

    async function load() {
      // 1. Try localStorage first
      const cached = loadFromStorage();
      if (cached && mountedRef.current) {
        setSettings(cached);
        setReady(true);
      }

      // 2. Sync from backend
      try {
        const remote = await getUserSettings(DEV_USER_ID);
        const remoteSettings: UserSettings = {
          theme: remote.theme as 'light' | 'dark',
          language: remote.language as 'ru' | 'en',
          columnOrderMasters: remote.column_order_masters,
          columnOrderLocations: remote.column_order_locations,
        };
        if (mountedRef.current) {
          setSettings(remoteSettings);
          saveToStorage(remoteSettings);
          setReady(true);
        }
      } catch {
        // No remote settings — use cached or defaults
        if (!cached && mountedRef.current) {
          // Create default settings in backend
          try {
            const created = await createUserSettings({
              user_id: DEV_USER_ID,
              ...DEFAULT_SETTINGS,
            });
            const createdSettings: UserSettings = {
              theme: created.theme as 'light' | 'dark',
              language: created.language as 'ru' | 'en',
              columnOrderMasters: created.column_order_masters,
              columnOrderLocations: created.column_order_locations,
            };
            if (mountedRef.current) {
              setSettings(createdSettings);
              saveToStorage(createdSettings);
            }
          } catch {
            // Backend unavailable — use defaults
          }
          if (mountedRef.current) setReady(true);
        }
      }
    }

    load();
    return () => { mountedRef.current = false; };
  }, []);

  const updateSettings = useCallback((partial: Partial<UserSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      saveToStorage(next);
      // Optimistic backend update
      updateUserSettings(DEV_USER_ID, partial).catch(console.error);
      return next;
    });
  }, []);

  const setColumnOrder = useCallback((mode: 'masters' | 'locations', order: string[]) => {
    const key = mode === 'masters' ? 'columnOrderMasters' : 'columnOrderLocations';
    updateSettings({ [key]: order });
  }, [updateSettings]);

  return (
    <UserSettingsContext.Provider value={{ settings, updateSettings, setColumnOrder, ready }}>
      {children}
    </UserSettingsContext.Provider>
  );
}

export function useUserSettings() {
  const ctx = useContext(UserSettingsContext);
  if (!ctx) throw new Error('useUserSettings must be used within UserSettingsProvider');
  return ctx;
}
```

2. Add `UserSettingsProvider` to `frontend/admin/app/layout.tsx` (wrap around children)

3. Create `frontend/admin/hooks/useUserSettings.ts`:
```typescript
export { useUserSettings } from '@/contexts/UserSettingsContext';
```

4. Commit: `feat: add UserSettingsContext with localStorage + API sync`

---

## Task 6: DayView — Filter = Column Visibility

### Classification: standard
### Required Docs
- `frontend/admin/app/components/schedule/DayView.tsx` — current columns memo logic
- `docs/specs/2026-06-13-user-settings-and-column-visibility-design.md` — Section 3

### Task Description
Modify DayView columns memo: filters control which columns are visible.

### Steps

1. Read current DayView.tsx `columns` memo (lines ~185-282)

2. Replace the columns memo logic:
```typescript
// Old: if (showAllColumns) return allMasters; ... filter active + pinned
// New:
const columns = useMemo(() => {
  if (columnMode === 'locations') {
    const allLocations = studios;
    // Empty filter = show all locations
    if (filterLocationIds.length === 0) {
      const order = getColumnOrder('locations');
      return order.length > 0
        ? order.map(id => allLocations.find(l => l.id === id)).filter(Boolean) as typeof allLocations
        : allLocations;
    }
    // Filter selected = only those columns
    return filterLocationIds
      .map(id => allLocations.find(l => l.id === id))
      .filter(Boolean) as typeof allLocations;
  } else {
    const allMasters = masters;
    // Empty filter = show all masters
    if (filterMasterIds.length === 0) {
      const order = getColumnOrder('masters');
      return order.length > 0
        ? order.map(id => allMasters.find(m => m.id === id)).filter(Boolean) as typeof allMasters
        : allMasters;
    }
    // Filter selected = only those columns
    return filterMasterIds
      .map(id => allMasters.find(m => m.id === id))
      .filter(Boolean) as typeof allMasters;
  }
}, [columnMode, studios, masters, filterMasterIds, filterLocationIds, getColumnOrder]);
```

3. Import `useUserSettings` and destructure `getColumnOrder`

4. Remove from columns memo:
   - `showAllColumns` check
   - `pinnedMasterIds` / `pinnedLocationIds` checks
   - `dragSource` column logic (no longer needed — all target columns exist)
   - `showAllColumnsTemp` state

5. Remove imports:
   - `usePinnedColumns` hook
   - Related state variables

6. Commit: `feat: DayView columns visibility controlled by filters`

---

## Task 7: Integrate Column Reorder with UserSettings

### Classification: standard
### Required Docs
- `frontend/admin/hooks/useColumnReorder.ts` — current reorder hook
- `frontend/admin/contexts/UserSettingsContext.tsx` — settings context

### Task Description
Modify useColumnReorder to read/write column order from UserSettings instead of local state.

### Steps

1. Read current `useColumnReorder.ts`

2. Modify to accept `initialOrder` and `onOrderChange`:
```typescript
interface UseColumnReorderOptions {
  columns: ReadonlyArray<{ id: string; name: string; sortOrder?: number }>;
  columnMode: 'masters' | 'locations';
  initialOrder?: string[];  // From UserSettings
  onOrderChange?: (order: string[]) => void;  // Save to UserSettings
}
```

3. Initialize columnOrder from `initialOrder` (if provided) instead of `columns.sortOrder`

4. In `onColumnDrop`, call `onOrderChange` with new order:
```typescript
const onColumnDrop = useCallback((draggedId: string, targetId: string) => {
  // ... existing reorder logic ...
  setColumnOrder((prev) => {
    const newOrder = [...prev];
    // ... reorder logic ...
    onOrderChange?.(newOrder);  // Save to UserSettings
    return newOrder;
  });
}, [columnMode, onOrderChange]);
```

5. In DayView, wire up:
```typescript
const { settings, setColumnOrder: saveColumnOrder } = useUserSettings();
const { getColumnOrder } = useUserSettings();

const {
  modifierHeld,
  orderedColumns,
  onColumnDrop,
} = useColumnReorder({
  columns,
  columnMode,
  initialOrder: columnMode === 'masters' ? settings.columnOrderMasters : settings.columnOrderLocations,
  onOrderChange: (order) => saveColumnOrder(columnMode, order),
});
```

6. Commit: `feat: column reorder persists to UserSettings`

---

## Task 8: Remove Pin Feature

### Classification: small
### Required Docs
- `frontend/admin/hooks/usePinnedColumns.ts` — file to delete
- `frontend/admin/__tests__/usePinnedColumns.test.ts` — file to delete

### Task Description
Remove pin feature from DayView.

### Steps

1. Delete `frontend/admin/hooks/usePinnedColumns.ts`
2. Delete `frontend/admin/__tests__/usePinnedColumns.test.ts`

3. In `DayView.tsx`:
   - Remove `usePinnedColumns` import
   - Remove `pinnedMasterIds`, `pinnedLocationIds`, `togglePinMaster`, `togglePinLocation`, `isMasterPinned`, `isLocationPinned` destructuring
   - Remove pin buttons from column headers (the `<button>` with pin icon)
   - Remove `data-testid={`pin-${col.id}`}` attributes

4. In `DayView.test.tsx`:
   - Remove test cases that test pin functionality
   - Remove `pin-m1`, `pin-m2` selectors

5. Run existing tests to verify no regressions:
   ```bash
   cd frontend/admin && npm run test
   ```

6. Commit: `refactor: remove pin feature from DayView`

---

## Task 9: Remove showAllColumns

### Classification: small
### Required Docs
- `frontend/admin/contexts/ScheduleContext.tsx` — context to clean up

### Task Description
Remove `showAllColumns` state from ScheduleContext and DayView.

### Steps

1. In `ScheduleContext.tsx`:
   - Remove `showAllColumns` state
   - Remove `setShowAllColumns` from context value
   - Remove from `ScheduleContextType` interface

2. In `DayView.tsx`:
   - Remove `showAllColumns` from `useSchedule()` destructuring

3. Run tests to verify:
   ```bash
   cd frontend/admin && npm run test
   ```

4. Commit: `refactor: remove showAllColumns state`

---

## Task 10: E2E Tests for Column Visibility + Reorder Persistence

### Classification: standard
### Required Docs
- `frontend/admin/e2e/schedule-dnd-bugs.spec.ts` — existing E2E pattern
- `vitest-playwright-patterns` skill — testing patterns

### Task Description
Write E2E tests verifying:
1. Filters control column visibility in DayView
2. Column reorder persists across page navigation
3. Pin buttons are gone

### Steps

1. Create `frontend/admin/e2e/schedule-column-visibility.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { waitForScheduleReady } from './fixtures/helpers';

test.describe('DayView Column Visibility', () => {
  test.beforeEach(async ({ page }) => {
    await waitForScheduleReady(page);
    // Switch to DayView
    await page.locator('[data-testid="day-button"]').click();
    await page.waitForTimeout(500);
  });

  test('empty filter shows all columns', async ({ page }) => {
    // No filter selected — all master columns should be visible
    const headers = page.locator('[data-testid^="column-header-m"]');
    const count = await headers.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('selecting filter shows only selected columns', async ({ page }) => {
    // Open master filter dropdown
    await page.locator('[data-testid="master-filter"]').click();
    await page.waitForTimeout(300);

    // Select only m1
    await page.locator('[data-testid="master-filter-option-m1"]').click();
    await page.waitForTimeout(500);

    // Only m1 column should be visible
    const m1Header = page.locator('[data-testid="column-header-m1"]');
    await expect(m1Header).toBeVisible();

    const m2Header = page.locator('[data-testid="column-header-m2"]');
    await expect(m2Header).not.toBeVisible();
  });

  test('pin buttons are removed', async ({ page }) => {
    const pinButtons = page.locator('[data-testid^="pin-"]');
    const count = await pinButtons.count();
    expect(count).toBe(0);
  });
});
```

2. Run tests:
   ```bash
   cd frontend/admin && npx playwright test e2e/schedule-column-visibility.spec.ts --reporter=list
   ```

3. Commit: `test: add E2E tests for column visibility and pin removal`

---

## Task 11: Run Full Test Suite + Regression Check

### Classification: standard

### Task Description
Run all tests to verify no regressions.

### Steps

1. Run backend tests:
   ```bash
   cd backend && pytest
   ```

2. Run frontend unit tests:
   ```bash
   cd frontend/admin && npm run test
   ```

3. Run frontend E2E tests:
   ```bash
   cd frontend/admin && npx playwright test --reporter=list
   ```

4. Fix any failures by dispatching implementer subagent

5. Commit any fixes

---

## Task 12: Final Commit + PR Update

### Classification: trivial

### Task Description
Commit all changes and push to PR #63.

### Steps

1. Review all changes: `git diff --stat HEAD`
2. Stage and commit: `git add -A && git commit -m "feat: user settings + column visibility + pin removal"`
3. Push: `git push origin feat/photo-searchable-select`
4. Update scratchpad
