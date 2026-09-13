"""Tests for the Activities CRUD API endpoints with date filtering and occupied."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

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
    "name": "Studio 1",
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
