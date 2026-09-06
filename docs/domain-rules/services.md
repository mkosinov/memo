# Service — Domain Rules

## Description
A Service represents a type of master class (painting, sculpture, etc.). It defines duration, capacity, age requirements, and contains Tariffs for pricing.

## Fields
| Field | Type | Required | Min | Max | Default | Description |
|-------|------|----------|-----|-----|---------|-------------|
| title | string | ✅ | 1 | 200 | — | Название услуги |
| description | string | ✅ | — | — | — | Описание |
| image_url | string | ✅ | — | — | — | URL картинки |
| specialty | string | ✅ | — | — | — | Специализация |
| min_age | integer | ✅ | 0 | 18 | — | Минимальный возраст |
| max_age | integer | ✅ | 0 | 18 | — | Максимальный возраст |
| duration | integer | ✅ | 15 | 480 | — | Длительность в минутах |
| record_info | string | ✅ | — | — | — | Информация для записи |
| material_hint | string | ❌ | — | — | null | Что взять с собой |
| tariffs | array | ❌ | — | — | [] | Тарифы (nested) |
| tag_ids | array | ❌ | — | — | [] | IDs тегов |

## Tariff (nested)
| Field | Type | Required | Min | Description |
|-------|------|----------|-----|-------------|
| title | string | ✅ | 1 | Название тарифа |
| description | string | ❌ | — | Описание |
| price | integer | ✅ | 0 | Цена в рублях |

## Cross-field Rules
- `min_age` must be <= `max_age` (enforced in frontend only)

## Invariants
- Services can be hard-deleted via `DELETE /{id}` with the dependency-resolution mechanism; archived state via `POST /{id}/archive` (sets `archived: true`) and restored via `POST /{id}/restore`. See `_overview.md` → "Hard-delete FK dependency matrix".
- Tariffs are hard-deleted and recreated on every Service update

## Business Logic

### Backend
- **Tariffs:** Managed atomically with Service. On PUT: DELETE all existing → CREATE new.
- **Tags:** Same pattern — DELETE all links → INSERT new.
- **No age validation** that min_age <= max_age at code level.

### Frontend
- **Auto-fill:** When Service selected in Activity → fills duration, capacity, minAge
- **Domain `Service` (frontend, `@memo/domain`):** carries `tariffs: Tariff[]` (`id`/`title`/`price`/`description`) populated by `transformService` in `frontend/admin/lib/transformers.ts`; `durationMinutes` is the canonical duration field — no decimal-hours twin (GH #142).
- **Tariff display:** Read-only list below service select (title + price ₽)
- **EntityModal validation:** title required, duration required min(15) max(480), min_age/max_age min(0) max(18), cross-field min_age <= max_age

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/services | List records — `?status=active` (default) \| `archived` \| `all` |
| GET | /api/v1/services/{id} | Get with tariffs |
| POST | /api/v1/services | Create with tariffs |
| PUT | /api/v1/services/{id} | Full update (tariffs replaced) |
| PATCH | /api/v1/services/{id} | Partial update (tag_ids hard-replace when sent) |
| DELETE | /api/v1/services/{id} | Hard delete with resolutions (no body + 0 deps → 204; no body + deps → 409 dry-run; body `{"resolutions": {...}}` → 204 on success / 422 on invalid) — spec GH #207 |
| POST | /api/v1/services/{id}/archive | Archive (sets `archived: true`, HTTP 200 with body) — GH #207 |
| POST | /api/v1/services/{id}/restore | Restore (sets `archived: false`, HTTP 200 with body) — GH #207 |

## List contract (GH #205)

- **Paginated `GET /api/v1/services`**: `page` (≥1), `per_page` (1-100, default 20), `status` (active|archived|all, default active), `sort_by` (Literal whitelist: `title, duration, age, material_hint, tariffs, specialty, archived, created_at`; 422 on unknown), `sort_order` (asc|desc, default asc). Default order: `title ASC, id ASC` (spec §4.4). Column mapping: `age`→`min_age`, `tariffs`→count subquery.
- **Bare `GET /api/v1/services/all`**: bare JSON array (no envelope), `status` parity with paginated, deterministic order = same default. Protective `BARE_LIST_MAX_ROWS = 1000` → 422 English error naming entity + paginated endpoint (spec §4.3).
- **Consumers**: Services table = server-paginated via `ServicesContext`; dropdowns/lookup maps (Records/Schedule/useServices/useRecordData) = `/all` (spec §5.5).
- **Search matrix (spec §6)**: **list `?q=` (GH #212) is the delivered contract** — substring on `Service.title` + `Service.description` (each field ilike'd separately), plus exact `Service.id` equality when `q` parses as a full 36-char UUID. `q: str | None` declared on the list params model with `min_length=2` / `max_length=100` via Pydantic `Field` → out-of-range → **422 VALIDATION_ERROR**. The `q` predicate lands BEFORE the COUNT (inherited from `BaseRepository.list`), so `total` always reflects the q-filtered set. The per-entity search-fields matrix lives in `ServiceService.search_fields` (`src/services/service.py`). Dictionary form dropdowns still consume `/all` directly via `getAllServices` (#214 combobox; client filter over the bare array).

## Relationships
- Service → has many Tariffs (cascade delete-orphan)
- Service → has many Tags (M2M)
- Activity → belongs to Service

## Response field: `archived` (inverted)
The Response schema exposes `archived: bool` instead of `is_active` (inversion: `archived = true` = in archive = `is_active = false`). The DB column stays `is_active`; `ServiceService` applies the inversion. See `_overview.md` → "Archive terminology boundary".

## Acceptance Criteria
- [ ] Title required, 1-200 chars
- [ ] Duration required, 15-480 minutes
- [ ] min_age <= max_age validation (frontend)
- [ ] Tariffs managed atomically on update

## Parity Notes
| Backend (Pydantic) | Frontend (Zod) | Match |
|--------------------|----------------|-------|
| title: str (no constraints) | title: min(1).max(200) | ❌ Backend missing |
| duration: int (no constraints) | duration: min(15).max(480) | ❌ Backend missing |
| min_age: int (no constraints) | min_age: min(0).max(18) | ❌ Backend missing |
| max_age: int (no constraints) | max_age: min(0).max(18) | ❌ Backend missing |
| tariff.price: int (no constraints) | price: min(0) | ❌ Backend missing |
| description: required | description: optional | ⚠️ |
| image_url: required | image_url: optional | ⚠️ |

## Archive & delete semantics (GH #207)

Service is one of the 5 archive-aware entities. PUT/PATCH no longer accept `is_active` (auto-closes #178); archive/restore only via `POST /archive` + `POST /restore`. Archive/restore is a single-row `is_active` flip — **no cross-entity write**. `ServiceService` overrides `update`/`patch` (tag_ids/tariffs handling); `delete()` inherits hard from `ArchiveService`.

### Service FK dependencies (DELETE `/{id}`)

| Relation | Nullable? | Action | User choice? |
|---|---|---|---|
| **activities** (service_id) | NOT NULL | **block** | N/A — `allowed_actions: []`. Activity has no `is_active`, cannot be archived; user must remove activities manually OR archive the service. |
| **tariffs** (service_id) | NOT NULL | **cascade** (auto) | auto — config of the service, unambiguous; tariff rows deleted automatically. |
| **photos** (service_id) | nullable | **nullify** (auto) | auto — photo becomes unlinked (survives); Photo is a general resource (per #194 SET NULL policy). |
| **service_tags** (join) | NOT NULL PK | **cascade** (auto) | auto — join table rows deleted automatically. |

- **DELETE `/{id}` (no body):** zero deps → 204 hard delete (row gone). Any dep → 409 + dependency tree. `activities` present → 409 with `allowed_actions: []` (blocks DELETE; only archive is offered).
- **DELETE `/{id}` (with body):** Service has no non-auto deps (`tariffs`, `photos`, `service_tags` are all auto) → the resolutions body is `{}`. Server resolves the auto deps automatically (nullify photos, cascade tariffs + service_tags, then hard-delete the service row) in ONE transaction → 204. Blocked (`activities` present) → 422 always.
