# Backend Health #129 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the `list_activities` N+1 query, add a capacity re-check to record update/patch, and remove the duplicated inline seats computation — all backend-only, no schema or API-contract change.

**Architecture:** Add a batched `sum_active_seats_bulk` aggregate to `ActivityService` (one GROUP BY, reusing `ACTIVE_RECORD_STATUSES`). Reorder `RecordService.update`/`patch` so the record's own visits are removed before the unchanged `check_activity_capacity` runs (avoids double-count, no domain change). Delete dead inline `seats` assignment and route final seats through `recompute_record_seats` in all three paths.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, SQLite, pytest (sync `TestClient`), factory fixtures in `backend/tests/conftest.py`.

**Spec:** `docs/specs/2026-07-16-backend-health-129-design.md`

---

## Behavioral Delta

How this behaves, mapped to spec acceptance criteria (all backend/API-observable):

- **N+1 removed (US-1, US-2, US-3)** → Listing a week of activities returns the same correct `occupied` values as before, but the backend issues a fixed, small number of DB queries regardless of how many activities are in the list (was 1-per-activity).
- **Capacity re-check on update (US-4, US-6)** → Editing a record so its seats would exceed the activity's capacity is rejected with HTTP 409 (same as create); the record is left unchanged. Shrinking a record always succeeds.
- **Capacity re-check on patch (US-5, US-7)** → Patching a record's visit list past capacity is rejected with 409; patching only non-seat fields (e.g. `comment`) on a full activity still succeeds.
- **Edit-in-place on a full activity (US-9)** → On a sold-out activity (occupied == capacity), an admin can still change a record's `price`/`tariff_id` or re-link a visit to another `visitor_id` as long as the number of seats stays the same — no false 409. (Changing a Visitor's name/age is a separate path, not covered here.)
- **Dedup seats (US-8)** → Create, update and patch all compute the final persisted `seats` identically (visits-in-DB + anonym), via a single code path.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `backend/src/services/activity.py` | Add `sum_active_seats_bulk` batch aggregate | modify |
| `backend/src/api/v1/activities.py` | Use batch method in `list_activities`; split mapper | modify |
| `backend/src/services/record.py` | Capacity re-check in update/patch; dedup seats (create + remove dead line) | modify |
| `backend/tests/test_api_activities.py` | US-1, US-3 (occupied correctness after batch) | modify |
| `backend/tests/test_list_activities_query_count.py` | US-2 (query-count anchor) | create |
| `backend/tests/test_record_capacity_recheck.py` | US-4, US-5, US-6, US-7 | create |
| `backend/tests/test_record_seats_dedup.py` | US-8 | create |

**Working directory for all commands:** `backend/` (where `pytest` and `alembic.ini` live). Run tests with `cd backend && pytest ...` or from the worktree's `backend/` dir.

---

## Task 1: N+1 fix — batch `sum_active_seats_bulk` + rewire `list_activities`

### Classification: standard

### Required Docs
- `docs/specs/2026-07-16-backend-health-129-design.md` — §2 (chosen approach A, rejected alternatives)
- `.opencode/skills/pytest-patterns/SKILL.md` — factory fixtures, sync TestClient, query counting
- `backend/src/services/activity.py` — existing `sum_active_seats`, `active_record_filter` import, `ACTIVE_RECORD_STATUSES` usage
- `backend/tests/conftest.py` — `create_activity`, `create_record`, `db_engine` fixtures

### Task Description
Eliminate the 1+N query pattern in `list_activities`. Add a single batched aggregate method to `ActivityService` and rewire the router to call it once. Reuse the same active-record status set so the batch view cannot drift from the capacity check.

### Steps

- [ ] **RED (US-2):** Create `backend/tests/test_list_activities_query_count.py`. Write a test that seeds N=5 activities (via `create_activity`), each with 1 record (via `create_record(activity_id=...)`), then counts DB statements executed during `GET /api/v1/activities?date_from=...&date_to=...`. Use a SQLAlchemy `before_cursor_execute` event listener on `db_engine.sync_engine`:

  ```python
  """US-2: list_activities issues a bounded number of queries (no N+1)."""
  from datetime import UTC, datetime, timedelta

  import pytest
  from sqlalchemy import event

  pytestmark = pytest.mark.api


  def _count_select_queries(db_engine):
      """Context manager-ish counter of SELECT statements on the sync engine."""
      counter = {"n": 0}

      def _before(conn, cursor, statement, params, context, executemany):
          if statement.lstrip().upper().startswith("SELECT"):
              counter["n"] += 1

      event.listen(db_engine.sync_engine, "before_cursor_execute", _before)
      return counter, _before


  def test_list_activities_query_count_is_bounded(api_client, db_engine, create_activity, create_client):
      """occupied for N activities must NOT cost ~N SELECTs (N+1 regression guard)."""
      start = datetime.now(UTC) + timedelta(days=1)
      date_from = start.date().isoformat()
      date_to = (start + timedelta(days=1)).date().isoformat()

      # Seed 5 activities, each with one record occupying a seat
      for _ in range(5):
          activity = create_activity(start=start)
          client = create_client()
          resp = api_client.post("/api/v1/records", json={
              "activity_id": activity["id"],
              "client_id": client["id"],
              "comment": "seat",
              "visits": [{"name": "G", "price": 1000, "status": "waiting"}],
          })
          assert resp.status_code == 201

      counter, listener = _count_select_queries(db_engine)
      try:
          resp = api_client.get(f"/api/v1/activities?date_from={date_from}&date_to={date_to}")
      finally:
          event.remove(db_engine.sync_engine, "before_cursor_execute", listener)

      assert resp.status_code == 200
      assert len(resp.json()) == 5
      # Before fix: ~1 (list) + 5 (per-activity SUM) = 6+. After: list + ONE batch SUM.
      # Assert the occupied computation adds at most 1 query beyond the list query,
      # independent of activity count. Allow a small constant for the list itself.
      assert counter["n"] <= 3, f"N+1 regression: {counter['n']} SELECTs for 5 activities"
  ```

  > **Implementer note:** the constant `<= 3` is an estimate (1 list query + 1 batch SUM + 1 buffer). Its real value is as an N+1 **regression guard** — the count must be BOUNDED and NOT scale with the number of activities. After GREEN, verify the actual count and micro-adjust the constant if SQLAlchemy issues an extra query, but keep it a small fixed number (do NOT make it `~N`). If in doubt, add a second assertion that seeding 10 activities yields the same count as 5.

- [ ] Run it, confirm it FAILS (current code does ~6 SELECTs): `cd backend && pytest tests/test_list_activities_query_count.py -x -q`
- [ ] **GREEN:** Add `sum_active_seats_bulk` to `ActivityService` in `backend/src/services/activity.py`:

  ```python
  async def sum_active_seats_bulk(
      self, db_session: AsyncSession, activity_ids: list[str]
  ) -> dict[str, int]:
      """Return {activity_id: occupied_seats} for the given activities in ONE query.

      Active definition reuses ACTIVE_RECORD_STATUSES (same set used by
      active_record_filter) so the batch view can never drift from the
      per-activity capacity check.
      """
      if not activity_ids:
          return {}
      result = await db_session.execute(
          select(Record.activity_id, func.coalesce(func.sum(Record.seats), 0))
          .where(
              Record.activity_id.in_(activity_ids),
              Record.is_active.is_(True),
              Record.status.in_(ACTIVE_RECORD_STATUSES),
          )
          .group_by(Record.activity_id)
      )
      return {row[0]: int(row[1]) for row in result.all()}
  ```

  Add the import at the top of `activity.py`:
  ```python
  from src.domain.visit_status import ACTIVE_RECORD_STATUSES
  ```
  (verify the symbol is exported there — it is imported by `domain/record_visits.py:17`).

- [ ] Rewire the router. In `backend/src/api/v1/activities.py`, split `_to_response` into a pure mapper + keep the single-activity occupied path, and rewrite `list_activities`:

  ```python
  def _map_response(activity, occupied: int) -> ActivityResponse:
      """Pure mapper — ORM Activity + precomputed occupied → response."""
      data = ActivityResponse.model_validate(activity)
      data.occupied = occupied
      return data


  async def _to_response(service, db_session, activity) -> ActivityResponse:
      """Single-activity response (computes occupied via one SUM)."""
      occupied = await service.sum_active_seats(db_session=db_session, activity_id=activity.id)
      return _map_response(activity, occupied)


  @router.get("", response_model=list[ActivityResponse])
  async def list_activities(
      service: _ServiceDep,
      session: SessionDep,
      date_from: str | None = Query(None),
      date_to: str | None = Query(None),
  ) -> list[ActivityResponse]:
      """Return all active activities, optionally filtered by date range."""
      activities = await service.list(db_session=session, date_from=date_from, date_to=date_to)
      occupied_map = await service.sum_active_seats_bulk(
          db_session=session, activity_ids=[a.id for a in activities]
      )
      return [_map_response(a, occupied=occupied_map.get(a.id, 0)) for a in activities]
  ```
  Leave `get_activity`, `create_activity`, `update_activity`, `partial_update_activity` using `_to_response` unchanged.

- [ ] Run US-2 test, confirm it PASSES: `cd backend && pytest tests/test_list_activities_query_count.py -x -q`

- [ ] **RED→GREEN (US-1, US-3):** Add correctness tests to `backend/tests/test_api_activities.py` (append a new test class):

  ```python
  class TestActivitiesOccupiedBatch:
      """US-1 / US-3: occupied is correct after the batched N+1 fix."""

      def test_occupied_correct_for_multiple_activities(self, api_client, create_activity, create_client) -> None:
          """US-1: each activity reports its own occupied seats in the list."""
          from datetime import UTC, datetime, timedelta
          start = datetime.now(UTC) + timedelta(days=1)
          df = start.date().isoformat()
          dt = (start + timedelta(days=1)).date().isoformat()

          a1 = create_activity(start=start, capacity=10)
          a2 = create_activity(start=start, capacity=10)
          # a1 gets 2 seats, a2 gets 0
          c = create_client()
          api_client.post("/api/v1/records", json={
              "activity_id": a1["id"], "client_id": c["id"], "comment": "x",
              "visits": [
                  {"name": "A", "price": 1000, "status": "waiting"},
                  {"name": "B", "price": 1000, "status": "waiting"},
              ],
          })

          resp = api_client.get(f"/api/v1/activities?date_from={df}&date_to={dt}")
          assert resp.status_code == 200
          by_id = {a["id"]: a for a in resp.json()}
          assert by_id[a1["id"]]["occupied"] == 2
          assert by_id[a2["id"]]["occupied"] == 0

      def test_occupied_zero_for_activity_with_no_records(self, api_client, create_activity) -> None:
          """US-3: an activity with no active records returns occupied=0."""
          from datetime import UTC, datetime, timedelta
          start = datetime.now(UTC) + timedelta(days=1)
          df = start.date().isoformat()
          dt = (start + timedelta(days=1)).date().isoformat()
          create_activity(start=start)

          resp = api_client.get(f"/api/v1/activities?date_from={df}&date_to={dt}")
          assert resp.status_code == 200
          assert all(a["occupied"] == 0 for a in resp.json())
  ```

- [ ] Run: `cd backend && pytest tests/test_api_activities.py -x -q` — all pass.
- [ ] Run the full activities + query-count suite: `cd backend && pytest tests/test_api_activities.py tests/test_list_activities_query_count.py -q`
- [ ] Commit: `git add -A && git commit -m "perf(#129): batch sum_active_seats_bulk — fix list_activities N+1"`

### Definition of Done
- `sum_active_seats_bulk` exists and reuses `ACTIVE_RECORD_STATUSES`.
- `list_activities` calls it once; per-activity occupied is correct (US-1, US-3).
- US-2 query-count test passes (≤3 SELECTs for 5 activities).
- No API-contract change (occupied field identical shape/meaning).

---

## Task 2: Capacity re-check on `update` + `patch` (Variant 1 — remove-then-check)

### Classification: standard

### Required Docs
- `docs/specs/2026-07-16-backend-health-129-design.md` — §3 (Variant 1, order-of-operations, critical note, skip rule)
- `backend/src/services/record.py` — existing `update` (line ~192) and `patch` (line ~230); `create`'s use of `check_activity_capacity`
- `backend/src/domain/record_visits.py` — `check_activity_capacity` signature (UNCHANGED)
- `backend/tests/conftest.py` — `sample_activity_at_capacity`, `create_record`, `create_activity` fixtures

### Task Description
Add a capacity re-check to `RecordService.update` and `RecordService.patch`. Do NOT modify `check_activity_capacity` or `active_record_filter`. Instead, reorder so the record's existing visits are deleted (and `anonym_visits` set to the new value) BEFORE calling the unchanged `check_activity_capacity` with the record's new effective seat count. On over-capacity → 409 → transaction rolls back. `patch` only re-checks when the patch touches `visits` or `anonym_visits`.

### Steps

- [ ] **RED (US-4):** Create `backend/tests/test_record_capacity_recheck.py` with a test: create an activity with `capacity=2`, create a record with 1 visit (occupied=1), then PUT-update that record to 3 visits (would be 3 > 2) → expect 409 with code `ACTIVITY_AT_CAPACITY`, and the record still has 1 visit afterward.

  ```python
  """Capacity re-check on update/patch (US-4, US-5, US-6, US-7)."""
  from datetime import UTC, datetime, timedelta

  import pytest

  pytestmark = pytest.mark.api


  def _make_activity_with_record(api_client, create_activity, create_client, *, capacity, n_visits):
      activity = create_activity(capacity=capacity)
      client = create_client()
      visits = [{"name": f"G{i}", "price": 1000, "status": "waiting"} for i in range(n_visits)]
      resp = api_client.post("/api/v1/records", json={
          "activity_id": activity["id"], "client_id": client["id"],
          "comment": "x", "visits": visits,
      })
      assert resp.status_code == 201, resp.text
      return activity, resp.json()


  def test_update_over_capacity_returns_409(api_client, create_activity, create_client) -> None:
      """US-4: growing a record past capacity via PUT → 409, record unchanged."""
      activity, record = _make_activity_with_record(
          api_client, create_activity, create_client, capacity=2, n_visits=1
      )
      resp = api_client.put(f"/api/v1/records/{record['id']}", json={
          "activity_id": activity["id"],
          "client_id": record["client_id"],
          "comment": "x",
          "visits": [
              {"name": "A", "price": 1000, "status": "waiting"},
              {"name": "B", "price": 1000, "status": "waiting"},
              {"name": "C", "price": 1000, "status": "waiting"},
          ],
      })
      assert resp.status_code == 409
      assert resp.json()["detail"]["code"] == "ACTIVITY_AT_CAPACITY"
      # record unchanged: still 1 visit
      after = api_client.get(f"/api/v1/records/{record['id']}").json()
      assert len(after["visits"]) == 1
  ```

  > **Note for implementer:** confirm the exact PUT payload shape from `RecordUpdate` schema and the GET record endpoint path. Adjust `client_id`/field names to match the real schema if needed — the assertion intent (409 + unchanged) is what matters.

- [ ] Run it, confirm FAILS (currently update lets it through, no 409): `cd backend && pytest tests/test_record_capacity_recheck.py -x -q`

- [ ] **GREEN (update):** In `backend/src/services/record.py` `update` method, reorder per §3. After deleting existing visits and setting `record.anonym_visits`, compute effective seats and call the unchanged capacity check BEFORE inserting new visits:

  ```python
  # inside update(), after loading record and setting record-level fields:
  record.anonym_visits = data.anonym_visits or 0

  # remove the record's own existing visits first (so they don't self-count)
  for existing_visit in list(record.visits):
      await db_session.delete(existing_visit)
  await db_session.flush()

  # CRITICAL: check_activity_capacity sums the stored Record.seats COLUMN, not
  # live visit counts. Deleting visits does NOT change Record.seats — it stays at
  # the old value until recompute_record_seats runs. So we MUST recompute seats
  # here (→ 0 visits + current anonym_visits) BEFORE the capacity check, otherwise
  # the occupied sum still includes this record's stale old seats → double-count
  # → a shrink (US-6) would falsely 409. This resets the record's own contribution.
  await recompute_record_seats(db_session, record.id)

  # capacity re-check with the record's own seats already reset in the sum
  effective_seats = len(data.visits) + record.anonym_visits
  await check_activity_capacity(db_session, data.activity_id, seats=effective_seats)

  # only now insert the new visits
  for visit_item in data.visits:
      visit = Visit(...)
      db_session.add(visit)
  await db_session.flush()

  await recompute_record_seats(db_session, record.id)
  await recompute_record_status(db_session, record.id)
  ```
  Remove the now-dead `record.seats = len(data.visits) + (data.anonym_visits or 0)` line (this is also Task 3's item — do it here since we're editing the same block). Keep `record.updated_at = datetime.now(UTC)`.

  Import `check_activity_capacity` is already present at the top of `record.py`.

- [ ] Run US-4 test, confirm PASSES.

- [ ] **RED (US-6):** Add a test: activity `capacity=3`, record with 3 visits, PUT-update down to 1 visit → 200, record has 1 visit. Confirm it passes (shrink always allowed — should pass once update logic is correct).

  ```python
  def test_update_shrink_succeeds(api_client, create_activity, create_client) -> None:
      """US-6: shrinking a record's seats always succeeds."""
      activity, record = _make_activity_with_record(
          api_client, create_activity, create_client, capacity=3, n_visits=3
      )
      resp = api_client.put(f"/api/v1/records/{record['id']}", json={
          "activity_id": activity["id"],
          "client_id": record["client_id"],
          "comment": "x",
          "visits": [{"name": "A", "price": 1000, "status": "waiting"}],
      })
      assert resp.status_code == 200
      assert len(resp.json()["visits"]) == 1
  ```

- [ ] Run US-6, confirm PASSES.

- [ ] **RED (US-5):** Add a test for `patch`: activity `capacity=2`, record with 1 visit, PATCH with `visits` list of 3 → 409.

  ```python
  def test_patch_visits_over_capacity_returns_409(api_client, create_activity, create_client) -> None:
      """US-5: patching visits past capacity → 409."""
      activity, record = _make_activity_with_record(
          api_client, create_activity, create_client, capacity=2, n_visits=1
      )
      resp = api_client.patch(f"/api/v1/records/{record['id']}", json={
          "visits": [
              {"name": "A", "price": 1000, "status": "waiting"},
              {"name": "B", "price": 1000, "status": "waiting"},
              {"name": "C", "price": 1000, "status": "waiting"},
          ],
      })
      assert resp.status_code == 409
      assert resp.json()["detail"]["code"] == "ACTIVITY_AT_CAPACITY"
  ```

- [ ] Run it, confirm FAILS.

- [ ] **GREEN (patch):** In `record.py` `patch` method, add the same remove-then-check, but ONLY when `"visits" in update_data` or `"anonym_visits" in update_data`. Compute the effective seats from the new visits list (if present) or the record's current visit count, plus the effective anonym value:

  ```python
  # inside patch(), after applying comment/custom_price and setting anonym_visits:
  seats_changed = "visits" in update_data or "anonym_visits" in update_data
  if "visits" in update_data:
      for existing_visit in list(record.visits):
          await db_session.delete(existing_visit)
      await db_session.flush()

  if seats_changed:
      # CRITICAL (same as update): reset Record.seats to reflect the current DB
      # state BEFORE the capacity check, so the occupied sum doesn't double-count
      # this record's stale old seats. recompute_record_seats counts visits still
      # in the DB (0 if we just deleted them for a visits-patch; unchanged for an
      # anonym-only patch) + record.anonym_visits.
      await recompute_record_seats(db_session, record.id)
      new_anonym = record.anonym_visits  # already updated above if present
      if "visits" in update_data:
          new_visit_count = len(update_data["visits"])
      else:
          # anonym-only change: count current visits still in DB
          new_visit_count = len(list(record.visits))
      effective_seats = new_visit_count + new_anonym
      await check_activity_capacity(db_session, record.activity_id, seats=effective_seats)

  if "visits" in update_data:
      for visit_item in update_data["visits"]:
          visit = Visit(...)  # existing construction
          db_session.add(visit)

  record.updated_at = datetime.now(UTC)
  await db_session.flush()
  await recompute_record_seats(db_session, record.id)
  await recompute_record_status(db_session, record.id)
  ```

  > **Implementer note:** be careful with the anonym-only branch — after deleting is skipped, `record.visits` still reflects current DB visits. Verify the `record.activity_id` is the correct source for the activity (patch does not change activity). Preserve the existing visit construction (tariff_id, price, custom_price, status defaults) exactly as in the current `patch`.

- [ ] Run US-5, confirm PASSES.

- [ ] **RED→GREEN (US-7):** Add a test: create an activity with `capacity=1`, fill it (1 visit), then PATCH only `comment` → 200 (no 409, because seats untouched).

  ```python
  def test_patch_comment_only_on_full_activity_succeeds(api_client, create_activity, create_client) -> None:
      """US-7: patching only comment on a full activity does NOT trigger capacity check."""
      activity, record = _make_activity_with_record(
          api_client, create_activity, create_client, capacity=1, n_visits=1
      )
      resp = api_client.patch(f"/api/v1/records/{record['id']}", json={"comment": "updated note"})
      assert resp.status_code == 200
      assert resp.json()["comment"] == "updated note"
  ```

- [ ] Run US-7, confirm PASSES (the `seats_changed` guard skips the capacity query).

- [ ] **RED→GREEN (US-9):** Add a test proving that on a FULL activity (occupied == capacity) you can still edit a record's visit fields (`price`, `tariff_id`, re-link `visitor_id`) as long as the seat count stays the same. This is the "edit-in-place on a sold-out class" guarantee. Cover BOTH update (PUT) and patch (PATCH):

  ```python
  def test_edit_fields_on_full_activity_same_seatcount_succeeds(
      api_client, create_activity, create_client, sample_tariff
  ) -> None:
      """US-9: on a full activity, changing price/tariff/visitor_id (same seat count) → 200."""
      # capacity=2, fill it exactly with ONE record holding 2 visits → occupied == capacity
      activity, record = _make_activity_with_record(
          api_client, create_activity, create_client, capacity=2, n_visits=2
      )
      # sanity: activity is full
      df = None  # (occupied verified via activity GET below)
      act = api_client.get(f"/api/v1/activities/{activity['id']}").json()
      assert act["occupied"] == 2  # == capacity

      # --- PUT: same 2 visits but new price + tariff_id (seat count unchanged) ---
      put_resp = api_client.put(f"/api/v1/records/{record['id']}", json={
          "activity_id": activity["id"],
          "client_id": record["client_id"],
          "comment": "x",
          "visits": [
              {"name": "A", "price": 9999, "tariff_id": sample_tariff, "status": "waiting"},
              {"name": "B", "price": 8888, "tariff_id": sample_tariff, "status": "waiting"},
          ],
      })
      assert put_resp.status_code == 200, put_resp.text
      put_body = put_resp.json()
      assert len(put_body["visits"]) == 2
      assert {v["price"] for v in put_body["visits"]} == {9999, 8888}
      assert all(v["tariff_id"] == sample_tariff for v in put_body["visits"])

      # --- PATCH: same 2 visits, change price again (seat count still unchanged) ---
      patch_resp = api_client.patch(f"/api/v1/records/{record['id']}", json={
          "visits": [
              {"price": 100, "tariff_id": sample_tariff, "status": "waiting"},
              {"price": 200, "tariff_id": sample_tariff, "status": "waiting"},
          ],
      })
      assert patch_resp.status_code == 200, patch_resp.text
      assert {v["price"] for v in patch_resp.json()["visits"]} == {100, 200}


  def test_relink_visitor_on_full_activity_succeeds(
      api_client, create_activity, create_client
  ) -> None:
      """US-9: on a full activity, re-linking a visit to another visitor_id (same seat count) → 200."""
      activity, record = _make_activity_with_record(
          api_client, create_activity, create_client, capacity=1, n_visits=1
      )
      # create another visitor via a throwaway record's visit, or via visitor API if available.
      # Simplest: use ID-based visit with a visitor_id from a second client's record.
      other_client = create_client()
      seed = api_client.post("/api/v1/records", json={
          "activity_id": create_activity(capacity=5)["id"],  # different activity, just to mint a visitor
          "client_id": other_client["id"], "comment": "seed",
          "visits": [{"name": "OtherPerson", "price": 1000, "status": "waiting"}],
      }).json()
      other_visitor_id = seed["visits"][0]["visitor_id"]
      assert other_visitor_id is not None

      # re-link the full-activity record's single visit to the other visitor (seat count stays 1)
      resp = api_client.put(f"/api/v1/records/{record['id']}", json={
          "activity_id": activity["id"],
          "client_id": record["client_id"],
          "comment": "x",
          "visits": [{"visitor_id": other_visitor_id, "price": 1000, "status": "waiting"}],
      })
      assert resp.status_code == 200, resp.text
      assert resp.json()["visits"][0]["visitor_id"] == other_visitor_id
  ```

  > **Implementer note:** `sample_tariff` fixture exists in conftest (inserts a tariff row). Confirm `VisitResponse` exposes `tariff_id` (it does — `schemas/record.py:35`). For the re-link test, verify the seed-visitor approach works with your visitor-creation flow; if a direct visitor API/fixture is cleaner, use it. The intent: same seat count, changed visit fields, on a full activity → 200.

- [ ] Run US-9 tests, confirm PASS. **This is the load-bearing guarantee for editing a sold-out class** — if they fail, the `recompute_record_seats`-before-check ordering is wrong.

- [ ] Run the whole capacity file: `cd backend && pytest tests/test_record_capacity_recheck.py -q` — all 6 pass.
- [ ] Regression: `cd backend && pytest tests/test_api_records.py tests/test_record_visits.py -q`
- [ ] Commit: `git add -A && git commit -m "fix(#129): capacity re-check on record update/patch (409 on over-capacity)"`

### Definition of Done
- Update growing past capacity → 409, record unchanged (US-4).
- Patch visits past capacity → 409 (US-5).
- Shrinking succeeds (US-6).
- Comment-only patch on full activity succeeds — no capacity query (US-7).
- Editing visit fields (price/tariff_id/re-link visitor_id) on a FULL activity with an
  unchanged seat count succeeds via both PUT and PATCH (US-9).
- `check_activity_capacity` and `active_record_filter` are UNCHANGED.
- Capacity check sits between delete-old-visits and insert-new-visits, with
  `recompute_record_seats` called BEFORE the check (resets own seats).

---

## Task 3: Dedup seats rule — single source of truth via `recompute_record_seats`

### Classification: small

### Required Docs
- `docs/specs/2026-07-16-backend-health-129-design.md` — §4 (dead line 205, add recompute in create)
- `backend/src/services/record.py` — `create` (line ~82) and `update` (line ~192)
- `backend/src/domain/record_visits.py` — `recompute_record_seats` semantics (count visits in DB + anonym)

### Task Description
Make final persisted `seats` come from `recompute_record_seats` in all three write paths. Remove the dead inline assignment in `update` (already handled in Task 2 if done there — verify) and add `recompute_record_seats` to `create` after the visits flush. The inline `effective_seats = len(...) + anonym` stays ONLY for the pre-insert capacity check.

### Steps

- [ ] **RED (US-8):** Create `backend/tests/test_record_seats_dedup.py`. Assert create, update, and patch all yield the same `seats` for the same visit set (2 visits + anonym_visits=1 → seats=3):

  ```python
  """US-8: create/update/patch compute identical final seats (single source of truth)."""
  import pytest

  pytestmark = pytest.mark.api


  def test_create_update_patch_seats_are_consistent(api_client, create_activity, create_client) -> None:
      activity = create_activity(capacity=10)
      client = create_client()
      two_visits = [
          {"name": "A", "price": 1000, "status": "waiting"},
          {"name": "B", "price": 1000, "status": "waiting"},
      ]

      # create with 2 visits + anonym_visits=1 → seats должно быть 3
      created = api_client.post("/api/v1/records", json={
          "activity_id": activity["id"], "client_id": client["id"],
          "comment": "x", "visits": two_visits, "anonym_visits": 1,
      }).json()
      assert created["seats"] == 3, f"create seats={created['seats']}"

      # update to the same shape → same seats
      updated = api_client.put(f"/api/v1/records/{created['id']}", json={
          "activity_id": activity["id"], "client_id": client["id"],
          "comment": "x", "visits": two_visits, "anonym_visits": 1,
      }).json()
      assert updated["seats"] == 3, f"update seats={updated['seats']}"

      # patch visits to the same shape → same seats
      patched = api_client.patch(f"/api/v1/records/{created['id']}", json={
          "visits": two_visits, "anonym_visits": 1,
      }).json()
      assert patched["seats"] == 3, f"patch seats={patched['seats']}"
  ```

  > **Implementer note:** confirm `RecordResponse` exposes `seats` and that `RecordCreate`/`RecordUpdate` accept `anonym_visits`. Adjust field names if the schema differs; the invariant (all three == 3) is the point.

- [ ] Run it. It may already PASS for update/patch (they call `recompute_record_seats`) but is the guard for `create`. If `create` seats is wrong, confirm FAIL first.

- [ ] **GREEN:** In `backend/src/services/record.py` `create`, after the visits flush (`await db_session.flush()` following the visit-creation loop, ~line 140) and before/around `recompute_record_status`, add:

  ```python
  await recompute_record_seats(db_session, record.id)
  await recompute_record_status(db_session, record.id)
  ```
  `recompute_record_seats` is already imported at the top of `record.py`.

- [ ] Verify the dead line in `update` (`record.seats = len(data.visits) + (data.anonym_visits or 0)`) is removed. If Task 2 already removed it, confirm it's gone; otherwise remove it now.

- [ ] Run US-8: `cd backend && pytest tests/test_record_seats_dedup.py -x -q` — passes.
- [ ] Regression: `cd backend && pytest tests/test_api_records.py tests/test_record_visits.py tests/test_integration_flows.py -q`
- [ ] Commit: `git add -A && git commit -m "refactor(#129): route final record.seats through recompute_record_seats in all paths"`

### Definition of Done
- `create` calls `recompute_record_seats` after visits flush.
- Dead inline `seats` assignment in `update` removed.
- Create/update/patch produce identical `seats` (US-8).
- Inline `len(...) + anonym` remains only for pre-insert capacity math.

---

## Task 4: Full backend suite + wrap-up

### Classification: small

### Required Docs
- `.opencode/skills/pytest-patterns/SKILL.md` — running the full suite / markers

### Task Description
Run the entire backend test suite to confirm zero regressions across all 8 user scenarios and pre-existing tests.

### Steps
- [ ] Run full backend suite: `cd backend && pytest -q`
- [ ] Confirm all pass (baseline was ~649 passing; new tests add to that). If any pre-existing test fails, investigate whether it's a real regression from Tasks 1-3 vs a known flake — report, do not silently skip.
- [ ] Confirm the three new test files + activities additions all pass together.
- [ ] No commit needed (verification only) unless a fixup is required.

### Definition of Done
- Full `pytest` green.
- All 8 US scenarios covered by passing tests.

---

## Self-Review

**Spec coverage:**
- §2 N+1 → Task 1 (US-1, US-2, US-3) ✅
- §3 capacity re-check → Task 2 (US-4, US-5, US-6, US-7) ✅
- §4 dedup seats → Task 3 (US-8) ✅
- Full regression → Task 4 ✅

**Placeholder scan:** No TBD/TODO. "Implementer note" callouts are deliberate schema-confirmation reminders, not gaps.

**Type consistency:** `sum_active_seats_bulk` returns `dict[str, int]`; router uses `.get(id, 0)`. `check_activity_capacity` signature unchanged across Task 2.

**Required Docs check:** Every task has a Required Docs section referencing the spec section + relevant code + pytest-patterns skill.

**Classification:** Task 1 standard (new method + router rewire + 3 tests), Task 2 standard (two methods reordered + 4 tests), Task 3 small (2-line add + dead-line removal + 1 test), Task 4 small (verification).
