"""Tests for the Activities CRUD API endpoints with date filtering and occupied."""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

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


def _create_prerequisites(client: TestClient) -> dict:
    """Create master, service, location and return their IDs."""
    master = client.post("/api/masters", json=MASTER_PAYLOAD).json()
    service = client.post("/api/services", json=SERVICE_PAYLOAD).json()
    location = client.post("/api/locations", json=LOCATION_PAYLOAD).json()
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

    def test_create_activity(self) -> None:
        """POST /api/activities creates an activity and returns 201."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            prereqs = _create_prerequisites(client)
            response = client.post(
                "/api/activities",
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

    def test_list_activities_includes_created(self) -> None:
        """GET /api/activities returns a list containing the created activity."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            prereqs = _create_prerequisites(client)
            create_resp = client.post(
                "/api/activities", json=_activity_payload(prereqs)
            )
            activity_id = create_resp.json()["id"]

            response = client.get("/api/activities")
            assert response.status_code == 200
            activities = response.json()
            assert isinstance(activities, list)
            ids = [a["id"] for a in activities]
            assert activity_id in ids

    def test_get_activity_by_id(self) -> None:
        """GET /api/activities/{id} returns the specific activity."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            prereqs = _create_prerequisites(client)
            create_resp = client.post(
                "/api/activities", json=_activity_payload(prereqs)
            )
            activity_id = create_resp.json()["id"]

            response = client.get(f"/api/activities/{activity_id}")
            assert response.status_code == 200
            body = response.json()
            assert body["id"] == activity_id
            assert body["occupied"] == 0

    def test_update_activity(self) -> None:
        """PUT /api/activities/{id} updates all fields."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            prereqs = _create_prerequisites(client)
            create_resp = client.post(
                "/api/activities", json=_activity_payload(prereqs)
            )
            activity_id = create_resp.json()["id"]

            tomorrow = datetime.now(UTC) + timedelta(days=2)
            update_data = _activity_payload(prereqs, start=tomorrow)
            update_data["duration"] = 120
            update_data["capacity"] = 15
            update_data["is_private"] = True
            update_data["comment"] = "Updated comment"

            response = client.put(
                f"/api/activities/{activity_id}", json=update_data
            )
            assert response.status_code == 200
            body = response.json()
            assert body["duration"] == 120
            assert body["capacity"] == 15
            assert body["is_private"] is True
            assert body["comment"] == "Updated comment"

    def test_delete_activity_soft_deletes(self) -> None:
        """DELETE /api/activities/{id} soft-deletes and list excludes it."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            prereqs = _create_prerequisites(client)
            create_resp = client.post(
                "/api/activities", json=_activity_payload(prereqs)
            )
            activity_id = create_resp.json()["id"]

            # Delete
            response = client.delete(f"/api/activities/{activity_id}")
            assert response.status_code == 204

            # GET by id should still return it (soft delete)
            response = client.get(f"/api/activities/{activity_id}")
            assert response.status_code == 200
            assert response.json()["is_active"] is False

            # List should NOT include the deleted activity
            response = client.get("/api/activities")
            activities = response.json()
            ids = [a["id"] for a in activities]
            assert activity_id not in ids

    def test_get_nonexistent_activity_returns_404(self) -> None:
        """GET /api/activities/{fake_id} returns 404."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.get("/api/activities/nonexistent-id")
        assert response.status_code == 404

    def test_update_nonexistent_activity_returns_404(self) -> None:
        """PUT /api/activities/{fake_id} returns 404."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            prereqs = _create_prerequisites(client)
            response = client.put(
                "/api/activities/nonexistent-id",
                json=_activity_payload(prereqs),
            )
        assert response.status_code == 404

    def test_delete_nonexistent_activity_returns_404(self) -> None:
        """DELETE /api/activities/{fake_id} returns 404."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.delete("/api/activities/nonexistent-id")
        assert response.status_code == 404


class TestActivitiesDateFiltering:
    """Date range filtering on /api/activities."""

    def test_list_activities_with_date_range(self) -> None:
        """GET /api/activities?date_from=...&date_to=... filters by date range."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            prereqs = _create_prerequisites(client)

            # Create activities on different dates
            today = datetime.now(UTC).replace(hour=10, minute=0, second=0, microsecond=0)
            tomorrow = today + timedelta(days=1)
            next_week = today + timedelta(days=7)

            client.post("/api/activities", json=_activity_payload(prereqs, start=today))
            client.post("/api/activities", json=_activity_payload(prereqs, start=tomorrow))
            client.post("/api/activities", json=_activity_payload(prereqs, start=next_week))

            # Filter: only today and tomorrow
            response = client.get(
                "/api/activities",
                params={
                    "date_from": today.strftime("%Y-%m-%d"),
                    "date_to": tomorrow.strftime("%Y-%m-%d"),
                },
            )
            assert response.status_code == 200
            activities = response.json()
            assert len(activities) == 2

    def test_list_activities_no_date_filter_returns_all(self) -> None:
        """GET /api/activities without date params returns all active activities."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            prereqs = _create_prerequisites(client)

            today = datetime.now(UTC).replace(hour=10, minute=0, second=0, microsecond=0)
            next_week = today + timedelta(days=7)

            client.post("/api/activities", json=_activity_payload(prereqs, start=today))
            client.post("/api/activities", json=_activity_payload(prereqs, start=next_week))

            response = client.get("/api/activities")
            assert response.status_code == 200
            activities = response.json()
            assert len(activities) == 2


class TestActivitiesOccupied:
    """Occupied field computation (count of Records)."""

    def test_activity_occupied_increases_with_records(self) -> None:
        """GET /api/activities/{id} shows occupied=1 after creating a Record."""
        import asyncio

        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            prereqs = _create_prerequisites(client)

            # Create activity
            create_resp = client.post(
                "/api/activities", json=_activity_payload(prereqs)
            )
            activity_id = create_resp.json()["id"]

            # Verify occupied=0
            response = client.get(f"/api/activities/{activity_id}")
            assert response.json()["occupied"] == 0

            # Insert record directly into DB
            asyncio.run(
                _insert_record_direct(
                    activity_id=activity_id,
                )
            )

            # Verify occupied=1
            response = client.get(f"/api/activities/{activity_id}")
            assert response.status_code == 200
            assert response.json()["occupied"] == 1


async def _insert_record_direct(activity_id: str) -> None:
    """Insert a Record directly into the database using the app's shared manager."""
    import app.db.database as db_module
    from app.db.models.record import Record

    if db_module._manager is None:
        raise RuntimeError("Database manager not initialized")

    async with db_module._manager.session() as session:
        record = Record(
            id=str(uuid.uuid4()),
            activity_id=activity_id,
            client_id=None,
            status="confirmed",
            seats=1,
        )
        session.add(record)
