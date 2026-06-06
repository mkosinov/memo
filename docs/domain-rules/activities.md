# Activity — Domain Rules

## Description
An Activity is a scheduled instance of a Service. It ties together a Master, Service, and Location with a specific date/time and capacity.

## Fields
| Field | Type | Required | Min | Max | Default | Description |
|-------|------|----------|-----|-----|---------|-------------|
| master_id | string | ✅ | — | — | — | FK to Master |
| service_id | string | ✅ | — | — | — | FK to Service |
| location_id | string | ✅ | — | — | — | FK to Location |
| start | datetime | ✅ | — | — | — | Start date/time |
| duration | integer | ✅ | — | — | — | Duration in minutes |
| capacity | integer | ✅ | — | — | — | Max attendees |
| is_private | boolean | ❌ | — | — | false | Private class |
| comment | string | ❌ | — | — | null | Internal comment |
| record_info | string | ❌ | — | — | null | Info shown to clients |
| occupied | integer | — | — | — | 0 | Computed: count of active Records |

## Cross-field Rules
- `capacity` should be >= occupied (but not enforced on update)
- `duration` should match Service.duration (auto-filled on frontend)

## Invariants
- master_id, service_id, location_id must reference existing active records (FK enforced)
- `occupied` is computed on every read, never stored

## Business Logic

### Backend
- **occupied** = COUNT(DISTINCT Records WHERE activity_id = X AND is_active = True)
- **No capacity re-validation** when updating Activity
- **No cascade** on activity delete — orphan Records remain active
- **Date-range filtering:** Only returns is_active = True activities

### Frontend
- **Auto-fill from Service:** When service selected → duration, capacity, minAge auto-filled
- **DateTime parsing:** datetime-local → startTime (decimal hours) + day (Mon=0) + date (ISO)
- **Duration conversion:** HH:MM string ↔ decimal hours ↔ durationMinutes
- **Optimistic updates:** Snapshot → apply → rollback on error → invalidate on settle
- **Race protection:** API call races against 5-second timeout

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/activities | List (date range filter) |
| GET | /api/v1/activities/{id} | Get with occupied count |
| POST | /api/v1/activities | Create |
| PUT | /api/v1/activities/{id} | Full update |
| PATCH | /api/v1/activities/{id} | Partial update |
| DELETE | /api/v1/activities/{id} | Soft delete (no cascade) |

## Relationships
- Activity → belongs to Service
- Activity → belongs to Master
- Activity → belongs to Location
- Activity → has many Records
- Activity → has many Tags (M2M)

## Acceptance Criteria
- [ ] occupied computed correctly
- [ ] Auto-fill from Service works
- [ ] Optimistic updates roll back on error
- [ ] Delete does NOT cascade to Records

## Parity Notes
| Backend (Pydantic) | Frontend (Zod) | Match |
|--------------------|----------------|-------|
| start: datetime | start: string | ⚠️ Type difference |
| All fields required | All fields required | ✅ |
| is_private: default False | is_private: optional | ⚠️ |
