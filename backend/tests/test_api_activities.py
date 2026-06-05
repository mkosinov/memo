"""Tests for the Activities CRUD API endpoints with date filtering and occupied."""

import uuid
from datetime import UTC, datetime, timedelta

# --- Prerequisite payloads ---
MASTER_PAYLOAD = {
    "first_name": "Anna",
    "last_name": "Ivanova",
    "color": "#5B8C7A",
    "position": "senior",
    "specialty": "oil",
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
    master = api_client.post("/api/v1/masters", json=MASTER_PAYLOAD).json()
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


class TestActivitiesCrud:
    """Full CRUD round-trip for /api/activities."""

    def test_create_activity(self, api_client) -> None:
        """POST /api/activities creates an activity and returns 201."""
        prereqs = _create_prerequisites(api_client)
        response = api_client.post(
            "/api/v1/activities",
            json=_activity_payload(prereqs),
        )

        assert response.status_code == 201
        body = response.json()
        assert body["master_id"] == prereqs["master_id"]
        assert body["service_id"] == prereqs["service_id"]
        assert body["location_id"] == prereqs["location_id"]
        assert body["duration"] == 90
        assert body["capacity"] == 10
        assert body["is_private"] is False
        assert body["occupied"] == 0
        assert "id" in body
        assert "created_at" in body
        assert body["is_active"] is True

    def test_list_activities_includes_created(self, api_client) -> None:
        """GET /api/activities returns a list containing the created activity."""
        prereqs = _create_prerequisites(api_client)
        create_resp = api_client.post(
            "/api/v1/activities", json=_activity_payload(prereqs)
        )
        activity_id = create_resp.json()["id"]

        response = api_client.get("/api/v1/activities")
        assert response.status_code == 200
        activities = response.json()
        assert isinstance(activities, list)
        ids = [a["id"] for a in activities]
        assert activity_id in ids

    def test_get_activity_by_id(self, api_client) -> None:
        """GET /api/activities/{id} returns the specific activity."""
        prereqs = _create_prerequisites(api_client)
        create_resp = api_client.post(
            "/api/v1/activities", json=_activity_payload(prereqs)
        )
        activity_id = create_resp.json()["id"]

        response = api_client.get(f"/api/v1/activities/{activity_id}")
        assert response.status_code == 200
        body = response.json()
        assert body["id"] == activity_id
        assert body["occupied"] == 0

    def test_update_activity(self, api_client) -> None:
        """PUT /api/activities/{id} updates all fields."""
        prereqs = _create_prerequisites(api_client)
        create_resp = api_client.post(
            "/api/v1/activities", json=_activity_payload(prereqs)
        )
        activity_id = create_resp.json()["id"]

        tomorrow = datetime.now(UTC) + timedelta(days=2)
        update_data = _activity_payload(prereqs, start=tomorrow)
        update_data["duration"] = 120
        update_data["capacity"] = 15
        update_data["is_private"] = True
        update_data["comment"] = "Updated comment"

        response = api_client.put(
            f"/api/v1/activities/{activity_id}", json=update_data
        )
        assert response.status_code == 200
        body = response.json()
        assert body["duration"] == 120
        assert body["capacity"] == 15
        assert body["is_private"] is True
        assert body["comment"] == "Updated comment"

    def test_delete_activity_soft_deletes(self, api_client) -> None:
        """DELETE /api/activities/{id} soft-deletes and list excludes it."""
        prereqs = _create_prerequisites(api_client)
        create_resp = api_client.post(
            "/api/v1/activities", json=_activity_payload(prereqs)
        )
        activity_id = create_resp.json()["id"]

        # Delete
        response = api_client.delete(f"/api/v1/activities/{activity_id}")
        assert response.status_code == 204

        # GET by id should still return it (soft delete)
        response = api_client.get(f"/api/v1/activities/{activity_id}")
        assert response.status_code == 200
        assert response.json()["is_active"] is False

        # List should NOT include the deleted activity
        response = api_client.get("/api/v1/activities")
        activities = response.json()
        ids = [a["id"] for a in activities]
        assert activity_id not in ids

    def test_get_nonexistent_activity_returns_404(self, api_client) -> None:
        """GET /api/activities/{fake_id} returns 404."""
        response = api_client.get("/api/v1/activities/nonexistent-id")
        assert response.status_code == 404

    def test_update_nonexistent_activity_returns_404(self, api_client) -> None:
        """PUT /api/activities/{fake_id} returns 404."""
        prereqs = _create_prerequisites(api_client)
        response = api_client.put(
            "/api/v1/activities/nonexistent-id",
            json=_activity_payload(prereqs),
        )
        assert response.status_code == 404

    def test_delete_nonexistent_activity_returns_404(self, api_client) -> None:
        """DELETE /api/activities/{fake_id} returns 404."""
        response = api_client.delete("/api/v1/activities/nonexistent-id")
        assert response.status_code == 404

    def test_patch_activity_partial_update(self, api_client) -> None:
        """PATCH /api/activities/{id} applies partial updates only."""
        prereqs = _create_prerequisites(api_client)
        create_resp = api_client.post(
            "/api/v1/activities", json=_activity_payload(prereqs)
        )
        activity_id = create_resp.json()["id"]

        # Patch only duration
        response = api_client.patch(
            f"/api/v1/activities/{activity_id}",
            json={"duration": 180},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["duration"] == 180
        # Other fields should remain unchanged
        assert body["capacity"] == 10
        assert body["is_private"] is False

    def test_patch_nonexistent_activity_returns_404(self, api_client) -> None:
        """PATCH /api/activities/{fake_id} returns 404."""
        response = api_client.patch(
            "/api/v1/activities/nonexistent-id",
            json={"duration": 180},
        )
        assert response.status_code == 404


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
        activities = response.json()
        assert len(activities) == 2

    def test_list_activities_no_date_filter_returns_all(self, api_client) -> None:
        """GET /api/activities without date params returns all active activities."""
        prereqs = _create_prerequisites(api_client)

        today = datetime.now(UTC).replace(hour=10, minute=0, second=0, microsecond=0)
        next_week = today + timedelta(days=7)

        api_client.post("/api/v1/activities", json=_activity_payload(prereqs, start=today))
        api_client.post("/api/v1/activities", json=_activity_payload(prereqs, start=next_week))

        response = api_client.get("/api/v1/activities")
        assert response.status_code == 200
        activities = response.json()
        assert len(activities) == 2


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
            status="confirmed",
            seats=1,
        )
        session.add(record)
        await session.commit()
