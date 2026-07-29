# Tag — Domain Rules

## Description
A Tag is a free-form label attached to entities (Services, Photos, Masters, Locations) for categorization and filtering.

## Fields
| Field | Type | Required | Min | Max | Default | Description |
|-------|------|----------|-----|-----|---------|-------------|
| tag | string | ✅ | — | — | — | Текст тега |

## Cross-field Rules
- None.

## Invariants
- Tags are soft-deleted (is_active flag, SoftDeleteRepository). GET-by-id returns the soft-deleted row (200); the list excludes it. Note: TagResponse does not expose is_active.

## Business Logic

### Backend
- Pure CRUD, no business logic beyond generic service

### Frontend
- TagPicker component for multi-select across entities

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/tags | List all |
| GET | /api/v1/tags/{id} | Get |
| POST | /api/v1/tags | Create |
| PUT | /api/v1/tags/{id} | Full update |
| PATCH | /api/v1/tags/{id} | Partial update |
| DELETE | /api/v1/tags/{id} | Soft delete |

## Relationships
- Tag → M2M Service, Master, Location, Photo
