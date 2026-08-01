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
- Tags are hard-deleted (row physically removed). GET-by-id after delete returns 404; the row is absent from lists.

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
| DELETE | /api/v1/tags/{id} | Hard delete |

## Relationships
- Tag → M2M Service, Master, Location, Photo
