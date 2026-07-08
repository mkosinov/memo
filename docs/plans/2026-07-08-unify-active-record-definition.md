# #98 — Unify "active record" definition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the booking capacity check and the activity-view occupancy agree on a single definition of "active record" (`is_active AND status IN (waiting,visited)`) via a shared SQL helper, and fix the `last_visit` client stat to reflect actual attendance date.

**Architecture:** Introduce `ACTIVE_RECORD_STATUSES` in the pure domain module (`domain/visit_status.py`) and an `active_record_filter()` SQL helper in `domain/record_visits.py` (which already imports ORM models). Both `check_activity_capacity` (CRITICAL fix) and `sum_active_seats` (refactor) use the helper. Separately, rewrite the `last_visit` scalar subquery to use `MAX(Activity.start)` over `visited` visits.

**Tech Stack:** FastAPI, SQLAlchemy (async), pytest (sync TestClient), SQLite.

---

## Behavioral Delta

How this behaves, mapped to spec acceptance criteria:

- **Cancelling a record frees its seat** → when all visits of a record are set to `cancelled`, that record's seats no longer count against the activity's capacity — a new booking on a previously-full activity now succeeds instead of returning 409.
- **A no-show (missed) frees its seat** → same behavior when all visits are `missed`.
- **View and booking agree** → the `occupied` number shown by `GET /activities/{id}` and the occupancy used by the create-record capacity guard are now always equal.
- **"Last visit" reflects actual attendance** → the client list "last visit" shows the date of the last master-class the client actually attended (`Activity.start` of a `visited` visit), not the date the booking was created, and not a future booking's date.
- **Client with no attendance** → a client who has never attended shows an empty "last visit".

No API shape change, no migration, no frontend change.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `backend/src/domain/visit_status.py` | Pure status enum + derivation. Add canonical `ACTIVE_RECORD_STATUSES` constant. | modify |
| `backend/src/domain/record_visits.py` | Cascade + capacity domain ops. Add `active_record_filter()`; use in `check_activity_capacity`. | modify |
| `backend/src/services/activity.py` | Activity service. `sum_active_seats` uses helper; drop local constant. | modify |
| `backend/src/services/client.py` | Client stats. Rewrite `last_visit_sq`. | modify |
| `backend/tests/test_record_visits.py` | Domain unit tests for capacity/helper. | modify |
| `backend/tests/test_edge_cases.py` | Capacity regression (cancel/missed frees seat via create). | modify |
| `backend/tests/test_client_stats.py` | `last_visit` semantics tests. | modify |

---

## Task 1: Add `ACTIVE_RECORD_STATUSES` constant + `active_record_filter()` helper (TDD)

### Classification: standard

### Required Docs
- `docs/specs/2026-07-08-unify-active-record-definition-design.md` — the spec (architecture, decisions, edge cases)
- `docs/domain-rules/records.md` — record status semantics, capacity invariant
- `.opencode/skills/pytest-patterns/SKILL.md` — pytest fixtures, factory pattern, sync TestClient

### Context
`domain/visit_status.py` is a **pure** module (enum + pydantic, NO ORM imports) — the constant goes here so it can be imported anywhere without cycles. The SQL helper needs `Record` ORM model, so it lives in `domain/record_visits.py` which already imports `Record`, `Activity`, `Visit`. The helper returns a tuple of SQLAlchemy `ColumnElement` conditions for reuse in `.where(*...)`.

### Steps

- [ ] **Add the constant** to `backend/src/domain/visit_status.py` (after the `VisitStatus` enum, ~line 13):
  ```python
  # Record statuses that occupy a seat in an activity's capacity.
  # "active record" = is_active AND status IN these values.
  # cancelled/missed records do NOT occupy a seat.
  ACTIVE_RECORD_STATUSES: tuple[str, ...] = (
      VisitStatus.WAITING.value,
      VisitStatus.VISITED.value,
  )
  ```

- [ ] **Write RED unit test** for the helper in `backend/tests/test_record_visits.py` (add to existing file). This is a pure SQL-fragment test — assert the filter produces the expected conditions by running it against the DB via the async session is heavy; instead test it structurally + behaviorally. Add:
  ```python
  from src.domain.visit_status import ACTIVE_RECORD_STATUSES
  from src.domain.record_visits import active_record_filter


  def test_active_record_statuses_excludes_cancelled_and_missed():
      assert "waiting" in ACTIVE_RECORD_STATUSES
      assert "visited" in ACTIVE_RECORD_STATUSES
      assert "cancelled" not in ACTIVE_RECORD_STATUSES
      assert "missed" not in ACTIVE_RECORD_STATUSES


  def test_active_record_filter_returns_three_conditions():
      conds = active_record_filter("act-123")
      # activity_id match, is_active, status IN (...)
      assert len(conds) == 3
  ```

- [ ] **Run RED:** `cd backend && python -m pytest tests/test_record_visits.py -k "active_record" -x` → expect ImportError / failure (helper not defined yet).

- [ ] **Implement the helper** in `backend/src/domain/record_visits.py`. Add import at top:
  ```python
  from src.domain.visit_status import (
      VisitItem, compute_record_status, ACTIVE_RECORD_STATUSES,
  )
  ```
  (merge with the existing `from src.domain.visit_status import VisitItem, compute_record_status` line). Then add the helper function (before `check_activity_capacity`):
  ```python
  def active_record_filter(activity_id: str):
      """WHERE conditions for records that occupy a seat in an activity's capacity.

      Active = is_active AND status IN (waiting, visited).
      Shared by check_activity_capacity (booking guard) and
      ActivityService.sum_active_seats (view) so both agree.
      """
      return (
          Record.activity_id == activity_id,
          Record.is_active.is_(True),
          Record.status.in_(ACTIVE_RECORD_STATUSES),
      )
  ```

- [ ] **Run GREEN:** `cd backend && python -m pytest tests/test_record_visits.py -k "active_record" -x` → expect pass.

- [ ] **Commit:** `git add -A && git commit -m "feat(#98): add ACTIVE_RECORD_STATUSES constant + active_record_filter helper"`

### Definition of Done
- Constant defined in pure domain module; helper defined beside capacity logic.
- Both new unit tests pass.

---

## Task 2: Fix `check_activity_capacity` to use the helper (CRITICAL) — TDD

### Classification: standard

### Required Docs
- `docs/specs/2026-07-08-unify-active-record-definition-design.md` — CRITICAL-fix section, edge cases
- `docs/domain-rules/records.md` — capacity invariant
- `.opencode/skills/pytest-patterns/SKILL.md`

### Context
`check_activity_capacity` (`domain/record_visits.py:74-104`) currently sums seats over `Record.is_active` ONLY (missing the status filter) — cancelled/missed records phantom-occupy seats. This is the core bug. The regression test uses the real API flow: fill an activity to capacity, cancel all visits of one record (via `PUT /visits/{id}/status`, which re-derives record status → `cancelled`), then assert a NEW booking on that activity is now admitted (would 409 before the fix). Visit-status change path already exists — see `test_edge_cases.py:377-382`.

### Steps

- [ ] **Write RED regression test** in `backend/tests/test_edge_cases.py` (add to the same class as `test_occupied_excludes_cancelled`, near line 413). It must go through `create_record` + capacity 409:
  ```python
  def test_capacity_check_excludes_cancelled_record(
      self, api_client, create_record, _create_activity_payload
  ):
      """A cancelled record frees its seat for a new booking (capacity guard)."""
      act_payload = _create_activity_payload()
      act_payload["capacity"] = 3
      act_resp = api_client.post("/api/v1/activities", json=act_payload)
      assert act_resp.status_code == 201
      act_id = act_resp.json()["id"]

      # Fill all 3 seats
      r1 = create_record(activity_id=act_id, visits=[
          {"name": "A", "price": 1000},
          {"name": "B", "price": 1000},
          {"name": "C", "price": 1000},
      ])
      # Sanity: activity now full → a new booking is rejected
      full = api_client.post("/api/v1/records", json={
          "activity_id": act_id,
          "visits": [{"name": "X", "price": 1000}],
      })
      assert full.status_code == 409, f"expected full: {full.text}"

      # Cancel all visits of r1 → record status becomes 'cancelled' → seats freed
      for visit in r1["visits"]:
          api_client.put(
              f"/api/v1/visits/{visit['id']}/status",
              json={"status": "cancelled"},
          )

      # Now the same booking must succeed
      after = api_client.post("/api/v1/records", json={
          "activity_id": act_id,
          "visits": [{"name": "X", "price": 1000}],
      })
      assert after.status_code == 201, f"seat should be free after cancel: {after.text}"

  def test_capacity_check_excludes_missed_record(
      self, api_client, create_record, _create_activity_payload
  ):
      """A missed (no-show) record frees its seat for a new booking."""
      act_payload = _create_activity_payload()
      act_payload["capacity"] = 3
      act_resp = api_client.post("/api/v1/activities", json=act_payload)
      assert act_resp.status_code == 201
      act_id = act_resp.json()["id"]

      r1 = create_record(activity_id=act_id, visits=[
          {"name": "A", "price": 1000},
          {"name": "B", "price": 1000},
          {"name": "C", "price": 1000},
      ])
      for visit in r1["visits"]:
          api_client.put(
              f"/api/v1/visits/{visit['id']}/status",
              json={"status": "missed"},
          )

      after = api_client.post("/api/v1/records", json={
          "activity_id": act_id,
          "visits": [{"name": "X", "price": 1000}],
      })
      assert after.status_code == 201, f"seat should be free after missed: {after.text}"
  ```

- [ ] **Run RED:** `cd backend && python -m pytest tests/test_edge_cases.py -k "capacity_check_excludes" -x` → expect the "after" assertion to fail with 409 (bug reproduced).

- [ ] **Implement the fix** in `backend/src/domain/record_visits.py` — replace the occupied query inside `check_activity_capacity` (lines 90-96) to use the helper:
  ```python
      occupied_result = await db_session.execute(
          select(func.coalesce(func.sum(Record.seats), 0)).where(
              *active_record_filter(activity_id)
          )
      )
      occupied = occupied_result.scalar() or 0
  ```

- [ ] **Run GREEN:** `cd backend && python -m pytest tests/test_edge_cases.py -k "capacity_check_excludes" -x` → expect pass.

- [ ] **Verify create-ordering (spec edge-case row 1):** read `backend/src/services/record.py::create` and confirm `check_activity_capacity` (line ~92) runs BEFORE the `Record(...)` is added/flushed (line ~117). The new record must NOT count against its own capacity check. This is already true in the current code — add a one-line assertion in `test_capacity_check_excludes_cancelled_record` right after `create_record` (the initial fill) that the fill itself succeeded at exactly capacity (no off-by-one): `assert len(r1["visits"]) == 3`. No code change expected; this step is a documented verification.

- [ ] **Run full capacity/occupied regression:** `cd backend && python -m pytest tests/test_edge_cases.py tests/test_record_visits.py tests/test_api_visits.py -k "capacity or occupied" -x` → expect all pass.

- [ ] **Commit:** `git add -A && git commit -m "fix(#98): capacity check excludes cancelled/missed records (CRITICAL)"`

### Definition of Done
- Both new regression tests pass (cancel frees seat, missed frees seat).
- No existing capacity/occupied test regresses.
- User Scenarios 1, 2, 3 covered at API level.

---

## Task 3: Refactor `sum_active_seats` to use the shared helper — TDD

### Classification: small

### Required Docs
- `docs/specs/2026-07-08-unify-active-record-definition-design.md` — refactor row in data-flow table
- `.opencode/skills/pytest-patterns/SKILL.md`

### Context
`sum_active_seats` (`services/activity.py:65-79`) already filters correctly but duplicates the definition via a local class attribute `ACTIVE_RECORD_STATUSES` (line 28) and an inline filter. Point it at the shared helper so there is ONE definition. Remove the now-unused class attribute. This is a pure refactor — behavior must not change; existing `test_occupied_*` tests are the guard.

### Steps

- [ ] **Confirm guard tests pass BEFORE change (baseline):** `cd backend && python -m pytest tests/test_edge_cases.py -k "occupied" -x` → expect pass.

- [ ] **Refactor** `backend/src/services/activity.py`:
  - Remove the class attribute `ACTIVE_RECORD_STATUSES = ("waiting", "visited")` (line ~28) and its comment.
  - Add import at top: `from src.domain.record_visits import active_record_filter`
  - Replace the body of `sum_active_seats` query (lines 72-78) with:
    ```python
      result = await db_session.execute(
          select(func.coalesce(func.sum(Record.seats), 0)).where(
              *active_record_filter(activity_id)
          )
      )
      return int(result.scalar() or 0)
    ```
  - Update the docstring to reference the shared helper.

- [ ] **Run GREEN (behavior unchanged):** `cd backend && python -m pytest tests/test_edge_cases.py tests/test_api_activities.py -k "occupied" -x` → expect pass.

- [ ] **Add explicit agreement test** (spec testing-strategy item 3) in `backend/tests/test_edge_cases.py`, same class:
  ```python
  def test_capacity_view_and_check_agree(
      self, api_client, create_record, _create_activity_payload
  ):
      """sum_active_seats (view 'occupied') and check_activity_capacity agree:
      after cancelling a record, the view occupied drops AND a booking for the
      freed seats is admitted — same underlying active_record_filter."""
      act_payload = _create_activity_payload()
      act_payload["capacity"] = 4
      act_id = api_client.post("/api/v1/activities", json=act_payload).json()["id"]

      r1 = create_record(activity_id=act_id, visits=[
          {"name": "A", "price": 1000},
          {"name": "B", "price": 1000},
      ])
      create_record(activity_id=act_id, visits=[
          {"name": "C", "price": 1000},
          {"name": "D", "price": 1000},
      ])
      # view: full
      assert api_client.get(f"/api/v1/activities/{act_id}").json()["occupied"] == 4

      # cancel r1 (2 seats)
      for visit in r1["visits"]:
          api_client.put(f"/api/v1/visits/{visit['id']}/status", json={"status": "cancelled"})

      # view now reports 2
      assert api_client.get(f"/api/v1/activities/{act_id}").json()["occupied"] == 2
      # check agrees: a 2-seat booking is admitted (not 409)
      after = api_client.post("/api/v1/records", json={
          "activity_id": act_id,
          "visits": [{"name": "E", "price": 1000}, {"name": "F", "price": 1000}],
      })
      assert after.status_code == 201, f"view/check disagree: {after.text}"
  ```

- [ ] **Run it:** `cd backend && python -m pytest tests/test_edge_cases.py -k "view_and_check_agree" -x` → expect pass.

- [ ] **Grep to confirm no stray references** to the removed attribute: `cd backend && grep -rn "ACTIVE_RECORD_STATUSES" src/ tests/` → expect references ONLY in `domain/visit_status.py` (definition), `domain/record_visits.py` (import/use), and any test importing it. NO reference to `self.ACTIVE_RECORD_STATUSES` or `ActivityService.ACTIVE_RECORD_STATUSES`.

- [ ] **Commit:** `git add -A && git commit -m "refactor(#98): sum_active_seats uses shared active_record_filter"`

### Definition of Done
- Single definition of "active record" (helper + constant); local attribute removed.
- All occupied tests still pass (no behavior change).

---

## Task 4: Fix `last_visit` stat → `MAX(Activity.start)` over visited visits — TDD

### Classification: standard

### Required Docs
- `docs/specs/2026-07-08-unify-active-record-definition-design.md` — last_visit correctness-fix, edge cases
- `docs/domain-rules/clients.md` — client stats fields
- `.opencode/skills/pytest-patterns/SKILL.md`

### Context
`last_visit_sq` (`services/client.py:46-53`) currently returns `MAX(Visit.created_at)` (when the record was created), filtered by `Record.is_active` only. It must return `MAX(Activity.start)` (the master-class date) over visits with `Visit.status == 'visited'`, joined `Record → Visit → Activity`. `create_activity` fixture supports `start=` override (default = now+1day). Existing tests `test_last_visit_is_most_recent` (line 962) and `test_sort_by_last_visit_desc` (line 727) assert the OLD semantics weakly — they may need updating (see steps). `Activity` model must be imported in client.py.

### Steps

- [ ] **Write RED tests** in `backend/tests/test_client_stats.py` (add near line 1030, in the same test class as `test_last_visit_is_most_recent`). These use explicit `start=` dates and visit statuses:
  ```python
  def test_last_visit_uses_activity_start_of_visited(
      self, api_client, create_activity, create_client
  ):
      """last_visit = Activity.start of the client's last VISITED visit,
      not created_at, and not a future WAITING booking."""
      from datetime import UTC, datetime, timedelta

      client = create_client(name="AttendVsBooked", phone="+79999111001")

      past = datetime.now(UTC) - timedelta(days=10)
      future = datetime.now(UTC) + timedelta(days=10)
      act_past = create_activity(start=past)
      act_future = create_activity(start=future)

      # Attended the past activity
      api_client.post("/api/v1/records", json={
          "activity_id": act_past["id"], "client_id": client["id"],
          "visits": [{"name": "V", "price": 1000, "status": "visited"}],
      })
      # Booked (waiting) for the future activity
      api_client.post("/api/v1/records", json={
          "activity_id": act_future["id"], "client_id": client["id"],
          "visits": [{"name": "V", "price": 1000, "status": "waiting"}],
      })

      resp = api_client.get("/api/v1/clients")
      item = next(c for c in resp.json()["items"] if c["id"] == client["id"])
      assert item["last_visit"] is not None
      # Must be the PAST activity's start (attended), not the future booking
      assert item["last_visit"].startswith(past.date().isoformat())

  def test_last_visit_null_without_visited(
      self, api_client, create_activity, create_client
  ):
      """A client with only waiting/cancelled visits has last_visit=None."""
      client = create_client(name="NeverAttended", phone="+79999111002")
      act = create_activity()
      api_client.post("/api/v1/records", json={
          "activity_id": act["id"], "client_id": client["id"],
          "visits": [{"name": "V", "price": 1000, "status": "waiting"}],
      })

      resp = api_client.get("/api/v1/clients")
      item = next(c for c in resp.json()["items"] if c["id"] == client["id"])
      assert item["last_visit"] is None
  ```

- [ ] **Run RED:** `cd backend && python -m pytest tests/test_client_stats.py -k "last_visit_uses_activity_start or last_visit_null_without_visited" -x` → expect failure (old query returns created_at / ignores status).

- [ ] **Implement the fix** in `backend/src/services/client.py`:
  - Add import: `from src.models.activity import Activity`
  - Replace `last_visit_sq` (lines 46-53) with:
    ```python
      last_visit_sq = (
          select(func.max(Activity.start))
          .select_from(Visit)
          .join(Record, Visit.record_id == Record.id)
          .join(Activity, Record.activity_id == Activity.id)
          .where(
              Record.client_id == Client.id,
              Record.is_active == True,  # noqa: E712
              Visit.status == "visited",
          )
          .correlate(Client)
          .scalar_subquery()
      )
    ```

- [ ] **Run GREEN:** `cd backend && python -m pytest tests/test_client_stats.py -k "last_visit_uses_activity_start or last_visit_null_without_visited" -x` → expect pass.

- [ ] **Fix existing tests** that assumed old semantics:
  - `test_last_visit_is_most_recent` (line ~962): it creates a record with a `visited` visit on a default (future) activity and asserts `last_visit is not None`. Under the new rule, a `visited` visit on ANY activity still yields a non-null `Activity.start`, so this assertion likely still passes — **run it and confirm**. If it now fails (because its visit status defaults to `waiting` via `_create_client_with_record`), update its first record's visit status to `"visited"` explicitly.
  - `test_sort_by_last_visit_desc` (line ~727): read the test; it relies on ordering by recency. Ensure both clients have `visited` visits with distinct `Activity.start` dates (pass `start=` to `create_activity`). Update the test so the client meant to be "most recent" has a later `Activity.start` and a `visited` visit. Keep the assertion (LateVisitor first).

- [ ] **Run the whole client-stats suite:** `cd backend && python -m pytest tests/test_client_stats.py -x` → expect all pass.

- [ ] **Commit:** `git add -A && git commit -m "fix(#98): last_visit uses Activity.start of visited visits"`

### Definition of Done
- New tests pass; `last_visit` reflects attendance date, null without visited.
- Existing `last_visit` tests updated and passing.
- User Scenarios 4, 5 covered.

---

## Task 5: Full backend suite + domain-rules doc sync

### Classification: small

### Required Docs
- `docs/domain-rules/records.md`, `docs/domain-rules/activities.md`, `docs/domain-rules/clients.md` — update definitions
- `docs/domain-rules/_overview.md` — capacity invariant wording

### Context
Two domain-rules docs currently describe "occupied" inconsistently (`_overview.md:67` and `activities.md:31` say `COUNT(DISTINCT Records WHERE is_active)` — but the code uses `SUM(seats)` AND now a status filter). Sync the docs to the canonical definition. Also record the `last_visit` semantics in `clients.md`.

### Steps

- [ ] **Run the FULL backend suite** to confirm no regression anywhere: `cd backend && python -m pytest -x -q` → expect all pass (report the count).

- [ ] **Update `docs/domain-rules/activities.md`** (line ~31): change the occupied definition to:
  ```
  - **occupied** = SUM(Record.seats) WHERE activity_id = X AND is_active = True AND status IN ('waiting','visited')
  ```

- [ ] **Update `docs/domain-rules/_overview.md`** (line ~67, capacity invariant): clarify that "occupied" excludes cancelled/missed records and is a SUM of seats, referencing `active_record_filter`.

- [ ] **Update `docs/domain-rules/records.md`** capacity section (line ~113): note the shared `ACTIVE_RECORD_STATUSES` / `active_record_filter` as the single source, and that cancelled/missed free their seats.

- [ ] **Update `docs/domain-rules/clients.md`**: document `last_visit` = `MAX(Activity.start)` over `visited` visits of active records (null if never attended). Note `last_record_activity` (upcoming booking) is a separate future metric (#133).

- [ ] **Commit:** `git add -A && git commit -m "docs(#98): sync domain-rules for occupied definition + last_visit"`

### Definition of Done
- Full backend suite green.
- domain-rules docs match the implemented canonical definitions.

---

## Self-Review

**Spec coverage:**
- Canonical occupied + shared constant → Task 1
- `check_activity_capacity` CRITICAL fix → Task 2
- `sum_active_seats` refactor → Task 3
- `last_visit` correctness fix → Task 4
- domain-rules sync + full suite → Task 5
- User Scenarios 1-5 → Tasks 2 (1,2,3) + 4 (4,5)
- Spec test `test_capacity_view_and_check_agree` → Task 3 (explicit)
- Spec edge-case "verify create ordering" → Task 2 (verification step)

**Out of scope confirmed absent:** no `records_count`/`total_paid`/`missed_visits` changes; no enum dedup (#134); no `last_record_activity` (#133); no migration; no frontend.

**Placeholder scan:** none. All code blocks concrete.

**Type consistency:** helper returns a tuple of conditions used via `.where(*...)` in both call sites; `ACTIVE_RECORD_STATUSES` is `tuple[str,...]` matching `Record.status.in_(...)`.

**Required Docs:** every task has the section.
