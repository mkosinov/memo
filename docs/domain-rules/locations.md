# Location — Domain Rules

## Description
A Location is a physical studio space where master classes take place.

## Fields
| Field | Type | Required | Min | Max | Default | Description |
|-------|------|----------|-----|-----|---------|-------------|
| name | string | ✅ | 1 | 100 | — | Название локации |
| address | string | ❌ | — | — | null | Адрес |
| description | string | ❌ | — | — | null | Описание |
| capacity | integer | ✅ | 1 | 500 | — | Вместимость |
| yandex_map_url | string | ❌ | — | — | null | Яндекс.Карты |
| review_url | string | ❌ | — | — | null | Ссылка на отзыв |
| record_info | string | ❌ | — | — | null | Информация для записи |
| image_url | string | ❌ | — | — | null | URL картинки |
| location_hint | string | ❌ | — | — | null | Как найти |
| tag_ids | array | ❌ | — | — | [] | IDs тегов |

## Cross-field Rules
- None.

## Invariants
- Locations can be hard-deleted via `DELETE /{id}` with the dependency-resolution mechanism; archived state via `POST /{id}/archive` (sets `archived: true`) and restored via `POST /{id}/restore`. See `_overview.md` → "Hard-delete FK dependency matrix".
- capacity is informational — not enforced at Activity level

## Business Logic

### Backend
- Pure CRUD, no business logic beyond generic service
- No tag_ids in Pydantic schema (missing from backend)

### Frontend
- EntityModal: name required, capacity required min(1) max(500)

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/locations | List records — `?status=active` (default) \| `archived` \| `all` |
| GET | /api/v1/locations/{id} | Get |
| POST | /api/v1/locations | Create |
| PUT | /api/v1/locations/{id} | Full update |
| PATCH | /api/v1/locations/{id} | Partial update |
| DELETE | /api/v1/locations/{id} | Hard delete with resolutions (no body + 0 deps → 204; no body + deps → 409 dry-run; body `{"resolutions": {...}}` → 204 on success / 422 on invalid) — spec GH #207 |
| POST | /api/v1/locations/{id}/archive | Archive (sets `archived: true`, HTTP 200 with body) — GH #207 |
| POST | /api/v1/locations/{id}/restore | Restore (sets `archived: false`, HTTP 200 with body) — GH #207 |

## List contract (GH #205)

- **Paginated `GET /api/v1/locations`**: `page` (≥1), `per_page` (1-100, default 20), `status` (active|archived|all, default active), `sort_by` (Literal whitelist: `name, short_title, capacity, address, location_hint, description, archived, yandex_map_url, created_at`; 422 on unknown), `sort_order` (asc|desc, default asc). Default order: `sort_order ASC, name ASC, id ASC` (spec §4.4).
- **Bare `GET /api/v1/locations/all`**: bare JSON array (no envelope), `status` parity with paginated, deterministic order = same default. Protective `BARE_LIST_MAX_ROWS = 1000` → 422 English error naming entity + paginated endpoint (spec §4.3).
- **Consumers**: Locations table = server-paginated via `LocationsContext`; dropdowns/lookup maps (Records/Schedule/useLocations/useRecordData) = `/all` (spec §5.5).
- **Search matrix (spec §6)**: **list `?q=` (GH #212) is the delivered contract** — substring on `Location.name` + `Location.short_title` + `Location.address` + `Location.description` (each field ilike'd separately), plus exact `Location.id` equality when `q` parses as a full 36-char UUID. The three URL fields (`yandex_map_url`, `review_url`, `image_url`) are **EXACT full-string equality only** — a pasted full Yandex-map / review / image URL finds the row, partial URLs NEVER match (no ilike on URL columns). `q: str | None` declared on the list params model with `min_length=2` / `max_length=100` via Pydantic `Field` → out-of-range → **422 VALIDATION_ERROR**. The `q` predicate lands BEFORE the COUNT (inherited from `BaseRepository.list`), so `total` always reflects the q-filtered set. The per-entity search-fields matrix lives in `LocationService.search_fields` (`src/services/location.py`). Dictionary form dropdowns still consume `/all` directly via `getAllLocations` (#214 combobox; client filter over the bare array).

## Relationships
- Location → has many Activities
- Location → has many Tags (M2M via location_tags)

## Response field: `archived` (inverted)
The Response schema exposes `archived: bool` instead of `is_active` (inversion: `archived = true` = in archive = `is_active = false`). The DB column stays `is_active`; `LocationService` applies the inversion. See `_overview.md` → "Archive terminology boundary".

## Acceptance Criteria
- [ ] Name required, 1-100 chars
- [ ] Capacity required, 1-500

## Parity Notes
| Backend (Pydantic) | Frontend (Zod) | Match |
|--------------------|----------------|-------|
| name: str (no constraints) | name: min(1).max(200) | ❌ Backend missing |
| capacity: int (no constraints) | capacity: min(1).max(500) | ❌ Backend missing |
| tag_ids: missing | tag_ids: present | ❌ Backend missing |

## Archive & delete semantics (GH #207)

Location is one of the 5 archive-aware entities. PUT/PATCH no longer accept `is_active` (auto-closes #178); archive/restore only via `POST /archive` + `POST /restore`. Archive/restore is a single-row `is_active` flip — **no cross-entity write** (no Master→users-style login-account link).

### Location FK dependencies (DELETE `/{id}`)

| Relation | Nullable? | Action | User choice? |
|---|---|---|---|
| **activities** (location_id) | NOT NULL | **block** | N/A — `allowed_actions: []`. Activity has no `is_active`, cannot be archived; user must remove activities manually OR archive the location. |
| **location_tags** (join) | NOT NULL PK | **cascade** (auto) | auto — join table rows deleted automatically. |
| **photos** (location_id) | nullable | **nullify** (auto) | auto — photo survives, becomes owner-less (GH #211). |

- **DELETE `/{id}` (no body):** zero deps → 204 hard delete (row gone). Any dep → 409 + dependency tree. `activities` present → 409 with `allowed_actions: []` (blocks DELETE; only archive is offered).
- **DELETE `/{id}` (with body):** Location has no non-auto deps (`location_tags` and `photos` are auto) → the resolutions body is `{}`. Server resolves `location_tags` (auto-cascade) and `photos` (auto-nullify — GH #211) automatically, then hard-deletes the location row. Blocked (`activities` present) → 422 always.
