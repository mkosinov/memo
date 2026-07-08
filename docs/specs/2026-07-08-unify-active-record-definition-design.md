# #98 — Unify "active record" definition (occupied capacity) + fix last_visit metric

- **Date:** 2026-07-08
- **Issue:** https://github.com/mkosinov/memo/issues/98
- **Wave:** Tech-Debt Wave 1 (second, after #105)
- **Type:** Backend-only
- **Severity:** CRITICAL (wrong capacity data / blocks valid bookings)
- **Approach:** B — shared `active_record_filter()` SQL helper (user-chosen)

---

## Problem

After the hard-delete migration (`0a7e51d`), the backend has **two divergent definitions of "active record"** (= a record that counts toward an activity's occupied seats). Only one was updated with the status filter:

| Function | File:line | Definition of "counts toward capacity" | Status filter? |
|----------|-----------|------------------------------------------|----------------|
| `sum_active_seats` (used by `GET /activities`, `_to_response`) | `src/services/activity.py:65-79` | `is_active AND status IN ('waiting','visited')` | ✅ yes |
| `check_activity_capacity` (used by every `RecordService.create` + `VisitService.create`) | `src/domain/record_visits.py:74-104` (sum at 90-96) | `is_active` **only** | ❌ no |

**Consequence:** a `cancelled`/`missed` record still has its seats counted against the activity's capacity in the *booking check*, while the activity *view* correctly ignores them. The two disagree → **phantom occupied seats block valid bookings**.

### Secondary bug found during recon: `last_visit` semantics

`list_clients_with_stats` (`src/services/client.py:46-53`) computes the client "last visit" as `MAX(Visit.created_at)` — i.e. **when the record was created (when the client was booked)**, NOT when the client **actually attended**. This is a correctness bug: "last visit" should reflect the date of the master-class the client actually attended.

---

## Canonical decisions (from brainstorming, 2026-07-08)

| Topic | Decision |
|-------|----------|
| Canonical "occupied" | `SUM(Record.seats) WHERE is_active AND status IN ('waiting','visited')` |
| Shared constant | `ACTIVE_RECORD_STATUSES` lives in `src/domain/visit_status.py`, bound to `VisitStatus` enum members (not raw strings) |
| Shared SQL helper | `active_record_filter(activity_id)` in `src/domain/record_visits.py` (already imports ORM models) |
| `check_activity_capacity` | Uses `active_record_filter()` — **CRITICAL FIX** (adds status filter) |
| `sum_active_seats` | Refactored to use `active_record_filter()`; local `ACTIVE_RECORD_STATUSES` class attribute removed |
| client `records_count_sq` | **Not touched** → deferred to #131 |
| client `total_paid_sq` | **Not touched** — a payment on a cancelled/missed record was still really paid (financial stat counts all payments) |
| client `last_visit_sq` | **FIXED:** `MAX(Activity.start)` WHERE record `is_active` AND `Visit.status='visited'` (was `MAX(Visit.created_at)`) |
| client `missed_visits_sq` | **Not touched** — filters `Visit.status='missed'`, correct as-is |
| `last_visit` → `last_record_activity` metric swap | **Out of scope** → #133 (product decision, touches UI) |
| Double `VisitStatus` enum (`models/enums.py` vs `domain/visit_status.py`) | **Out of scope** → #134 |

---

## Architecture / placement

```
src/domain/visit_status.py   (pure — NO ORM models)
  └─ ACTIVE_RECORD_STATUSES: tuple[str, ...] =
       (VisitStatus.WAITING.value, VisitStatus.VISITED.value)

src/domain/record_visits.py  (already imports Record, Activity, Visit)
  └─ active_record_filter(activity_id: str) -> tuple[ColumnElement, ...]
       returns:
         (Record.activity_id == activity_id,
          Record.is_active.is_(True),
          Record.status.in_(ACTIVE_RECORD_STATUSES))
  └─ check_activity_capacity(...)  → WHERE *active_record_filter(activity_id)   [FIX]

src/services/activity.py
  └─ sum_active_seats(...)  → WHERE *active_record_filter(activity_id)          [refactor]
     (drop local ACTIVE_RECORD_STATUSES class attribute; import from domain)

src/services/client.py
  └─ last_visit_sq → MAX(Activity.start), join Record→Visit→Activity,
       WHERE Record.is_active AND Visit.status == 'visited'                      [FIX]
```

**Why the helper lives in `record_visits.py`, not `visit_status.py`:** `visit_status.py` is a pure domain module (enum + pydantic only, no ORM). Importing `Record`/`Activity` there would break layer purity and risk an import cycle. The *constant* stays pure in `visit_status.py`; the *SQL fragment* (which needs ORM models) lives beside the capacity logic in `record_visits.py`.

---

## Data flow changes

| Function | Before | After |
|----------|--------|-------|
| `check_activity_capacity` | `SUM(seats) WHERE is_active` | `SUM(seats) WHERE *active_record_filter()` (+ status) — **CRITICAL FIX** |
| `sum_active_seats` | local constant + inline filter | `SUM(seats) WHERE *active_record_filter()` |
| `last_visit_sq` (client.py) | `MAX(Visit.created_at)` WHERE is_active | `MAX(Activity.start)` WHERE is_active AND `Visit.status='visited'` — **CORRECTNESS FIX** (adds Record→Visit→Activity join) |

---

## Edge cases / error handling

| Edge case | Behaviour |
|-----------|-----------|
| `Record.status = "pending"` (transient, at create before `recompute_record_status`) | NOT in `ACTIVE_RECORD_STATUSES` → does not occupy a seat until derivation runs. In `RecordService.create` the capacity check runs before the row participates in the sum, so a new record does not count against itself. **Plan must verify create ordering** so the newly-created record is still admitted correctly (the check is for *existing* occupancy). |
| All visits of a record → `cancelled` (status `"cancelled"`) | Seat freed immediately; available for a new booking. |
| All visits → `missed` (status `"missed"`) | Seat freed. |
| Mixed (visited + waiting) → status `"visited"` | Occupies a seat (visited ∈ filter). |
| `last_visit`: client with zero `visited` visits | `MAX(Activity.start)` = NULL → UI "last visit" empty. Correct (never attended). |
| `last_visit`: visited visit with `Activity.start` in the future | Theoretically impossible (can't attend the future); we do NOT add a `start <= now` guard — we trust the `visited` status (user decision). |

---

## Testing strategy (TDD — RED first)

### New regression tests (backend)

1. **`test_check_activity_capacity_excludes_cancelled`** — fill an activity to capacity → cancel all visits of a record (status → cancelled) → assert a new booking on the same activity is ADMITTED (seat freed). *Fails today (the bug).*
2. **`test_check_activity_capacity_excludes_missed`** — same for `missed`.
3. **`test_capacity_view_and_check_agree`** — on one fixture state, `sum_active_seats` and `check_activity_capacity`'s internal occupied value return the same number.
4. **`test_last_visit_uses_activity_start_visited`** — client with 2 records: old activity (`start` = yesterday) with a `visited` visit, new activity (`start` = tomorrow) with a `waiting` visit → `last_visit` = yesterday (NOT tomorrow, NOT `created_at`).
5. **`test_last_visit_null_without_visited`** — client with only `waiting`/`cancelled` visits → `last_visit` = NULL.

### Existing tests to keep / update

- `tests/test_edge_cases.py::test_occupied_excludes_cancelled` / `test_occupied_excludes_missed` — already assert the VIEW behaviour; keep.
- Any existing client-stats `last_visit` assertion — update to the new `Activity.start` / `visited` semantics.
- `tests/test_record_visits.py::test_check_activity_capacity_*` — extend/update for the new filter.

---

## User Scenarios (→ integration / API level; backend-only, no browser E2E)

1. **Cancelling a record frees its seat** — activity full (occupied = capacity) → user cancels a record's visits → a new booking on that activity succeeds (no 409).
2. **A no-show (missed) frees its seat** — same, for `missed`.
3. **View and booking agree at the boundary** — `GET /activities/{id}` reports `occupied = N`; creating a record for `(capacity − N + 1)` seats returns 409 exactly at the boundary; `(capacity − N)` succeeds.
4. **"Last visit" reflects actual attendance** — client booked for a future master-class (`waiting`) AND attended a past one (`visited`) → the client list "last visit" = the past date, not the future one, not the booking-creation date.
5. **Client with no attendance** — a client with no `visited` visit → "last visit" is empty.

---

## Out of scope (spun off)

- **#133** — replace/add `last_record_activity` (upcoming-booking metric). Product decision, touches UI.
- **#131** — client stats in record-units (`records_count`, `missed_records`). Depends on derived record status.
- **#134** — deduplicate the two `VisitStatus` enums.

## Files touched (expected)

- `src/domain/visit_status.py` — add `ACTIVE_RECORD_STATUSES`
- `src/domain/record_visits.py` — add `active_record_filter()`, use in `check_activity_capacity`
- `src/services/activity.py` — `sum_active_seats` uses helper; drop local constant
- `src/services/client.py` — `last_visit_sq` rewrite (Record→Visit→Activity join)
- `tests/test_record_visits.py`, `tests/test_edge_cases.py`, `tests/test_client_stats.py` (or equivalent) — new + updated tests

No migration (no schema change). No frontend change (backend-only; `last_visit` field type unchanged — still an ISO datetime string or null).
