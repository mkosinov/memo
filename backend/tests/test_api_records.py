"""Tests for the Records + Visits CRUD API endpoints."""

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient


class TestRecordsCrud:
    """Full CRUD round-trip for /api/records with nested visits."""

    def test_create_record_with_visits(self, api_client, create_activity, create_client) -> None:
        """POST /api/records creates a record with visits, seats = len(visits)."""
        activity = create_activity()
        client = create_client()

        # Create 2 visitors for this client
        v1 = api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Alice", "age": 28,
        }).json()
        v2 = api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Bob", "age": 35,
        }).json()

        payload = {
            "activity_id": activity["id"],
            "client_id": client["id"],
            "comment": "Test record",
            "visits": [
                {"visitor_id": v1["id"], "price": 1500, "status": "waiting"},
                {"visitor_id": v2["id"], "price": 1500, "status": "waiting"},
            ],
        }

        response = api_client.post("/api/v1/records", json=payload)

        assert response.status_code == 201
        body = response.json()
        assert body["activity_id"] == activity["id"]
        assert body["client_id"] == client["id"]
        assert body["status"] == "pending"
        assert body["seats"] == 2  # auto-calculated from len(visits)
        assert body["comment"] == "Test record"
        assert len(body["visits"]) == 2
        assert body["visits"][0]["visitor_id"] == v1["id"]
        assert body["visits"][0]["price"] == 1500
        assert body["visits"][0]["status"] == "waiting"
        assert "id" in body
        assert "created_at" in body
        assert body["is_active"] is True

    def test_list_records_includes_created(self, api_client, create_activity, create_client) -> None:
        """GET /api/records returns a list containing created records with visits."""
        activity = create_activity()
        client = create_client()

        v1 = api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Alice", "age": 28,
        }).json()
        v2 = api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Bob", "age": 35,
        }).json()

        payload = {
            "activity_id": activity["id"],
            "client_id": client["id"],
            "comment": "Test record",
            "visits": [
                {"visitor_id": v1["id"], "price": 1500, "status": "waiting"},
                {"visitor_id": v2["id"], "price": 1500, "status": "waiting"},
            ],
        }
        create_resp = api_client.post("/api/v1/records", json=payload)
        record_id = create_resp.json()["id"]

        response = api_client.get("/api/v1/records")
        assert response.status_code == 200
        records = response.json()
        assert isinstance(records, list)
        ids = [r["id"] for r in records]
        assert record_id in ids
        # Verify visits are nested in list response
        found = next(r for r in records if r["id"] == record_id)
        assert len(found["visits"]) == 2

    def test_get_record_by_id(self, api_client, create_activity, create_client) -> None:
        """GET /api/records/{id} returns the specific record with nested visits."""
        activity = create_activity()
        client = create_client()

        v1 = api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Alice", "age": 28,
        }).json()
        v2 = api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Bob", "age": 35,
        }).json()

        payload = {
            "activity_id": activity["id"],
            "client_id": client["id"],
            "comment": "Test record",
            "visits": [
                {"visitor_id": v1["id"], "price": 1500, "status": "waiting"},
                {"visitor_id": v2["id"], "price": 1500, "status": "waiting"},
            ],
        }
        create_resp = api_client.post("/api/v1/records", json=payload)
        record_id = create_resp.json()["id"]

        response = api_client.get(f"/api/v1/records/{record_id}")
        assert response.status_code == 200
        body = response.json()
        assert body["id"] == record_id
        assert len(body["visits"]) == 2

    def test_update_record_replaces_visits(self, api_client, create_activity, create_client) -> None:
        """PUT /api/records/{id} replaces visits and recalculates seats."""
        activity = create_activity()
        client = create_client()

        v1 = api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Alice", "age": 28,
        }).json()
        v2 = api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Bob", "age": 35,
        }).json()

        payload = {
            "activity_id": activity["id"],
            "client_id": client["id"],
            "comment": "Test record",
            "visits": [
                {"visitor_id": v1["id"], "price": 1500, "status": "waiting"},
                {"visitor_id": v2["id"], "price": 1500, "status": "waiting"},
            ],
        }
        create_resp = api_client.post("/api/v1/records", json=payload)
        record_id = create_resp.json()["id"]

        # Update with different visits (only 1 visit now)
        update_payload = {
            "activity_id": activity["id"],
            "client_id": client["id"],
            "status": "confirmed",
            "comment": "Updated comment",
            "visits": [
                {"visitor_id": v1["id"], "price": 2000, "status": "visited"},
            ],
        }

        response = api_client.put(f"/api/v1/records/{record_id}", json=update_payload)
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "confirmed"
        assert body["comment"] == "Updated comment"
        assert body["seats"] == 1  # recalculated from len(visits)
        assert len(body["visits"]) == 1
        assert body["visits"][0]["price"] == 2000
        assert body["visits"][0]["status"] == "visited"

    def test_delete_record_soft_deletes(self, api_client, create_activity, create_client) -> None:
        """DELETE /api/records/{id} soft-deletes and list excludes it."""
        activity = create_activity()
        client = create_client()

        v1 = api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Alice", "age": 28,
        }).json()
        v2 = api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Bob", "age": 35,
        }).json()

        payload = {
            "activity_id": activity["id"],
            "client_id": client["id"],
            "comment": "Test record",
            "visits": [
                {"visitor_id": v1["id"], "price": 1500, "status": "waiting"},
                {"visitor_id": v2["id"], "price": 1500, "status": "waiting"},
            ],
        }
        create_resp = api_client.post("/api/v1/records", json=payload)
        record_id = create_resp.json()["id"]

        # Delete
        response = api_client.delete(f"/api/v1/records/{record_id}")
        assert response.status_code == 204

        # GET by id should still return it (soft delete)
        response = api_client.get(f"/api/v1/records/{record_id}")
        assert response.status_code == 200
        assert response.json()["is_active"] is False

        # List should NOT include the deleted record
        response = api_client.get("/api/v1/records")
        records = response.json()
        ids = [r["id"] for r in records]
        assert record_id not in ids

    def test_get_nonexistent_record_returns_404(self, api_client) -> None:
        """GET /api/records/{fake_id} returns 404."""
        response = api_client.get("/api/v1/records/nonexistent-id")
        assert response.status_code == 404

    def test_update_nonexistent_record_returns_404(self, api_client, create_activity, create_client) -> None:
        """PUT /api/records/{fake_id} returns 404."""
        activity = create_activity()
        client = create_client()
        update_payload = {
            "activity_id": activity["id"],
            "client_id": client["id"],
            "status": "confirmed",
            "visits": [],
        }
        response = api_client.put(
            "/api/v1/records/nonexistent-id", json=update_payload
        )
        assert response.status_code == 404

    def test_delete_nonexistent_record_returns_404(self, api_client) -> None:
        """DELETE /api/records/{fake_id} returns 404."""
        response = api_client.delete("/api/v1/records/nonexistent-id")
        assert response.status_code == 404


class TestVisitsCrud:
    """CRUD tests for /api/visits endpoints."""

    def test_get_visit_by_id(self, api_client, create_activity, create_client) -> None:
        """GET /api/visits/{id} returns the specific visit."""
        activity = create_activity()
        client = create_client()

        v1 = api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Alice", "age": 28,
        }).json()
        v2 = api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Bob", "age": 35,
        }).json()

        record_resp = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "client_id": client["id"],
            "comment": "Test record",
            "visits": [
                {"visitor_id": v1["id"], "price": 1500, "status": "waiting"},
                {"visitor_id": v2["id"], "price": 1500, "status": "waiting"},
            ],
        })
        visits = record_resp.json()["visits"]
        visit_id = visits[0]["id"]

        response = api_client.get(f"/api/v1/visits/{visit_id}")
        assert response.status_code == 200
        body = response.json()
        assert body["id"] == visit_id
        assert body["visitor_id"] == v1["id"]
        assert body["price"] == 1500
        assert body["status"] == "waiting"

    def test_update_visit_status(self, api_client, create_activity, create_client) -> None:
        """PUT /api/visits/{id}/status updates the visit status."""
        activity = create_activity()
        client = create_client()

        v1 = api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Alice", "age": 28,
        }).json()
        v2 = api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Bob", "age": 35,
        }).json()

        record_resp = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "client_id": client["id"],
            "comment": "Test record",
            "visits": [
                {"visitor_id": v1["id"], "price": 1500, "status": "waiting"},
                {"visitor_id": v2["id"], "price": 1500, "status": "waiting"},
            ],
        })
        visit_id = record_resp.json()["visits"][0]["id"]

        response = api_client.put(
            f"/api/v1/visits/{visit_id}/status",
            json={"status": "visited"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["id"] == visit_id
        assert body["status"] == "visited"

    def test_get_nonexistent_visit_returns_404(self, api_client) -> None:
        """GET /api/visits/{fake_id} returns 404."""
        response = api_client.get("/api/v1/visits/nonexistent-id")
        assert response.status_code == 404

    def test_update_nonexistent_visit_status_returns_404(self, api_client) -> None:
        """PUT /api/visits/{fake_id}/status returns 404."""
        response = api_client.put(
            "/api/v1/visits/nonexistent-id/status",
            json={"status": "visited"},
        )
        assert response.status_code == 404


class TestRecordCreatePhoneFlow:
    """Phone-based record creation flow — auto-creates client and visitors."""

    PHONE = "+79990001122"

    def test_create_record_with_phone_creates_client_and_visitors(self, api_client, create_activity) -> None:
        """POST /api/records with phone auto-creates client and visitors."""
        activity = create_activity()
        payload = {
            "activity_id": activity["id"],
            "phone": self.PHONE,
            "comment": "Phone-based booking",
            "visits": [
                {"name": "Alice", "age": 28, "price": 1500},
                {"name": "Bob", "age": 35, "price": 1500},
            ],
        }

        response = api_client.post("/api/v1/records", json=payload)

        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
        body = response.json()
        assert body["activity_id"] == activity["id"]
        assert body["client_id"] is not None  # auto-created client
        assert body["status"] == "pending"
        assert body["seats"] == 2
        assert body["comment"] == "Phone-based booking"
        assert len(body["visits"]) == 2

        # Verify client was created with the phone
        client_resp = api_client.get(f"/api/v1/clients/{body['client_id']}")
        assert client_resp.status_code == 200
        assert client_resp.json()["phone"] == self.PHONE

        # Verify visitors were created
        for visit in body["visits"]:
            visitor_resp = api_client.get(f"/api/v1/visitors/{visit['visitor_id']}")
            assert visitor_resp.status_code == 200

    def test_create_record_with_phone_existing_client(self, api_client, create_activity) -> None:
        """POST /api/records with phone reuses existing client."""
        # First create a client
        created = api_client.post("/api/v1/clients", json={
            "name": "Existing", "phone": self.PHONE,
            "email": "existing@example.com", "channel": "whatsapp",
        }).json()
        existing_client_id = created["id"]

        activity = create_activity()
        payload = {
            "activity_id": activity["id"],
            "phone": self.PHONE,
            "comment": "Existing client booking",
            "visits": [
                {"name": "Charlie", "age": 10, "price": 2000},
            ],
        }

        response = api_client.post("/api/v1/records", json=payload)
        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
        body = response.json()
        assert body["client_id"] == existing_client_id  # reused existing client
        assert body["seats"] == 1

    def test_create_record_with_phone_and_empty_visits(self, api_client, create_activity) -> None:
        """POST /api/records with phone and empty visits creates record with 0 seats."""
        activity = create_activity()
        payload = {
            "activity_id": activity["id"],
            "phone": self.PHONE,
            "visits": [],
        }

        response = api_client.post("/api/v1/records", json=payload)
        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
        body = response.json()
        assert body["seats"] == 0
        assert body["visits"] == []
