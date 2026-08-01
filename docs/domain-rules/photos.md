# Photo — Domain Rules

## Description
A Photo is an image file (filename only — file storage is external) attached to a Visitor, Service, or Activity. Photos may be public (shown in galleries) and tagged for filtering.

## Fields
| Field | Type | Required | Min | Max | Default | Description |
|-------|------|----------|-----|-----|---------|-------------|
| filename | string | ✅ | — | — | — | File path / key in storage |
| visitor_id | string | ❌ | — | — | null | FK to Visitor |
| service_id | string | ❌ | — | — | null | FK to Service |
| activity_id | string | ❌ | — | — | null | FK to Activity |
| is_public | boolean | ❌ | — | — | false | Visible in public gallery |
| tag_ids | array | ❌ | — | — | [] | IDs тегов (M2M) |

## Cross-field Rules
- None.

## Invariants
- Photos are hard-deleted (row physically removed). Photo is a general resource — on Visitor or Activity deletion, `photos.visitor_id` / `photos.activity_id` is set to NULL (photo survives); the photo is never deleted by cascade.

## Business Logic

### Backend
- **tag_ids:** PUT and PATCH both hard-replace tag links (DELETE all → INSERT new)
  - If tag_ids omitted from PATCH payload → existing tags preserved
- File storage is external (S3-compatible); this entity stores metadata only

### Frontend
- PhotoGallery public/private toggle
- Bulk upload with tag picker

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/photos/web | List public photos (gallery) |
| GET | /api/v1/photos | List all |
| GET | /api/v1/photos/{id} | Get |
| POST | /api/v1/photos | Create |
| PUT | /api/v1/photos/{id} | Full update |
| PATCH | /api/v1/photos/{id} | Partial update (tag_ids hard-replace when sent) |
| DELETE | /api/v1/photos/{id} | Hard delete |

## Relationships
- Photo → belongs to (Visitor | Service | Activity) — exactly one of the three
- Photo → has many Tags (M2M)
