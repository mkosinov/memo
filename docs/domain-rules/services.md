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
- Services are archived (is_active = false), never hard-deleted
- Tariffs are hard-deleted and recreated on every Service update

## Business Logic

### Backend
- **Tariffs:** Managed atomically with Service. On PUT: DELETE all existing → CREATE new.
- **Tags:** Same pattern — DELETE all links → INSERT new.
- **No age validation** that min_age <= max_age at code level.

### Frontend
- **Auto-fill:** When Service selected in Activity → fills duration, capacity, minAge
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
| DELETE | /api/v1/services/{id} | Soft delete (tariffs hard-deleted via cascade) |

## Relationships
- Service → has many Tariffs (cascade delete-orphan)
- Service → has many Tags (M2M)
- Activity → belongs to Service

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

## Archive semantics on write

Service is a soft-delete entity. See `docs/domain-rules/_overview.md` → "is_active semantics on get/update/patch" for the general rule. **Entity note:** `ServiceService` overrides `update`/`patch` (for `tag_ids`/`tariffs` handling) and reimplements the `is_active` sticky-field strip via the shared `_strip_is_active_none` helper (`services/generic.py:25`) — not directly inherited from `SoftDeleteService`.
