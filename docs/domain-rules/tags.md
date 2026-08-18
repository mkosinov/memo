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

## List contract (GH #205)

- **Paginated `GET /api/v1/tags`**: `page` (≥1), `per_page` (1-100, default 20), `sort_by` (Literal whitelist: `tag`; 422 on unknown), `sort_order` (asc|desc, default asc). Default order: `tag ASC, id ASC` (spec §4.4). NO `status` param (tags are non-archive, hard-delete only).
- **Bare `GET /api/v1/tags/all`**: bare JSON array (no envelope), NO `status` param, deterministic order = same default. Protective `BARE_LIST_MAX_ROWS = 1000` → 422 English error naming entity + paginated endpoint (spec §4.3).
- **Consumers**: Tags table = server-paginated via `TagsContext`; `getAllTags` ships for #214 combobox (no current lookup consumer) = `/all` (spec §5.5).
- **Search matrix (spec §6)**: table search box = client-side filter over loaded page (until #212 server `?q=`); dictionary form dropdowns = client filter over `/all` (#214 combobox).

## Relationships
- Tag → M2M Service, Master, Location, Photo
