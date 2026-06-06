# Master — Domain Rules

## Description
A Master is an artist who conducts master classes. Masters have a color used for visual identification in the schedule.

## Fields
| Field | Type | Required | Min | Max | Default | Description |
|-------|------|----------|-----|-----|---------|-------------|
| first_name | string | ✅ | — | 100 | — | Имя |
| last_name | string | ✅ | — | 100 | — | Фамилия |
| color | string | ✅ | — | 7 | — | Hex цвет (e.g. "#5B8C7A") |
| position | string | ✅ | — | 20 | — | Должность (мастер/администратор) |
| specialty | string | ✅ | — | 20 | — | Специализация (живопись/керамика) |
| avatar_url | string | ❌ | — | — | null | URL аватара |

## Cross-field Rules
- None.

## Invariants
- Masters are archived (is_active = false), never hard-deleted
- color has no format validation at code level (just str)

## Business Logic

### Backend
- Pure CRUD, no business logic
- position/specialty stored as strings (enums exist but not enforced in schema)

### Frontend
- No create/edit form exists (MasterCreate Zod schema missing)
- Used in schedule as colored blocks
- ArtistPicker: CustomSelect with color square

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/masters | List active |
| GET | /api/v1/masters/{id} | Get |
| POST | /api/v1/masters | Create |
| PUT | /api/v1/masters/{id} | Full update |
| DELETE | /api/v1/masters/{id} | Soft delete |

## Relationships
- Master → has many Activities
- Master → has many Tags (M2M)
- User → may belong to Master (one-to-one)

## Enums & Constants
| Enum | Values |
|------|--------|
| Position | мастер, администратор |
| Specialty | живопись, керамика |

## Acceptance Criteria
- [ ] Color stored as hex string
- [ ] First/last name required

## Parity Notes
| Backend (Pydantic) | Frontend (Zod) | Match |
|--------------------|----------------|-------|
| position: str (not enum) | position: str | ✅ (both not enforced) |
| specialty: str (not enum) | specialty: str | ✅ (both not enforced) |
| No MasterCreateSchema | No MasterCreateSchema | ✅ |
