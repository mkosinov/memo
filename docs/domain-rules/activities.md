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
| service_title | string | — | — | — | null | Computed on LIST endpoints only (joined Service.title); null on single-item endpoints |

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
- **Date-range filtering:** `date_from` / `date_to` are typed `date` query params (YYYY-MM-DD) — invalid date strings are rejected by FastAPI with **422 VALIDATION_ERROR** (was 500 before #191). Bounds are converted to a whole-day inclusive range via the shared `day_range()` util in `backend/src/domain/dates.py` (`datetime.combine` idiom: `date_from` covers from 00:00:00, `date_to` through 23:59:59.999999); the legacy untyped `datetime.fromisoformat` string parsing was removed. Both list paths (with and without date range) funnel through the single stmt builder in `ActivityService.list` (GH #212, former `_list_by_date` absorbed): equality filters → day range → `service_id` → `q` predicate, wrapped via `repo.list_entity` (thin wrapper over the `list_custom` row core, GH #213 §5.1) — the repo owns count (on the unordered stmt, so `total` reflects q/filters) + order/limit/offset; the service owns page↔offset conversion and the `PaginatedResponse` envelope, then populates `service_title` on every item via ONE bounded bulk Service query.
- **Search (`?q=`, GH #212):** case-insensitive substring on the joined `Service.title` OR exact `activity.id` equality when q is a full UUID. `Service` join added ONLY when q is present (default query plan unchanged). `q` contract: min_length=2 / max_length=100 → else 422 VALIDATION_ERROR. `service_id` param intersects with q.

### Frontend
- **Auto-fill from Service:** When service selected → duration, capacity, minAge auto-filled
- **DateTime canon (GH #142):** datetime-local → `startMinutes` (minutes from midnight) + `dayIndex` (Mon=0..Sun=6) → `composeLocalISO(date, startMinutes)` for API payloads. Duration is integer minutes (`durationMinutes`); display via `formatTime(startMinutes)`.
- **Single parser:** `frontend/admin/lib/datetime.ts` (`parseLocalISO` et al.) is the ONLY datetime parser — treats input as floating local time (no UTC shifts). Records list and Schedule grid both consume it, guaranteeing parity (same parser, same minutes).
- **Optimistic updates:** Snapshot → apply → rollback on error → invalidate on settle
- **Race protection (GH #141):** no artificial timeout — the PATCH settles naturally (success or real network error). The former 5-second `Promise.race` rollback was removed: it raced the server-side write (UI rolled back while the request kept flying and could still be applied → screen/server desync). In-flight saves surface via a «сохраняем…» indicator + `beforeunload` guard.

## Display label convention (project-wide, GH #211 §7.7)

THE canonical string representation of an activity in the admin frontend — used everywhere an activity renders as an option/label (photo modal typeaheads, filters, dropdowns; future #213 «Активность» column):

- **Format:** `«{dd.mm.yyyy HH:mm} — {location title} — {service_title}»` — DATE FIRST (e.g. «21.08.2026 14:00 — Студия Север — День рождения»), local time.
- **ONE shared formatter:** `formatActivityLabel(activity, locationsMap)` in `frontend/admin/lib/utils.ts` (built on `formatActivityDateTime`); all consumers call it, nobody composes the string inline. `formatActivityStart` was DELETED (was the last non-canonical consumer — GH #211 Task 10).
- **Segment omission:** a segment is dropped when its data is absent — no dangling « — » separators. Location title resolves client-side via the `/locations/all` map (**ACTIVE-only**) — an activity at an ARCHIVED location omits the location segment (id not in map).
- **Separator:** « — » (project convention).
- **#213 cross-pin:** the display-lookup composite (#213) will centralize activity display data further — it must reuse this label, no third format gets invented there.

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/activities | List (date range, `service_id`, `?q=` search filters; invalid dates → 422; items carry `service_title`) |
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
