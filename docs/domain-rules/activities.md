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
- **occupied** = SUM(Record.seats) WHERE activity_id = X AND status IN ('waiting','visited')
  - Implemented via `active_record_filter()` in `src/domain/record_visits.py` (shared with the booking guard `check_activity_capacity`)
  - Source of truth: `ACTIVE_RECORD_STATUSES` constant in `src/domain/visit_status.py`
  - Cancelled / missed records free their seats (excluded from the sum)
- **No capacity re-validation** when updating Activity
- **Cascade on delete:** hard-delete cascades to Records (and transitively their Visits + Payments); photos have `activity_id` set to NULL (photos survive); activity_tag join rows cleaned. Entire cascade is atomic.
- **Date-range filtering:** `date_from` / `date_to` are typed `date` query params (YYYY-MM-DD) — invalid date strings are rejected by FastAPI with **422 VALIDATION_ERROR** (was 500 before #191). Bounds are converted to a whole-day inclusive range via the shared `day_range()` util in `backend/src/domain/dates.py` (`datetime.combine` idiom: `date_from` covers from 00:00:00, `date_to` through 23:59:59.999999); the legacy untyped `datetime.fromisoformat` string parsing was removed. The date-range path (`ActivityService._list_by_date`) builds its `select(Activity)` stmt, wraps it via `repo.list_custom` — the repo owns count (on the unordered stmt) + order/limit/offset; the service owns page↔offset conversion and the `PaginatedResponse` envelope. The non-date-range path delegates to `GenericService.list` → `repo.list`.

### Frontend
- **Auto-fill from Service:** When service selected → duration, capacity, minAge auto-filled
- **DateTime parsing:** datetime-local → startTime (decimal hours) + day (Mon=0) + date (ISO)
- **Duration conversion:** HH:MM string ↔ decimal hours ↔ durationMinutes
- **Optimistic updates:** Snapshot → apply → rollback on error → invalidate on settle
- **Race protection:** API call races against 5-second timeout

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/activities | List (date range filter; invalid dates → 422) |
| GET | /api/v1/activities/{id} | Get with occupied count |
| POST | /api/v1/activities | Create |
| PUT | /api/v1/activities/{id} | Full update |
| PATCH | /api/v1/activities/{id} | Partial update |
| DELETE | /api/v1/activities/{id} | Hard delete (cascade: records + their visits/payments hard-deleted, photos SET NULL, tag join rows cleaned) |

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
- [ ] Delete cascades hard-delete to Records (and transitively Visits + Payments)

## Parity Notes
| Backend (Pydantic) | Frontend (Zod) | Match |
|--------------------|----------------|-------|
| start: datetime | start: string | ⚠️ Type difference |
| All fields required | All fields required | ✅ |
| is_private: default False | is_private: optional | ⚠️ |
