"""Tests for the Activities CRUD API endpoints with date filtering and occupied."""

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from pydantic import ValidationError

from src.errors import ERROR_MESSAGES, ErrorCode
from src.schemas.activity import ActivityCopyWeekRequest, CopyWeekResult
from tests.conftest import query_db

pytestmark = pytest.mark.api

# --- Prerequisite payloads ---
MASTER_PAYLOAD = {
    "first_name": "Anna",
    "last_name": "Ivanova",
    "master": {"specialty": "oil", "color": "#5B8C7A"},
}

SERVICE_PAYLOAD = {
    "title": "Oil Painting",
    "description": "Learn oil painting",
    "image_url": "https://example.com/oil.jpg",
    "specialty": "oil",
    "min_age": 12,
    "max_age": 99,
    "duration": 90,
    "record_info": "Bring apron",
}

LOCATION_PAYLOAD = {
    "title": "Studio 1",
    "address": "123 Main St",
    "capacity": 20,
}


def _create_prerequisites(api_client) -> dict:
    """Create master, service, location and return their IDs."""
    master = api_client.post("/api/v1/staff", json=MASTER_PAYLOAD).json()
    service = api_client.post("/api/v1/services", json=SERVICE_PAYLOAD).json()
    location = api_client.post("/api/v1/locations", json=LOCATION_PAYLOAD).json()
    return {
        "master_id": master["id"],
        "service_id": service["id"],
        "location_id": location["id"],
    }


def _activity_payload(prereqs: dict, start: datetime | None = None) -> dict:
    """Build a valid ActivityCreate payload."""
    if start is None:
        start = datetime.now(UTC) + timedelta(days=1)
    return {
        "master_id": prereqs["master_id"],
        "service_id": prereqs["service_id"],
        "location_id": prereqs["location_id"],
        "start": start.isoformat(),
        "duration": 90,
        "capacity": 10,
        "is_private": False,
        "comment": "Test activity",
    }


class TestActivitiesDateFiltering:
    """Date range filtering on /api/activities."""

    def test_list_activities_with_date_range(self, api_client) -> None:
        """GET /api/activities?date_from=...&date_to=... filters by date range."""
        prereqs = _create_prerequisites(api_client)

        # Create activities on different dates
        today = datetime.now(UTC).replace(hour=10, minute=0, second=0, microsecond=0)
        tomorrow = today + timedelta(days=1)
        next_week = today + timedelta(days=7)

        api_client.post("/api/v1/activities", json=_activity_payload(prereqs, start=today))
        api_client.post("/api/v1/activities", json=_activity_payload(prereqs, start=tomorrow))
        api_client.post("/api/v1/activities", json=_activity_payload(prereqs, start=next_week))

        # Filter: only today and tomorrow
        response = api_client.get(
            "/api/v1/activities",
            params={
                "date_from": today.strftime("%Y-%m-%d"),
                "date_to": tomorrow.strftime("%Y-%m-%d"),
            },
        )
        assert response.status_code == 200
        body = response.json()
        activities = body["items"]
        assert len(activities) == 2
        assert body["total"] == 2

    def test_list_activities_no_date_filter_returns_all(self, api_client) -> None:
        """GET /api/activities without date params returns all active activities."""
        prereqs = _create_prerequisites(api_client)

        today = datetime.now(UTC).replace(hour=10, minute=0, second=0, microsecond=0)
        next_week = today + timedelta(days=7)

        api_client.post("/api/v1/activities", json=_activity_payload(prereqs, start=today))
        api_client.post("/api/v1/activities", json=_activity_payload(prereqs, start=next_week))

        response = api_client.get("/api/v1/activities")
        assert response.status_code == 200
        body = response.json()
        activities = body["items"]
        assert len(activities) == 2
        assert body["total"] == 2

    def test_list_activities_invalid_date_returns_422(self, api_client) -> None:
        """GET /api/v1/activities?date_from=garbage must reject with 422 (#191)."""
        resp = api_client.get("/api/v1/activities", params={"date_from": "garbage"})
        assert resp.status_code == 422


class TestActivitiesOccupied:
    """Occupied field computation (count of Records)."""

    def test_activity_occupied_increases_with_records(self, api_client) -> None:
        """GET /api/activities/{id} shows occupied=1 after creating a Record."""
        prereqs = _create_prerequisites(api_client)

        # Create activity
        create_resp = api_client.post(
            "/api/v1/activities", json=_activity_payload(prereqs)
        )
        activity_id = create_resp.json()["id"]

        # Verify occupied=0
        response = api_client.get(f"/api/v1/activities/{activity_id}")
        assert response.json()["occupied"] == 0

        # Insert record directly into DB
        asyncio.run(
            _insert_record_direct(
                activity_id=activity_id,
            )
        )

        # Verify occupied=1
        response = api_client.get(f"/api/v1/activities/{activity_id}")
        assert response.status_code == 200
        assert response.json()["occupied"] == 1


class TestActivitiesOccupiedBatch:
    """US-1 / US-3: occupied is correct after the batched N+1 fix."""

    def test_occupied_correct_for_multiple_activities(
        self, api_client, create_activity, create_client
    ) -> None:
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
        by_id = {a["id"]: a for a in resp.json()["items"]}
        assert by_id[a1["id"]]["occupied"] == 2
        assert by_id[a2["id"]]["occupied"] == 0

    def test_occupied_zero_for_activity_with_no_records(
        self, api_client, create_activity
    ) -> None:
        """US-3: an activity with no active records returns occupied=0."""
        from datetime import UTC, datetime, timedelta
        start = datetime.now(UTC) + timedelta(days=1)
        df = start.date().isoformat()
        dt = (start + timedelta(days=1)).date().isoformat()
        create_activity(start=start)

        resp = api_client.get(f"/api/v1/activities?date_from={df}&date_to={dt}")
        assert resp.status_code == 200
        assert all(a["occupied"] == 0 for a in resp.json()["items"])


class TestActivitiesListSearch:
    """Server-side `?q=` search on GET /api/v1/activities (GH #212, spec §5.2 activities row).

    Substring over the joined Service.title; exact activity.id equality when q
    is a full UUID. Optional ``service_id`` narrows by service. ``service_title``
    is populated on every list item (spec §5.3 point 7); single-item endpoints
    leave it None.
    """

    def test_search_by_service_title_cyrillic_case(
        self, api_client, create_service, create_activity
    ) -> None:
        """q matches the joined Service.title; Cyrillic upper/lower fold (M5)."""
        svc = create_service(title="Гончарная мастерская")
        target = create_activity(service_id=svc["id"])
        other = create_activity()  # default "Test Service N" title
        resp = api_client.get("/api/v1/activities", params={"q": "ОНЧАРНАЯ"})
        assert resp.status_code == 200
        ids = [a["id"] for a in resp.json()["items"]]
        assert target["id"] in ids and other["id"] not in ids

    def test_search_full_uuid_returns_exact_activity(
        self, api_client, create_activity
    ) -> None:
        target = create_activity()
        create_activity()  # decoy: uuid clause must match exactly one row
        body = api_client.get("/api/v1/activities", params={"q": target["id"]}).json()
        assert [a["id"] for a in body["items"]] == [target["id"]]
        assert body["total"] == 1

    def test_search_q_combined_with_service_id(
        self, api_client, create_service, create_activity
    ) -> None:
        """spec §7 case 12: q narrows by title, service_id intersects."""
        mugs = create_service(title="Печать на кружках")
        wood = create_service(title="Печать на дереве")
        target = create_activity(service_id=mugs["id"])
        create_activity(service_id=wood["id"])  # q-matches, wrong service
        body = api_client.get("/api/v1/activities", params={
            "q": "ечать", "service_id": mugs["id"],
        }).json()
        assert [a["id"] for a in body["items"]] == [target["id"]]
        assert body["total"] == 1

    def test_search_q_combined_with_date_range(
        self, api_client, create_service, create_activity
    ) -> None:
        svc = create_service(title="Мозаика панно")
        target = create_activity(service_id=svc["id"], start=datetime(2026, 8, 10, 10, 0))
        create_activity(service_id=svc["id"], start=datetime(2026, 9, 10, 10, 0))  # q-matches, out of range
        body = api_client.get("/api/v1/activities", params={
            "q": "озаик", "date_from": "2026-08-01", "date_to": "2026-08-31",
        }).json()
        assert [a["id"] for a in body["items"]] == [target["id"]]
        assert body["total"] == 1
        # spec §7 case 12: service_title present (non-null) in every list item
        assert body["items"][0]["service_title"] == "Мозаика панно"

    @pytest.mark.parametrize("q", ["a", ""])
    def test_search_q_length_validation_422(self, api_client, q) -> None:
        resp = api_client.get("/api/v1/activities", params={"q": q})
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"

    def test_service_title_populated_in_list_items_without_q(
        self, api_client, create_service, create_activity
    ) -> None:
        """List paths populate service_title even without q (spec §5.3 point 7)."""
        svc = create_service(title="Витраж тиффани")
        a1 = create_activity(service_id=svc["id"])
        a2 = create_activity()  # default title "Test Service 2"
        body = api_client.get("/api/v1/activities").json()
        titles = {a["id"]: a["service_title"] for a in body["items"]}
        assert titles[a1["id"]] == "Витраж тиффани"
        # default factory title (counter is shared — don't pin the number)
        assert titles[a2["id"]].startswith("Test Service")
        assert all(t is not None for t in titles.values())

    def test_service_title_populated_in_list_items_with_q(
        self, api_client, create_service, create_activity
    ) -> None:
        svc = create_service(title="Витраж тиффани")
        create_activity(service_id=svc["id"])
        create_activity(service_id=svc["id"])
        body = api_client.get("/api/v1/activities", params={"q": "витраж"}).json()
        assert body["total"] == 2
        assert all(a["service_title"] == "Витраж тиффани" for a in body["items"])

    def test_single_item_endpoints_leave_service_title_null(
        self, api_client, create_service, create_activity
    ) -> None:
        """GET/{id} and POST share ActivityResponse — field stays None there."""
        svc = create_service(title="Витраж тиффани")
        activity = create_activity(service_id=svc["id"])

        got = api_client.get(f"/api/v1/activities/{activity['id']}")
        assert got.status_code == 200
        assert got.json()["service_title"] is None

        created = api_client.post("/api/v1/activities", json={
            "master_id": activity["master_id"],
            "service_id": svc["id"],
            "location_id": activity["location_id"],
            "start": (datetime.now(UTC) + timedelta(days=2)).isoformat(),
            "duration": 90,
            "capacity": 10,
            "is_private": False,
        })
        assert created.status_code == 201, created.text
        assert created.json()["service_title"] is None


@pytest.mark.pure_unit
class TestCopyWeekContracts:
    """Copy-week request/response schemas + error codes (GH #242, spec §4).

    This task adds ONLY the Pydantic contracts — the route itself lands in
    Task 3; these tests pin the schema/error-registry contract directly.
    """

    MONDAY = date(2026, 9, 21)  # a Monday — week_start is the TARGET-week Monday

    def test_empty_locations_rejected(self) -> None:
        """locations=[] → ValidationError (FastAPI maps to 422 VALIDATION_ERROR)."""
        with pytest.raises(ValidationError):
            ActivityCopyWeekRequest(week_start=self.MONDAY, locations=[])

    def test_missing_locations_rejected(self) -> None:
        """locations is strictly required — no 'None = all' encoding (spec §4)."""
        with pytest.raises(ValidationError):
            ActivityCopyWeekRequest(week_start=self.MONDAY)

    def test_valid_request_parses(self) -> None:
        """Happy path: Monday + explicit location ids parse as-is."""
        req = ActivityCopyWeekRequest(
            week_start=self.MONDAY, locations=["loc-1", "loc-2"]
        )
        assert req.week_start == self.MONDAY
        assert req.locations == ["loc-1", "loc-2"]

    def test_copy_week_result_contract(self) -> None:
        """Response shape: four independent counters (spec §4 example)."""
        result = CopyWeekResult(
            copied=8, skipped_duplicates=2, skipped_filtered=1, skipped_no_master=0
        )
        assert result.model_dump() == {
            "copied": 8,
            "skipped_duplicates": 2,
            "skipped_filtered": 1,
            "skipped_no_master": 0,
        }

    def test_copy_week_error_codes_have_messages(self) -> None:
        """Each new ErrorCode resolves in ERROR_MESSAGES — no runtime KeyError."""
        assert (
            ERROR_MESSAGES[ErrorCode.COPY_WEEK_START_NOT_MONDAY]
            == "Неделя должна начинаться с понедельника"
        )
        assert (
            ERROR_MESSAGES[ErrorCode.COPY_WEEK_INVALID_LOCATION]
            == "В списке локаций есть неизвестные локации"
        )
        assert (
            ERROR_MESSAGES[ErrorCode.COPY_WEEK_SOURCE_TOO_LARGE]
            == "В выбранной области более 100 занятий — скопируйте в несколько "
            "заходов, сузив выбор локаций"
        )


# --- Copy-week route (GH #242 Task 3, spec §4) --------------------------------

#: TARGET week Monday — fixed so source/target windows are deterministic.
TARGET_MONDAY = date(2026, 9, 21)


def _copy_week_payload(
    week_start: date = TARGET_MONDAY, locations: list[str] | None = None
) -> dict:
    """Valid copy-week request body (locations=[...] required by schema)."""
    if locations is None:
        locations = ["placeholder"]
    return {"week_start": week_start.isoformat(), "locations": locations}


def _create_activity_at(api_client, prereqs: dict, start: datetime, **overrides) -> dict:
    """POST /api/v1/activities pinned to ``start`` (naive local datetime)."""
    payload = _activity_payload(prereqs, start=start)
    payload.update(overrides)
    resp = api_client.post("/api/v1/activities", json=payload)
    assert resp.status_code == 201, f"Seed activity failed: {resp.text}"
    return resp.json()


def _insert_activity_row(
    activity_id: str, prereqs: dict, start: datetime
) -> None:
    """Direct-INSERT an activities row (fast path for the 100-row cap test)."""
    from tests.conftest import query_db_params

    query_db_params(
        "INSERT INTO activities (id, master_id, service_id, location_id, start, "
        "duration, capacity, is_private, created_at, updated_at) "
        "VALUES (:id, :master_id, :service_id, :location_id, :start, "
        "90, 10, 0, datetime('now'), datetime('now'))",
        {
            "id": activity_id,
            "master_id": prereqs["master_id"],
            "service_id": prereqs["service_id"],
            "location_id": prereqs["location_id"],
            "start": start.strftime("%Y-%m-%d %H:%M:%S.%f"),
        },
    )


class TestCopyWeekRoute:
    """POST /api/v1/activities/copy-week — guards, validation, merge (GH #242)."""

    def test_copy_week_requires_auth(self, app) -> None:
        """Anonymous → 401 AUTH_UNAUTHORIZED (activities:write guard)."""
        from fastapi.testclient import TestClient

        anon = TestClient(app)
        resp = anon.post("/api/v1/activities/copy-week", json=_copy_week_payload())
        assert resp.status_code == 401, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value

    def test_copy_week_forbidden_for_master(self, login_as) -> None:
        """Master role lacks activities:write → 403 (guard matrix #247)."""
        from src.auth.passwords import hash_password
        from tests.conftest import insert_user

        phone = f"+7999{uuid.uuid4().hex[:7]}"
        insert_user(phone, hash_password("master-pass"), role="master")
        master_client = login_as(phone, "master-pass")

        resp = master_client.post(
            "/api/v1/activities/copy-week", json=_copy_week_payload()
        )
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_FORBIDDEN.value

    def test_copy_week_rejects_cross_site(self, api_client) -> None:
        """sec-fetch-site: cross-site → 403 AUTH_FORBIDDEN (CSRF line 2)."""
        resp = api_client.post(
            "/api/v1/activities/copy-week",
            json=_copy_week_payload(),
            headers={"sec-fetch-site": "cross-site"},
        )
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_FORBIDDEN.value

    def test_copy_week_non_monday_422(self, api_client) -> None:
        """week_start must be a Monday → 422 COPY_WEEK_START_NOT_MONDAY."""
        resp = api_client.post(
            "/api/v1/activities/copy-week",
            json=_copy_week_payload(week_start=date(2026, 9, 22)),  # Tuesday
        )
        assert resp.status_code == 422, resp.text
        assert (
            resp.json()["detail"]["code"] == ErrorCode.COPY_WEEK_START_NOT_MONDAY.value
        )

    def test_copy_week_empty_locations_422(self, api_client) -> None:
        """locations=[] → 422 VALIDATION_ERROR (schema min_length=1)."""
        resp = api_client.post(
            "/api/v1/activities/copy-week",
            json=_copy_week_payload(locations=[]),
        )
        assert resp.status_code == 422, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.VALIDATION_ERROR.value

    def test_copy_week_unknown_location_422(self, api_client) -> None:
        """Unknown location id → 422 COPY_WEEK_INVALID_LOCATION (fail-fast)."""
        resp = api_client.post(
            "/api/v1/activities/copy-week",
            json=_copy_week_payload(locations=["nonexistent-location-id"]),
        )
        assert resp.status_code == 422, resp.text
        assert (
            resp.json()["detail"]["code"] == ErrorCode.COPY_WEEK_INVALID_LOCATION.value
        )

    def test_copy_week_cap_422(self, api_client, create_location) -> None:
        """More than 100 rows to insert → 422 COPY_WEEK_SOURCE_TOO_LARGE (D3)."""
        prereqs = _create_prerequisites(api_client)
        for i in range(101):  # distinct starts → no dedup → 101 candidates
            _insert_activity_row(
                str(uuid.uuid4()),
                prereqs,
                datetime(2026, 9, 14, 8, 0) + timedelta(minutes=i),
            )
        resp = api_client.post(
            "/api/v1/activities/copy-week",
            json=_copy_week_payload(locations=[prereqs["location_id"]]),
        )
        assert resp.status_code == 422, resp.text
        assert (
            resp.json()["detail"]["code"] == ErrorCode.COPY_WEEK_SOURCE_TOO_LARGE.value
        )

    def test_copy_week_merge_end_to_end(self, api_client) -> None:
        """Partially occupied target: copied + skipped counters match (spec §4).

        Source week: A (plain) + B (duplicate in target) + C (private).
        """
        prereqs = _create_prerequisites(api_client)

        # Source week (Mon 14 .. Sun 20 Sep 2026)
        activity_a = _create_activity_at(
            api_client, prereqs, datetime(2026, 9, 14, 10, 0)
        )
        _create_activity_at(api_client, prereqs, datetime(2026, 9, 15, 11, 0))  # B
        _create_activity_at(
            api_client, prereqs, datetime(2026, 9, 16, 12, 0), is_private=True
        )

        # Target already holds a copy of B (same master/service/start+7d/duration)
        _create_activity_at(api_client, prereqs, datetime(2026, 9, 22, 11, 0))

        resp = api_client.post(
            "/api/v1/activities/copy-week",
            json=_copy_week_payload(locations=[prereqs["location_id"]]),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == {
            "copied": 1,
            "skipped_duplicates": 1,
            "skipped_filtered": 1,
            "skipped_no_master": 0,
        }

        # The copied row exists in the target week with shifted start
        listed = api_client.get(
            "/api/v1/activities",
            params={
                "date_from": "2026-09-21",
                "date_to": "2026-09-27",
            },
        )
        assert listed.status_code == 200, listed.text
        items = listed.json()["items"]
        assert len(items) == 2  # copied A + pre-existing B-clone
        copied = next(i for i in items if i["start"].startswith("2026-09-21T10:00"))
        assert copied["master_id"] == activity_a["master_id"]
        assert copied["service_id"] == activity_a["service_id"]
        assert copied["duration"] == activity_a["duration"]

    def test_copy_week_repeat_call_copies_zero(self, api_client) -> None:
        """Re-click with no edits → copied=0, everything is a duplicate (merge)."""
        prereqs = _create_prerequisites(api_client)
        _create_activity_at(api_client, prereqs, datetime(2026, 9, 14, 10, 0))
        payload = _copy_week_payload(locations=[prereqs["location_id"]])

        first = api_client.post("/api/v1/activities/copy-week", json=payload)
        assert first.status_code == 200, first.text
        assert first.json()["copied"] == 1

        second = api_client.post("/api/v1/activities/copy-week", json=payload)
        assert second.status_code == 200, second.text
        assert second.json() == {
            "copied": 0,
            "skipped_duplicates": 1,
            "skipped_filtered": 0,
            "skipped_no_master": 0,
        }


import asyncio  # noqa: E402


async def _insert_record_direct(activity_id: str) -> None:
    """Insert a Record directly into the database using the global db_manager."""
    from src.db import db_manager
    from src.models import Record

    async with db_manager.async_session() as session:
        record = Record(
            id=str(uuid.uuid4()),
            activity_id=activity_id,
            client_id=None,
            status="waiting",
            seats=1,
        )
        session.add(record)
        await session.commit()


class TestDeleteUsesHandwrittenService:
    """GH #286 D1 preview-only lock: DELETE /activities/{id} must keep
    going through the handwritten ``ActivityService.delete`` cascade —
    the generic resolver (``ArchiveService.resolve_delete``) must never
    run for activities (FK_MATRIX[Activity] entries are preview-only:
    consumed by collect, no handlers wired)."""

    def test_delete_goes_through_handwritten_service(
        self, api_client, create_activity, monkeypatch,
    ) -> None:
        from src.services.activity import ActivityService
        from src.services.generic import ArchiveService

        activity = create_activity()
        calls: list[str] = []
        original_delete = ActivityService.delete

        async def spy_delete(self, db_session, id):
            calls.append(f"handwritten:{id}")
            return await original_delete(self, db_session, id)

        async def forbidden_resolver(*args, **kwargs):
            calls.append("generic_resolver")
            return True

        monkeypatch.setattr(ActivityService, "delete", spy_delete)
        monkeypatch.setattr(ArchiveService, "resolve_delete", forbidden_resolver)

        # The unified contract (#286 D2): the commit of the deferred delete
        # carries the declared state — a bare DELETE is now 422.
        resp = api_client.request(
            "DELETE",
            f"/api/v1/activities/{activity['id']}",
            json={"expected": {}},
        )

        assert resp.status_code == 204, resp.text
        assert calls == [f"handwritten:{activity['id']}"]


def _link_activity_tag(api_client, activity_id: str, tag_name: str | None = None) -> str:
    """Insert an ``activity_tags`` join row directly via SQL and return the tag id.

    The tests do not exercise the tag-linking UI path, so the auto-cascade dep
    is seeded via ``query_db`` (FK-ON-safe: both ids exist)."""
    tag_name = tag_name or f"at-{activity_id[:8]}"
    tag_id = api_client.post("/api/v1/tags", json={"tag": tag_name}).json()["id"]
    query_db(
        f"INSERT INTO activity_tags (activity_id, tag_id) "
        f"VALUES ('{activity_id}', '{tag_id}')"
    )
    return tag_id


class TestDeleteDeferredContract:
    """DELETE /api/v1/activities/{id} — the unified deferred-delete contract
    (#286 D2), full mirror of the records route (GH #285 rev7/rev8).

    Modes:
      * ?dry_run=true — pure preview: collect_dependencies(Activity) →
        empty → 204 WITHOUT deleting; non-empty → 409 + tree (records node
        with per-row items + aggregated second-level visits/payments);
        missing → 404 (existence probe). Combined with ANY body → 422
        ``invalid_delete_request`` (checked before the probe).
      * No body, no flag → 422 ``EXPECTED_STATE_REQUIRED`` (ErrorDetail
        canon, #286 D2) — unconditional, rejected before any DB access.
      * Body ``{"expected": {records, visits, payments}}`` — the commit:
        probe → collect (recursive two-level subtree) → per-entity subset
        check (auto-excluded; an id of ANY node missing from expected →
        409 ``stale_dependencies`` + tree) → handwritten
        ``ActivityService.delete``. Fail-closed: a stale commit deletes
        nothing (no partial cascade).
    """

    # ── 422 branches (shape checks BEFORE any DB access) ──────────────────

    def test_bare_delete_no_flag_no_body_returns_422(
        self, api_client, create_activity,
    ) -> None:
        activity = create_activity()

        resp = api_client.delete(f"/api/v1/activities/{activity['id']}")

        assert resp.status_code == 422
        detail = resp.json()["detail"]
        assert detail["code"] == "EXPECTED_STATE_REQUIRED"
        assert detail["message"] == (
            ERROR_MESSAGES[ErrorCode.EXPECTED_STATE_REQUIRED]
        )
        # Row untouched.
        assert api_client.get(
            f"/api/v1/activities/{activity['id']}"
        ).status_code == 200

    def test_bare_delete_nonexistent_returns_422(self, api_client) -> None:
        """The request shape is rejected before any DB probe (not a 404)."""
        resp = api_client.delete("/api/v1/activities/nonexistent-id")
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "EXPECTED_STATE_REQUIRED"

    def test_dry_run_with_body_returns_422_invalid_delete_request(
        self, api_client, create_activity,
    ) -> None:
        """Pure preview never carries a body — combo checked before probe."""
        activity = create_activity()

        resp = api_client.request(
            "DELETE",
            f"/api/v1/activities/{activity['id']}",
            params={"dry_run": "true"},
            json={"expected": {}},
        )

        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "INVALID_DELETE_REQUEST"
        # Row untouched.
        assert api_client.get(
            f"/api/v1/activities/{activity['id']}"
        ).status_code == 200

    # ── dry-run preview (?dry_run=true — never modifies rows) ─────────────

    def test_dry_run_nonexistent_returns_404(self, api_client) -> None:
        """Existence probe (#285 pattern): a missing id → 404, not a lying
        204 (collect_dependencies would return [] for a missing id)."""
        resp = api_client.request(
            "DELETE",
            "/api/v1/activities/nonexistent-id",
            params={"dry_run": "true"},
        )
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "ACTIVITY_NOT_FOUND"

    def test_dry_run_empty_tree_returns_204_row_alive(
        self, api_client, create_activity,
    ) -> None:
        activity = create_activity()

        resp = api_client.request(
            "DELETE",
            f"/api/v1/activities/{activity['id']}",
            params={"dry_run": "true"},
        )

        assert resp.status_code == 204, resp.text
        assert resp.text == ""  # 204 — no body
        # Preview only: the activity is NOT deleted.
        assert api_client.get(
            f"/api/v1/activities/{activity['id']}"
        ).status_code == 200

    def test_dry_run_with_deps_returns_409_tree_with_items(
        self, api_client, create_activity, create_client,
    ) -> None:
        """409 has_dependencies + the two-level tree with items on the
        records node (and reused visit/payment builders); rows alive."""
        activity = create_activity()
        client = create_client(name="Алиса")
        record = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "client_id": client["id"],
            "visits": [{"name": "Гость", "price": 3500, "status": "waiting"}],
        }).json()
        record_id = record["id"]
        activity_id = activity["id"]
        service_title = api_client.get(
            f"/api/v1/services/{activity['service_id']}"
        ).json()["title"]
        payment = api_client.post("/api/v1/payments", json={
            "record_id": record_id, "amount": 1000, "method": "cash",
        }).json()

        resp = api_client.request(
            "DELETE",
            f"/api/v1/activities/{activity_id}",
            params={"dry_run": "true"},
        )

        assert resp.status_code == 409, resp.text
        body = resp.json()
        assert body["detail"] == "has_dependencies"
        deps = {d["entity"]: d for d in body["dependencies"]}
        assert set(deps) == {"records", "visits", "payments"}
        assert deps["records"]["count"] == 1
        assert deps["records"]["auto"] is False
        # Records label «{услуга}, {дата}, {клиент}» — service via the
        # activity's service, ISO date of the activity start (#286 D1;
        # exact-format pin lives in the domain label-builder tests).
        assert deps["records"]["items"] == [{
            "id": record_id,
            "label": (
                f"{service_title}, {activity['start'][:10]}, {client['name']}"
            ),
        }]
        # Visit/payment label-builders #285 reused as is: the price/method
        # parts are deterministic; the tariff resolution pin is in the
        # domain tests.
        visits_items = deps["visits"]["items"]
        assert [i["id"] for i in visits_items] == [record["visits"][0]["id"]]
        assert visits_items[0]["label"].endswith(", 3500")
        assert deps["payments"]["items"] == [
            {"id": payment["id"], "label": "1000, cash"}
        ]
        # Nothing deleted.
        assert api_client.get(
            f"/api/v1/activities/{activity_id}"
        ).status_code == 200
        assert api_client.get(f"/api/v1/records/{record_id}").status_code == 200

    # ── commit branch (body with expected id-sets) ─────────────────────────

    def test_delete_nonexistent_with_body_returns_404(self, api_client) -> None:
        """With body + nonexistent id → 404 (the probe fires first)."""
        resp = api_client.request(
            "DELETE",
            "/api/v1/activities/nonexistent-id",
            json={"expected": {}},
        )
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "ACTIVITY_NOT_FOUND"

    def test_delete_clean_activity_with_expected_empty_returns_204(
        self, api_client, create_activity,
    ) -> None:
        activity = create_activity()

        resp = api_client.request(
            "DELETE",
            f"/api/v1/activities/{activity['id']}",
            json={"expected": {}},
        )

        assert resp.status_code == 204, resp.text
        assert api_client.get(
            f"/api/v1/activities/{activity['id']}"
        ).status_code == 404

    def test_delete_cascade_with_matching_expected_returns_204(
        self, api_client, create_record,
    ) -> None:
        """Full confirmed tree → 204; the handwritten cascade removes the
        records + their visits/payments, unlinks photos, kills join rows."""
        record = create_record(visits=[
            {"name": "Гость", "price": 3500, "status": "waiting"},
            {"name": "Второй", "price": 2500, "status": "waiting"},
        ])
        record_id = record["id"]
        activity_id = record["activity_id"]
        visit_ids = [v["id"] for v in record["visits"]]
        payment = api_client.post("/api/v1/payments", json={
            "record_id": record_id, "amount": 3000, "method": "card",
        }).json()
        expected = {
            "records": [record_id],
            "visits": visit_ids,
            "payments": [payment["id"]],
        }

        resp = api_client.request(
            "DELETE",
            f"/api/v1/activities/{activity_id}",
            json={"expected": expected},
        )

        assert resp.status_code == 204, resp.text
        # Cascade executed: activity + record + visits + payments gone.
        assert api_client.get(
            f"/api/v1/activities/{activity_id}"
        ).status_code == 404
        assert api_client.get(f"/api/v1/records/{record_id}").status_code == 404
        for vid in visit_ids:
            assert query_db(f"SELECT * FROM visits WHERE id='{vid}'") == []
        assert query_db(
            f"SELECT * FROM payments WHERE id='{payment['id']}'"
        ) == []

    def test_expected_new_record_appeared_returns_409_nothing_deleted(
        self, api_client, create_activity, create_client,
    ) -> None:
        """A record landed in the undo window → 409 stale_dependencies;
        fail-closed: nothing is deleted (no partial cascade)."""
        activity = create_activity()
        client = create_client()
        record = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "client_id": client["id"],
            "visits": [],
        }).json()
        # The race: a second record appears before the commit.
        record2 = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "client_id": client["id"],
            "visits": [],
        }).json()
        assert record2["activity_id"] == activity["id"]

        resp = api_client.request(
            "DELETE",
            f"/api/v1/activities/{activity['id']}",
            json={"expected": {"records": [record["id"]]}},
        )

        assert resp.status_code == 409, resp.text
        body = resp.json()
        assert body["detail"] == "stale_dependencies"
        deps = {d["entity"]: d for d in body["dependencies"]}
        assert deps["records"]["count"] == 2
        assert deps["records"]["items"], "records node carries items"
        # Nothing deleted (fail-closed).
        assert api_client.get(
            f"/api/v1/activities/{activity['id']}"
        ).status_code == 200
        for rec in (record, record2):
            assert api_client.get(f"/api/v1/records/{rec['id']}").status_code == 200

    def test_expected_new_visit_in_confirmed_record_returns_409(
        self, api_client, create_record,
    ) -> None:
        """The nested-level race (#286 §4): a visit appeared inside an
        ALREADY-confirmed record → its id is missing from expected.visits
        → 409; the new visit survives."""
        record = create_record()
        record_id = record["id"]
        activity_id = record["activity_id"]
        visit_id = record["visits"][0]["id"]

        visitor = api_client.post("/api/v1/visitors", json={
            "client_id": record["client_id"], "name": "Carol", "age": 40,
        }).json()
        extra = api_client.post(
            "/api/v1/visits",
            json={
                "record_id": record_id,
                "visitor_id": visitor["id"],
                "price": 1500,
            },
        )
        assert extra.status_code == 201, extra.text
        extra_visit_id = extra.json()["id"]

        resp = api_client.request(
            "DELETE",
            f"/api/v1/activities/{activity_id}",
            json={
                "expected": {
                    "records": [record_id],
                    "visits": [visit_id],
                    "payments": [],
                },
            },
        )

        assert resp.status_code == 409, resp.text
        body = resp.json()
        assert body["detail"] == "stale_dependencies"
        deps = {d["entity"]: d for d in body["dependencies"]}
        assert deps["visits"]["count"] == 2
        assert deps["visits"]["items"], "visits node carries reused items"
        # Nothing deleted — the nested race never destroys new data.
        assert api_client.get(
            f"/api/v1/activities/{activity_id}"
        ).status_code == 200
        assert api_client.get(f"/api/v1/records/{record_id}").status_code == 200
        assert query_db(
            f"SELECT * FROM visits WHERE id='{extra_visit_id}'"
        ), "the mid-window visit must survive the stale commit"

    def test_expected_new_payment_appeared_returns_409(
        self, api_client, create_record,
    ) -> None:
        record = create_record(visits=[])
        record_id = record["id"]
        activity_id = record["activity_id"]
        api_client.post("/api/v1/payments", json={
            "record_id": record_id, "amount": 1000, "method": "cash",
        })

        resp = api_client.request(
            "DELETE",
            f"/api/v1/activities/{activity_id}",
            json={
                "expected": {"records": [record_id], "visits": [], "payments": []},
            },
        )

        assert resp.status_code == 409, resp.text
        body = resp.json()
        assert body["detail"] == "stale_dependencies"
        deps = {d["entity"]: d for d in body["dependencies"]}
        assert deps["payments"]["count"] == 1
        # Nothing deleted.
        assert api_client.get(
            f"/api/v1/activities/{activity_id}"
        ).status_code == 200
        assert query_db(
            f"SELECT * FROM payments WHERE record_id='{record_id}'"
        ), "payment must survive the stale commit"

    def test_expected_disappeared_deps_do_not_block_subset(
        self, api_client, create_record,
    ) -> None:
        """A visit deleted by a competitor mid-window does NOT block
        (subset, #285 D9a): expected carries its id, the commit deletes."""
        record = create_record(visits=[
            {"name": "Гость", "price": 3500, "status": "waiting"},
            {"name": "Второй", "price": 2500, "status": "waiting"},
        ])
        record_id = record["id"]
        activity_id = record["activity_id"]
        visit_ids = [v["id"] for v in record["visits"]]
        # The race, disappearing side: one visit is deleted before commit.
        del_resp = api_client.delete(f"/api/v1/visits/{visit_ids[1]}")
        assert del_resp.status_code == 204, del_resp.text

        resp = api_client.request(
            "DELETE",
            f"/api/v1/activities/{activity_id}",
            json={
                "expected": {
                    "records": [record_id],
                    "visits": visit_ids,
                    "payments": [],
                },
            },
        )

        assert resp.status_code == 204, resp.text
        assert api_client.get(
            f"/api/v1/activities/{activity_id}"
        ).status_code == 404

    def test_auto_tag_drift_excluded_from_check(
        self, api_client, create_record,
    ) -> None:
        """activity_tags (auto=True) are exempt: a mid-window tag link does
        not block the commit; the join rows die with the activity."""
        record = create_record(visits=[])
        activity_id = record["activity_id"]
        record_id = record["id"]
        expected = {"records": [record_id], "visits": [], "payments": []}
        # Mid-window: a tag link appears (auto dep).
        _link_activity_tag(api_client, activity_id, tag_name="drift")

        resp = api_client.request(
            "DELETE",
            f"/api/v1/activities/{activity_id}",
            json={"expected": expected},
        )

        assert resp.status_code == 204, resp.text
        assert api_client.get(
            f"/api/v1/activities/{activity_id}"
        ).status_code == 404
        assert query_db(
            f"SELECT * FROM activity_tags WHERE activity_id='{activity_id}'"
        ) == []
