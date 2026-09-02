# Photo — Domain Rules

## Description
A Photo is an image file (filename only — file storage is external) owned by at most ONE of Client | Service | Activity | Location (GH #211 4-owner model). Owner-less photos are allowed. Photos may be public (shown in galleries) and tagged for filtering.

## Fields
| Field | Type | Required | Min | Max | Default | Description |
|-------|------|----------|-----|-----|---------|-------------|
| filename | string | ✅ | — | — | — | File path / key in storage |
| client_id | string | ❌ | — | — | null | FK to Client (owner slot) |
| service_id | string | ❌ | — | — | null | FK to Service (owner slot) |
| activity_id | string | ❌ | — | — | null | FK to Activity (owner slot) |
| location_id | string | ❌ | — | — | null | FK to Location (owner slot; standalone location gallery) |
| is_public | boolean | ❌ | — | — | false | Visible in public gallery |
| tag_ids | array | ❌ | — | — | [] | IDs тегов (M2M) |

Response-only field: `client_name` (nullable, denormalized on GET /api/v1/photos list via scalar subquery; resolves for archived clients). `visitor_id` was dropped (GH #211).

## Cross-field Rules
- At most ONE of `client_id | service_id | activity_id | location_id` may be non-null:
  - POST/PUT: payload validator → 422 on ≥2 owner FKs in one payload (English detail).
  - PUT/PATCH: service-level MERGED-set check (stored row + applied payload) → 422 on ≥2 owners at rest (closes the `exclude_unset` hole).
  - DB-level CHECK constraint `ck_photos_single_owner` as defense-in-depth for writes bypassing the API.

## Invariants
- Photos are hard-deleted (row physically removed). Photo is a general resource — on owner deletion (Client/Service/Activity/Location), the photo's owner FK is set to NULL (photo survives, becomes owner-less); the photo is never deleted by cascade.
- Group photos = N independent rows with distinct `client_id` (same filename); copies are created individually via the single-owner modal; no grouping/sync mechanism exists (#224 closed as not-planned).
- Zero owners at rest is legal (parent deletion or direct creation with no owner).

## Business Logic

### Backend
- **tag_ids:** PUT and PATCH both hard-replace tag links (DELETE all → INSERT new)
  - If tag_ids omitted from PATCH payload → existing tags preserved
- **GET /api/v1/photos list:** server pagination + filters (GH #211):
  - `q` — case-insensitive substring on filename ONLY (min 2 / max 100 chars; does NOT match client names)
  - `client_id` / `activity_id` — direct equality
  - `location_id` — DIRECT equality only (activity-owned photos at that location do NOT match)
  - `service_id` — variant A: direct `service_id` OR via `activity.service_id` (LEFT OUTER JOIN)
  - `tag_id` — repeatable (`?tag_id=a&tag_id=b`), AND semantics (photo must have ALL selected tags); duplicates deduped
  - All filters AND-combine with each other and with q; unknown filter ids → silent empty page (NOT 404)
  - `sort_by` whitelist: `filename | is_public | created_at` (422 on unknown); default `created_at desc` + `id asc` tiebreak
  - Pagination mechanics: repo-owned — photos rides the shared row-core (`BaseRepository.list_custom`, `backend/src/repositories/generic.py`), the former service-owned count+slice exception is retired (GH #213). The service builds the stmt (multi-column select with the labeled `client_name` + `selectinload(Photo.tags)` + filter predicates) and maps Row→`PhotoResponse`; the core computes COUNT on the UNordered stmt and applies ORDER + LIMIT/OFFSET, with ordering passed via its `order_by=` parameter (the `RecordService.list` convention).
- File storage is external (S3-compatible); this entity stores metadata only

### Frontend
- PhotoGallery public/private toggle
- Bulk upload with tag picker
- Owner slots are mutually exclusive in the UI: picking `activity_id` clears `service_id` and vice versa (no auto-fill)
- Service/location titles resolve client-side via `/all` maps; `client_name` is the only denormalized response field
- Activity display labels use the canonical `formatActivityLabel` convention — see `activities.md` → "Display label convention". #213 (display-lookup composite) will centralize activity display data further — the canonical label is cross-pinned there.

## API Endpoints
| Method | Path | Params | Description |
|--------|------|--------|-------------|
| GET | /api/v1/photos/web | — | List public photos (gallery; bare array, unpaginated) |
| GET | /api/v1/photos | `page`, `per_page`, `q` (filename substring, 2–100 chars), `client_id`, `location_id` (direct-only), `activity_id`, `service_id` (variant A: direct OR via activity), `tag_id` (repeatable, AND), `sort_by` (`filename` \| `is_public` \| `created_at`), `sort_order` | Paginated list (`PaginatedResponse[PhotoResponse]` envelope with honest total) |
| GET | /api/v1/photos/{id} | — | Get |
| POST | /api/v1/photos | — | Create |
| PUT | /api/v1/photos/{id} | — | Full update (filename + is_public required) |
| PATCH | /api/v1/photos/{id} | — | Partial update (tag_ids hard-replace when sent) |
| DELETE | /api/v1/photos/{id} | — | Hard delete |

## Relationships
- Photo → belongs to (Client | Service | Activity | Location) — at most one of the four
- Photo → has many Tags (M2M)
