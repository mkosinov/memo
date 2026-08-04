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
- Locations are archived (is_active = false), never hard-deleted
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
| DELETE | /api/v1/locations/{id} | Soft delete |

## Relationships
- Location → has many Activities
- Location → has many Tags (M2M)

## Acceptance Criteria
- [ ] Name required, 1-100 chars
- [ ] Capacity required, 1-500

## Parity Notes
| Backend (Pydantic) | Frontend (Zod) | Match |
|--------------------|----------------|-------|
| name: str (no constraints) | name: min(1).max(200) | ❌ Backend missing |
| capacity: int (no constraints) | capacity: min(1).max(500) | ❌ Backend missing |
| tag_ids: missing | tag_ids: present | ❌ Backend missing |

## Archive semantics on write

Location is a soft-delete entity. See `docs/domain-rules/_overview.md` → "is_active semantics on get/update/patch" for the general rule. **Entity note:** PUT requires explicit `is_active` (GH #178); PATCH sticky inherited from `SoftDeleteService` (no override).
