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
- **Search matrix (spec §6)**: **list `?q=` (GH #212) is the delivered contract** — substring on `Tag.tag`, plus exact `Tag.id` equality when `q` parses as a full 36-char UUID. `q: str | None` declared on the list params model with `min_length=2` / `max_length=100` via Pydantic `Field` → out-of-range → **422 VALIDATION_ERROR**. The `q` predicate lands BEFORE the COUNT (inherited from `BaseRepository.list`), so `total` always reflects the q-filtered set. The per-entity search-fields matrix lives in `TagService.search_fields` (`src/services/tag.py`). Dictionary form dropdowns still consume `/all` directly via `getAllTags` (#214 combobox; client filter over the bare array).

## Relationships
- Tag → M2M Service, Master, Location, Photo
