# Tag — Domain Rules

## Description
A Tag is a free-form label attached to entities (Services, Activities, Masters, Locations, Clients, Visitors, Records, Photos) for categorization and filtering.

## Fields
| Field | Type | Required | Min | Max | Default | Description |
|-------|------|----------|-----|-----|---------|-------------|
| title | string | ✅ | — | — | — | Текст тега |

## Cross-field Rules
- None.

## Invariants
- Tags are hard-deleted (row physically removed; no archive — deliberately, #189). GET-by-id after delete returns 404; the row is absent from lists.
- Deleting a tag unlinks it from every attached entity (join rows die, parent rows survive) — the unlinking is user-visible and confirmed (see Delete contract).

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
| DELETE | /api/v1/tags/{id} | Hard delete — deferred, contract below (GH #318) |

## Delete contract (GH #318, records-flavor)

- **Preview:** `DELETE /api/v1/tags/{id}?dry_run=true` — never modifies rows: busy tag → 409 `has_dependencies` with the tree (8 groups: counters + `items` one-liners `{id, label}`; labels are parent-entity names/dates, NO contact fields — phones excluded); clean tag → 204; unknown id → 404.
- **Bare DELETE (no flag, no body) → 422 `expected_state_required`** — the silent unlink-everywhere path is gone.
- **Real deletion carries the body `{resolutions?, expected}`** and runs on the deferred pipeline (5-second undo ring, shared PendingActions): clean commit = `{expected: {}}`; busy commit (after the dialog confirms per-entity one-liners) = `{resolutions: {<entity>: "cascade", ...}, expected: {<entity>: [ids], ...}}`.
- **Subset verification:** a link that appeared after confirmation (absent from `expected`) → 409 `stale_dependencies` + current tree → honest error «данные изменились» + «Обновить»; a link that disappeared does not block. All 8 deps are visible (non-auto) — no exclusions.
- Family context: the whole non-archive family shares this mechanism (dry_run param + mandatory `expected` + ring); see `_overview.md` (deferred-delete contract + FK matrix Tag rows + the perspective-auto rule).

## List contract (GH #205)

- **Paginated `GET /api/v1/tags`**: `page` (≥1), `per_page` (1-100, default 20), `sort_by` (Literal whitelist: `title`; 422 on unknown), `sort_order` (asc|desc, default asc). Default order: `title ASC, id ASC` (spec §4.4). NO `status` param (tags are non-archive, hard-delete only).
- **Bare `GET /api/v1/tags/all`**: bare JSON array (no envelope), NO `status` param, deterministic order = same default. Protective `BARE_LIST_MAX_ROWS = 1000` → 422 English error naming entity + paginated endpoint (spec §4.3).
- **Consumers**: Tags table = server-paginated via `TagsContext`; `getAllTags` ships for #214 combobox (no current lookup consumer) = `/all` (spec §5.5).
- **Search matrix (spec §6)**: **list `?q=` (GH #212) is the delivered contract** — substring on `Tag.title`, plus exact `Tag.id` equality when `q` parses as a full 36-char UUID. `q: str | None` declared on the list params model with `min_length=2` / `max_length=100` via Pydantic `Field` → out-of-range → **422 VALIDATION_ERROR**. The `q` predicate lands BEFORE the COUNT (inherited from `BaseRepository.list`), so `total` always reflects the q-filtered set. The per-entity search-fields matrix lives in `TagService.search_fields` (`src/services/tag.py`). Dictionary form dropdowns still consume `/all` directly via `getAllTags` (#214 combobox; client filter over the bare array).

## Relationships
- Tag → M2M Service, Activity, Master, Location, Client, Visitor, Record, Photo (8 join tables; `master_tags` hangs off `masters.staff_id` — GH #266 D9)
