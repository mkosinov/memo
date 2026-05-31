"""Tests for the Records + Visits CRUD API endpoints."""

import uuid

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

CLIENT_PAYLOAD = {
    "name": "Jane Doe",
    "phone": "+79991112233",
    "email": "jane@example.com",
    "channel": "email",
}

VISITOR_PAYLOAD = {"name": "Alice", "age": 28}


def _create_prerequisites(client: TestClient) -> dict:
    """Create master, service, location, client, and visitors; return IDs."""
    from datetime import UTC, datetime, timedelta

    master = client.post("/api/v1/masters", json=MASTER_PAYLOAD).json()
    service = client.post("/api/v1/services", json=SERVICE_PAYLOAD).json()
    location = client.post("/api/v1/locations", json=LOCATION_PAYLOAD).json()
    created_client = client.post("/api/v1/clients", json=CLIENT_PAYLOAD).json()

    # Create visitor linked to client
    visitor_data = {**VISITOR_PAYLOAD, "client_id": created_client["id"]}
    visitor1 = client.post("/api/v1/visitors", json=visitor_data).json()

    visitor2_data = {"name": "Bob", "age": 35, "client_id": created_client["id"]}
    visitor2 = client.post("/api/v1/visitors", json=visitor2_data).json()

    start = datetime.now(UTC) + timedelta(days=1)
    activity = client.post(
        "/api/v1/activities",
        json={
            "master_id": master["id"],
            "service_id": service["id"],
            "location_id": location["id"],
            "start": start.isoformat(),
            "duration": 90,
            "capacity": 10,
            "is_private": False,
        },
    ).json()

    return {
        "activity_id": activity["id"],
        "client_id": created_client["id"],
        "visitor_ids": [visitor1["id"], visitor2["id"]],
    }


def _record_create_payload(prereqs: dict, extra_visitors: list[dict] | None = None) -> dict:
    """Build a valid RecordCreate payload."""
    visits = [
        {"visitor_id": vid, "price": 1500, "status": "waiting"}
        for vid in prereqs["visitor_ids"]
    ]
    if extra_visitors:
        visits.extend(extra_visitors)
    return {
        "activity_id": prereqs["activity_id"],
        "client_id": prereqs["client_id"],
        "comment": "Test record",
        "visits": visits,
    }


class TestRecordsCrud:
    """Full CRUD round-trip for /api/records with nested visits."""

    def test_create_record_with_visits(self) -> None:
        """POST /api/records creates a record with visits, seats = len(visits)."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            prereqs = _create_prerequisites(client)
            payload = _record_create_payload(prereqs)

            response = client.post("/api/v1/records", json=payload)

        assert response.status_code == 201
        body = response.json()
        assert body["activity_id"] == prereqs["activity_id"]
        assert body["client_id"] == prereqs["client_id"]
        assert body["status"] == "pending"
        assert body["seats"] == len(prereqs["visitor_ids"])  # auto-calculated
        assert body["comment"] == "Test record"
        assert len(body["visits"]) == len(prereqs["visitor_ids"])
        assert body["visits"][0]["visitor_id"] == prereqs["visitor_ids"][0]
        assert body["visits"][0]["price"] == 1500
        assert body["visits"][0]["status"] == "waiting"
        assert "id" in body
        assert "created_at" in body
        assert body["is_active"] is True

    def test_list_records_includes_created(self) -> None:
        """GET /api/records returns a list containing created records with visits."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            prereqs = _create_prerequisites(client)
            payload = _record_create_payload(prereqs)
            create_resp = client.post("/api/v1/records", json=payload)
            record_id = create_resp.json()["id"]

            response = client.get("/api/v1/records")
            assert response.status_code == 200
            records = response.json()
            assert isinstance(records, list)
            ids = [r["id"] for r in records]
            assert record_id in ids
            # Verify visits are nested in list response
            found = next(r for r in records if r["id"] == record_id)
            assert len(found["visits"]) == len(prereqs["visitor_ids"])

    def test_get_record_by_id(self) -> None:
        """GET /api/records/{id} returns the specific record with nested visits."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            prereqs = _create_prerequisites(client)
            payload = _record_create_payload(prereqs)
            create_resp = client.post("/api/v1/records", json=payload)
            record_id = create_resp.json()["id"]

            response = client.get(f"/api/v1/records/{record_id}")
            assert response.status_code == 200
            body = response.json()
            assert body["id"] == record_id
            assert len(body["visits"]) == len(prereqs["visitor_ids"])

    def test_update_record_replaces_visits(self) -> None:
        """PUT /api/records/{id} replaces visits and recalculates seats."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            prereqs = _create_prerequisites(client)
            payload = _record_create_payload(prereqs)
            create_resp = client.post("/api/v1/records", json=payload)
            record_id = create_resp.json()["id"]

            # Update with different visits (only 1 visit now)
            update_payload = {
                "activity_id": prereqs["activity_id"],
                "client_id": prereqs["client_id"],
                "status": "confirmed",
                "comment": "Updated comment",
                "visits": [
                    {"visitor_id": prereqs["visitor_ids"][0], "price": 2000, "status": "visited"},
                ],
            }

            response = client.put(f"/api/v1/records/{record_id}", json=update_payload)
            assert response.status_code == 200
            body = response.json()
            assert body["status"] == "confirmed"
            assert body["comment"] == "Updated comment"
            assert body["seats"] == 1  # recalculated from len(visits)
            assert len(body["visits"]) == 1
            assert body["visits"][0]["price"] == 2000
            assert body["visits"][0]["status"] == "visited"

    def test_delete_record_soft_deletes(self) -> None:
        """DELETE /api/records/{id} soft-deletes and list excludes it."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            prereqs = _create_prerequisites(client)
            payload = _record_create_payload(prereqs)
            create_resp = client.post("/api/v1/records", json=payload)
            record_id = create_resp.json()["id"]

            # Delete
            response = client.delete(f"/api/v1/records/{record_id}")
            assert response.status_code == 204

            # GET by id should still return it (soft delete)
            response = client.get(f"/api/v1/records/{record_id}")
            assert response.status_code == 200
            assert response.json()["is_active"] is False

            # List should NOT include the deleted record
            response = client.get("/api/v1/records")
            records = response.json()
            ids = [r["id"] for r in records]
            assert record_id not in ids

    def test_get_nonexistent_record_returns_404(self) -> None:
        """GET /api/records/{fake_id} returns 404."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.get("/api/v1/records/nonexistent-id")
        assert response.status_code == 404

    def test_update_nonexistent_record_returns_404(self) -> None:
        """PUT /api/records/{fake_id} returns 404."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            prereqs = _create_prerequisites(client)
            update_payload = {
                "activity_id": prereqs["activity_id"],
                "client_id": prereqs["client_id"],
                "status": "confirmed",
                "visits": [],
            }
            response = client.put(
                "/api/v1/records/nonexistent-id", json=update_payload
            )
        assert response.status_code == 404

    def test_delete_nonexistent_record_returns_404(self) -> None:
        """DELETE /api/records/{fake_id} returns 404."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.delete("/api/v1/records/nonexistent-id")
        assert response.status_code == 404


class TestVisitsCrud:
    """CRUD tests for /api/visits endpoints."""

    def test_get_visit_by_id(self) -> None:
        """GET /api/visits/{id} returns the specific visit."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            prereqs = _create_prerequisites(client)
            record_payload = _record_create_payload(prereqs)
            record_resp = client.post("/api/v1/records", json=record_payload)
            visits = record_resp.json()["visits"]
            visit_id = visits[0]["id"]

            response = client.get(f"/api/v1/visits/{visit_id}")
            assert response.status_code == 200
            body = response.json()
            assert body["id"] == visit_id
            assert body["visitor_id"] == prereqs["visitor_ids"][0]
            assert body["price"] == 1500
            assert body["status"] == "waiting"

    def test_update_visit_status(self) -> None:
        """PUT /api/visits/{id}/status updates the visit status."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            prereqs = _create_prerequisites(client)
            record_payload = _record_create_payload(prereqs)
            record_resp = client.post("/api/v1/records", json=record_payload)
            visit_id = record_resp.json()["visits"][0]["id"]

            response = client.put(
                f"/api/v1/visits/{visit_id}/status",
                json={"status": "visited"},
            )
            assert response.status_code == 200
            body = response.json()
            assert body["id"] == visit_id
            assert body["status"] == "visited"

    def test_get_nonexistent_visit_returns_404(self) -> None:
        """GET /api/visits/{fake_id} returns 404."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.get("/api/v1/visits/nonexistent-id")
        assert response.status_code == 404

    def test_update_nonexistent_visit_status_returns_404(self) -> None:
        """PUT /api/visits/{fake_id}/status returns 404."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.put(
                "/api/v1/visits/nonexistent-id/status",
                json={"status": "visited"},
            )
        assert response.status_code == 404


class TestRecordCreatePhoneFlow:
    """Phone-based record creation flow — auto-creates client and visitors."""

    PHONE = "+79990001122"

    def _create_activity(self, client: TestClient) -> str:
        """Create master -> service -> location -> activity and return activity_id."""
        master = client.post("/api/v1/masters", json={
            "first_name": "Anna", "last_name": "Ivanova", "color": "#5B8C7A",
            "position": "senior", "specialty": "oil",
        }).json()
        service = client.post("/api/v1/services", json={
            "title": "Oil Painting", "description": "Learn oil painting",
            "image_url": "https://example.com/oil.jpg", "specialty": "oil",
            "min_age": 12, "max_age": 99, "duration": 90, "record_info": "Bring apron",
        }).json()
        location = client.post("/api/v1/locations", json={
            "name": "Studio 1", "address": "123 Main St", "capacity": 20,
        }).json()

        from datetime import UTC, datetime, timedelta
        start = datetime.now(UTC) + timedelta(days=1)
        activity = client.post("/api/v1/activities", json={
            "master_id": master["id"], "service_id": service["id"],
            "location_id": location["id"], "start": start.isoformat(),
            "duration": 90, "capacity": 10, "is_private": False,
        }).json()
        return activity["id"]

    def test_create_record_with_phone_creates_client_and_visitors(self) -> None:
        """POST /api/records with phone auto-creates client and visitors."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            activity_id = self._create_activity(client)
            payload = {
                "activity_id": activity_id,
                "phone": self.PHONE,
                "comment": "Phone-based booking",
                "visits": [
                    {"name": "Alice", "age": 28, "price": 1500},
                    {"name": "Bob", "age": 35, "price": 1500},
                ],
            }

            response = client.post("/api/v1/records", json=payload)

            assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
            body = response.json()
            assert body["activity_id"] == activity_id
            assert body["client_id"] is not None  # auto-created client
            assert body["status"] == "pending"
            assert body["seats"] == 2
            assert body["comment"] == "Phone-based booking"
            assert len(body["visits"]) == 2

            # Verify client was created with the phone
            client_resp = client.get(f"/api/v1/clients/{body['client_id']}")
            assert client_resp.status_code == 200
            assert client_resp.json()["phone"] == self.PHONE

            # Verify visitors were created
            for visit in body["visits"]:
                visitor_resp = client.get(f"/api/v1/visitors/{visit['visitor_id']}")
                assert visitor_resp.status_code == 200

    def test_create_record_with_phone_existing_client(self) -> None:
        """POST /api/records with phone reuses existing client."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            # First create a client
            created = client.post("/api/v1/clients", json={
                "name": "Existing", "phone": self.PHONE,
                "email": "existing@example.com", "channel": "website",
            }).json()
            existing_client_id = created["id"]

            activity_id = self._create_activity(client)
            payload = {
                "activity_id": activity_id,
                "phone": self.PHONE,
                "comment": "Existing client booking",
                "visits": [
                    {"name": "Charlie", "age": 10, "price": 2000},
                ],
            }

            response = client.post("/api/v1/records", json=payload)
            assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
            body = response.json()
            assert body["client_id"] == existing_client_id  # reused existing client
            assert body["seats"] == 1

    def test_create_record_with_phone_and_empty_visits(self) -> None:
        """POST /api/records with phone and empty visits creates record with 0 seats."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            activity_id = self._create_activity(client)
            payload = {
                "activity_id": activity_id,
                "phone": self.PHONE,
                "visits": [],
            }

            response = client.post("/api/v1/records", json=payload)
            assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
            body = response.json()
            assert body["seats"] == 0
            assert body["visits"] == []
