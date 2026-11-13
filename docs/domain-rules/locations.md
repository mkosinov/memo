# Location — Domain Rules

## Description
A Location is a physical studio space where master classes take place.

## Fields
| Field | Type | Required | Min | Max | Default | Description |
|-------|------|----------|-----|-----|---------|-------------|
| title | string | ✅ | 1 | 100 | — | Название локации |
| address | string | ❌ | — | — | null | Адрес |
| description | string | ❌ | — | — | null | Описание |
| capacity | integer | ✅ | 0 | 99 | — | Вместимость (сервер валидирует 0–99 → 422 вне диапазона, GH #551 rev.3, 2026-11-13; прежний предел 500 отменён). **0 = «вместимость не задана»** — без операционного эффекта (бронь идёт по занятиям; скрытие/архив — отдельные механизмы) |
| yandex_map_url | string | ❌ | — | — | null | Яндекс.Карты |
| review_url | string | ❌ | — | — | null | Ссылка на отзыв |
| record_info | string | ❌ | — | — | null | Информация для записи |
| image_url | string | ❌ | — | — | null | URL картинки |
| location_hint | string | ❌ | — | — | null | Как найти |
| tag_ids | array | ❌ | — | — | [] | IDs тегов |
| is_public | boolean | ❌ | — | — | true | Видимость в web: `true` = показывается на сайте; `false` = скрыта только с сайта, в админе полностью рабочая (#601) |

## Cross-field Rules
- None.

## Invariants
- Locations can be hard-deleted via `DELETE /{id}` with the dependency-resolution mechanism; archived state via `POST /{id}/archive` (sets `archived: true`) and restored via `POST /{id}/restore`. See `_overview.md` → "Hard-delete FK dependency matrix".
- capacity 0–99 enforced server-side on every mutation (GH #551 rev.3, 2026-11-13); **0 = «вместимость не задана»** — legal, no operational effect, treated as a deliberately set value. Activity capacity carries its own 0–99 rule (0 = «запись закрыта», см. `activities.md`); when an activity copies a location's capacity, the per-path rule applies (GH #551 rev.4): autofill (single-create) and multi-create #595 copy only a value ≥ 1 («missing OR 0 counts as no default» — блок до явного ввода); the grid stamp (WeekView/DayView) legally copies 0 as set, creating a closed activity with a loud toast «… запись закрыта (у зала не задана вместимость)» (US-7, вариант C); copy-week preserves values as-is (explicit duplication).
- `is_public = false` скрывает локацию только с сайта: её нет в публичном словаре, её занятия исключены из публичной витрины серверно, бронь занятия по прямому id → 404 (#601, поверх #600). В админе локация полностью рабочая: сетка, формы, дропдауны. Архив — другое правило: «выведена из работы», скрывает и из админа (по умолчанию). Скрытие с сайта ≠ архив.

## Business Logic

### Backend
- Pure CRUD, no business logic beyond generic service
- No tag_ids in Pydantic schema (missing from backend)

### Frontend
- EntityModal: title required, capacity required min(0) max(99) (GH #551 rev.3: server range 0–99, 0 = «не задана»; the field-config is the single source — «Минимум/Максимум» messages derive from it)

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/public/locations | Анонимный словарь для web: голый массив, без параметров; только неархивированные с `is_public = true`; схема ровно 4 поля (`id, title, address, location_hint`); порядок `sort_order ASC, title ASC, id ASC`; потолок `BARE_LIST_MAX_ROWS` (#601) |
| GET | /api/v1/locations | List records — `?status=active` (default) \| `archived` \| `all` — требует `locations:read` (аноним/клиент → 401, #601) |
| GET | /api/v1/locations/{id} | Get — требует `locations:read` (аноним/клиент → 401, #601) |
| POST | /api/v1/locations | Create |
| PUT | /api/v1/locations/{id} | Full update |
| PATCH | /api/v1/locations/{id} | Partial update |
| DELETE | /api/v1/locations/{id} | Hard delete with resolutions (no body + 0 deps → 204; no body + deps → 409 dry-run; body `{"resolutions": {...}}` → 204 on success / 422 on invalid) — spec GH #207 |
| POST | /api/v1/locations/{id}/archive | Archive (sets `archived: true`, HTTP 200 with body) — GH #207 |
| POST | /api/v1/locations/{id}/restore | Restore (sets `archived: false`, HTTP 200 with body) — GH #207 |

## List contract (GH #205)

- **Paginated `GET /api/v1/locations`**: `page` (≥1), `per_page` (1-100, default 20), `status` (active|archived|all, default active), `sort_by` (Literal whitelist: `title, short_title, capacity, address, location_hint, description, archived, yandex_map_url, created_at`; 422 on unknown), `sort_order` (asc|desc, default asc). Default order: `sort_order ASC, title ASC, id ASC` (spec §4.4).
- **`?id=` narrowing (GH #232, uniform entry form GH #371)**: repeated query keys, UUID-only (garbage → 422), ≤100 distinct after dedup (>100 → 422 `too_long`); typed `id IN (…)` narrowing via `ids_in_predicate`, ANDs conjunctively with `status`/`q` (an archived id under the default active status stays empty); valid-but-unknown → 200 + empty. On the wire unchanged since #232 (the former sibling param); GH #371 moves the contract into the model — one `LocationListParams(SortParams[LocationSortBy], PaginationParams)` as `Annotated[..., Query()]` (no scalar query siblings; `id` inherited from `PaginationParams` — same UUID-only/dedup/≤100 contract).
- **Bare `GET /api/v1/locations/all`**: bare JSON array (no envelope), `status` parity with paginated, deterministic order = same default. Protective `BARE_LIST_MAX_ROWS = 1000` → 422 English error naming entity + paginated endpoint (spec §4.3).
- **Consumers**: Locations table = server-paginated via `LocationsContext`; dropdowns/lookup maps (Records/Schedule/useLocations/useRecordData) = `/all` (spec §5.5); web (client site `useLocations`/`useSchedule`) = `/api/v1/public/locations` только (#601 — bare list/get закрыты `locations:read`).
- **Search matrix (spec §6)**: **list `?q=` (GH #212) is the delivered contract** — substring on `Location.title` + `Location.short_title` + `Location.address` + `Location.description` (each field ilike'd separately), plus exact `Location.id` equality when `q` parses as a full 36-char UUID. The three URL fields (`yandex_map_url`, `review_url`, `image_url`) are **EXACT full-string equality only** — a pasted full Yandex-map / review / image URL finds the row, partial URLs NEVER match (no ilike on URL columns). `q: str | None` declared on the list params model with `min_length=2` / `max_length=100` via Pydantic `Field` → out-of-range → **422 VALIDATION_ERROR**. The `q` predicate lands BEFORE the COUNT (inherited from `BaseRepository.list`), so `total` always reflects the q-filtered set. The per-entity search-fields matrix lives in `LocationService.search_fields` (`src/services/location.py`). Dictionary form dropdowns still consume `/all` directly via `getAllLocations` (#214 combobox; client filter over the bare array).

## Relationships
- Location → has many Activities
- Location → has many Tags (M2M via location_tags)

## Response field: `archived` (inverted)
The Response schema exposes `archived: bool` instead of `is_active` (inversion: `archived = true` = in archive = `is_active = false`). The DB column stays `is_active`; `LocationService` applies the inversion. See `_overview.md` → "Archive terminology boundary".

## Acceptance Criteria
- [ ] Title required, 1-100 chars
- [ ] Capacity required, 0-99 (0 = «не задана»; server 422 outside, GH #551 rev.3)

## Parity Notes
| Backend (Pydantic) | Frontend (Zod) | Match |
|--------------------|----------------|-------|
| title: str (no constraints) | title: min(1).max(200) | ❌ Backend missing |
| capacity: ge=0 le=99 (422; 0 = «не задана») | capacity: min(0).max(99) (write-схема; response — без границ) | ✅ (GH #551 rev.3 — сервер добавил 422-валидацию, Zod write-схема синхронизирована в том же IMPL) |
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
