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
- Materials are archived (is_active = false), never hard-deleted

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
| DELETE | /api/v1/materials/{id} | Soft delete |

## Relationships
- Service → has many Materials (via service_materials join)

## Archive semantics on write

Material is a soft-delete entity. See `docs/domain-rules/_overview.md` → "is_active semantics on get/update/patch" for the general rule. **Entity note:** PUT requires explicit `is_active` (GH #178); PATCH sticky inherited from `SoftDeleteService` (no override).
