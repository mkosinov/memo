# Material — Domain Rules

## Description
A Material is a physical supply or tool used in master classes (e.g., paint, clay, canvas). Materials are simple catalog entries referenced by Services.

## Fields
| Field | Type | Required | Min | Max | Default | Description |
|-------|------|----------|-----|-----|---------|-------------|
| title | string | ✅ | — | — | — | Название материала |
| description | string | ✅ | — | — | — | Описание |

## Cross-field Rules
- None.

## Invariants
- Materials can be hard-deleted via `DELETE /{id}` unconditionally (Material has **zero** FK dependencies — `DELETE /materials/{id}` always returns 204).
- Archived state via `POST /{id}/archive` (sets `archived: true`) and restored via `POST /{id}/restore` (sets `archived: false`). See `_overview.md` → "Hard-delete FK dependency matrix".

## Business Logic

### Backend
- Pure CRUD, no business logic beyond generic service

### Frontend
- EntityModal: title + description (both required)

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/materials | List records — `?status=active` (default) \| `archived` \| `all` |
| GET | /api/v1/materials/{id} | Get |
| POST | /api/v1/materials | Create |
| PUT | /api/v1/materials/{id} | Full update |
| PATCH | /api/v1/materials/{id} | Partial update |
| DELETE | /api/v1/materials/{id} | Hard delete — **always 204** (Material has zero FK dependencies; no body, no dry-run needed) — spec GH #207 |
| POST | /api/v1/materials/{id}/archive | Archive (sets `archived: true`, HTTP 200 with body) — GH #207 |
| POST | /api/v1/materials/{id}/restore | Restore (sets `archived: false`, HTTP 200 with body) — GH #207 |

## Relationships
- Service → has many Materials (via service_materials join)

## Response field: `archived` (inverted)
The Response schema exposes `archived: bool` instead of `is_active` (inversion: `archived = true` = in archive = `is_active = false`). The DB column stays `is_active`; `MaterialService` applies the inversion. See `_overview.md` → "Archive terminology boundary".

## Archive & delete semantics (GH #207)

Material is one of the 5 archive-aware entities. PUT/PATCH no longer accept `is_active` (auto-closes #178); archive/restore only via `POST /archive` + `POST /restore`. Archive/restore is a single-row `is_active` flip — **no cross-entity write**.

### Material FK dependencies (DELETE `/{id}`)

**None.** Material has zero DB dependencies — `DELETE /materials/{id}` (no body) **always returns 204** hard delete. No 409, no resolutions body, no dry-run. The simplest case in the matrix. (Spec §11.2: Material has no FK dependencies.)
