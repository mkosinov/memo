# UserSettings — Domain Rules

## Description
UserSettings stores per-user UI preferences: theme, language, and column ordering for schedule views (masters, locations). One record per user.

## Fields
| Field | Type | Required | Min | Max | Default | Description |
|-------|------|----------|-----|-----|---------|-------------|
| user_id | string | ✅ | — | — | — | FK to user (unique) |
| theme | string | ❌ | — | — | "light" | UI theme |
| language | string | ❌ | — | — | "ru" | UI language |
| column_order_masters | array | ❌ | — | — | [] | Порядок столбцов мастеров |
| column_order_locations | array | ❌ | — | — | [] | Порядок столбцов локаций |

## Cross-field Rules
- None.

## Invariants
- One UserSettings record per user_id (uniqueness enforced at service level)
- Records are hard-deleted (row physically removed)

## Business Logic

### Backend
- **Identified by user_id, not by primary key**, for all non-DELETE operations
- **Own-only (GH #247 spec §3.8, breaking):** all endpoints require a session; GET/PUT/PATCH take **no** `user_id` query param — the session user is the only addressable user (a stale `?user_id=` from an old client is ignored). POST takes `user_id` in the body (create schema). DELETE by `/{settings_id}` resolves the row's `user_id` and rejects non-owned rows with 403 `AUTH_FORBIDDEN`

### Frontend
- SettingsPanel reads on mount, writes on change
- Column drag-and-drop updates `column_order_*` arrays

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/user-settings | Get the session user's settings (own-only) |
| POST | /api/v1/user-settings | Create (body takes user_id) |
| PUT | /api/v1/user-settings | Partial update (session user's row, own-only) |
| PATCH | /api/v1/user-settings | Partial update (session user's row, own-only) |
| DELETE | /api/v1/user-settings/{settings_id} | Hard delete by primary key (own row only, else 403) |

## Relationships
- UserSettings → belongs to User (logical, not enforced FK)
