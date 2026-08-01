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
- GET / PUT / PATCH / DELETE-by-id all take `?user_id=` query param (except DELETE which uses {settings_id})

### Frontend
- SettingsPanel reads on mount, writes on change
- Column drag-and-drop updates `column_order_*` arrays

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/user-settings?user_id={id} | Get by user_id |
| POST | /api/v1/user-settings | Create |
| PUT | /api/v1/user-settings?user_id={id} | Partial update (by user_id) |
| PATCH | /api/v1/user-settings?user_id={id} | Partial update (by user_id) |
| DELETE | /api/v1/user-settings/{settings_id} | Hard delete by primary key |

## Relationships
- UserSettings → belongs to User (logical, not enforced FK)
