"""Tests for the Records + Visits CRUD API endpoints."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.api


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
                {"visitor_id": v1["id"], "price": 1500},
                {"visitor_id": v2["id"], "price": 1500},
            ],
        }

        response = api_client.post("/api/v1/records", json=payload)

        assert response.status_code == 201
        body = response.json()
        assert body["activity_id"] == activity["id"]
        assert body["client_id"] == client["id"]
        assert body["status"] == "waiting"  # derived from visits (all waiting)
        assert body["seats"] == 2  # auto-calculated from len(visits)
        assert body["comment"] == "Test record"
        assert len(body["visits"]) == 2
        assert body["visits"][0]["visitor_id"] == v1["id"]
        assert body["visits"][0]["price"] == 1500
        assert body["visits"][0]["status"] == "waiting"
        assert "id" in body
        assert "created_at" in body

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
                {"visitor_id": v1["id"], "price": 1500},
                {"visitor_id": v2["id"], "price": 1500},
            ],
        }
        create_resp = api_client.post("/api/v1/records", json=payload)
        record_id = create_resp.json()["id"]

        response = api_client.get("/api/v1/records")
        assert response.status_code == 200
        body = response.json()
        records = body["items"]
        assert body["total"] >= 1
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
                {"visitor_id": v1["id"], "price": 1500},
                {"visitor_id": v2["id"], "price": 1500},
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
                {"visitor_id": v1["id"], "price": 1500},
                {"visitor_id": v2["id"], "price": 1500},
            ],
        }
        create_resp = api_client.post("/api/v1/records", json=payload)
        record_id = create_resp.json()["id"]

        # Update with different visits (only 1 visit now)
        update_payload = {
            "activity_id": activity["id"],
            "client_id": client["id"],
            "comment": "Updated comment",
            "visits": [
                {"visitor_id": v1["id"], "price": 2000, "status": "visited"},
            ],
        }

        response = api_client.put(f"/api/v1/records/{record_id}", json=update_payload)
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "visited"  # derived: 1 visit with visited
        assert body["comment"] == "Updated comment"
        assert body["seats"] == 1  # recalculated from len(visits)
        assert len(body["visits"]) == 1
        assert body["visits"][0]["price"] == 2000
        assert body["visits"][0]["status"] == "visited"

    def test_delete_record_hard_deletes(self, api_client, create_activity, create_client) -> None:
        """DELETE /api/records/{id} hard-deletes; GET by id returns 404 and list excludes it."""
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
                {"visitor_id": v1["id"], "price": 1500},
                {"visitor_id": v2["id"], "price": 1500},
            ],
        }
        create_resp = api_client.post("/api/v1/records", json=payload)
        record_id = create_resp.json()["id"]

        # Delete
        response = api_client.delete(f"/api/v1/records/{record_id}")
        assert response.status_code == 204

        # Hard-delete: GET by id returns 404
        response = api_client.get(f"/api/v1/records/{record_id}")
        assert response.status_code == 404

        # List should NOT include the deleted record
        response = api_client.get("/api/v1/records")
        body = response.json()
        ids = [r["id"] for r in body["items"]]
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
                {"visitor_id": v1["id"], "price": 1500},
                {"visitor_id": v2["id"], "price": 1500},
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
                {"visitor_id": v1["id"], "price": 1500},
                {"visitor_id": v2["id"], "price": 1500},
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


class TestRecordPatch:
    """PATCH /api/records/{id} partial update tests."""

    def test_patch_nonexistent_record_returns_404(self, api_client) -> None:
        """PATCH /api/records/{fake_id} returns 404."""
        response = api_client.patch(
            "/api/v1/records/nonexistent-id",
            json={"comment": "test"},
        )
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "RECORD_NOT_FOUND"

    def test_patch_custom_price_null_clears(self, api_client, create_record) -> None:
        """PATCH {"custom_price": null} clears custom_price (nullable field)."""
        record = create_record(custom_price=5000)
        assert record["custom_price"] == 5000

        response = api_client.patch(
            f"/api/v1/records/{record['id']}",
            json={"custom_price": None},
        )
        assert response.status_code == 200
        assert response.json()["custom_price"] is None

    def test_patch_record_empty_body_noop(self, api_client, create_record) -> None:
        """PATCH {} leaves scalar fields unchanged.

        Note: RecordService.patch() always advances updated_at (it sets
        ``record.updated_at = datetime.now(UTC)`` unconditionally), so
        updated_at is NOT expected to remain unchanged here.
        """
        record = create_record(comment="original comment", custom_price=3000)

        response = api_client.patch(f"/api/v1/records/{record['id']}", json={})
        assert response.status_code == 200
        patched = response.json()

        assert patched["comment"] == "original comment"
        assert patched["custom_price"] == 3000
        assert patched["seats"] == record["seats"]
        assert patched["anonym_visits"] == record["anonym_visits"]
        assert patched["status"] == record["status"]

    def test_patch_record_advances_updated_at(self, api_client, create_record) -> None:
        """PATCH always advances updated_at (set unconditionally in RecordService.patch)."""
        import time

        record = create_record()
        original_updated_at = record["updated_at"]

        # Small delay to ensure timestamp differs
        time.sleep(0.05)

        response = api_client.patch(
            f"/api/v1/records/{record['id']}",
            json={"comment": "touched"},
        )
        assert response.status_code == 200
        patched_updated_at = response.json()["updated_at"]

        assert patched_updated_at > original_updated_at, (
            f"updated_at did not advance: {patched_updated_at} <= {original_updated_at}"
        )


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
        assert body["status"] == "waiting"  # derived: 2 visits, all waiting
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


class TestAnonymVisits:
    """Tests for the anonym_visits field on Record (#82)."""

    def test_create_record_with_anonym_visits_only(self, api_client, create_activity, create_client) -> None:
        """POST /api/records with anonym_visits=5, visits=[] → seats=5."""
        activity = create_activity()
        client = create_client()
        payload = {
            "activity_id": activity["id"],
            "client_id": client["id"],
            "anonym_visits": 5,
            "visits": [],
        }

        response = api_client.post("/api/v1/records", json=payload)
        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
        body = response.json()
        assert body["seats"] == 5
        assert body["anonym_visits"] == 5
        assert body["visits"] == []

    def test_create_record_with_visits_and_anonym_visits(self, api_client, create_activity, create_client) -> None:
        """POST /api/records with 2 visits + anonym_visits=3 → seats=5."""
        activity = create_activity()
        client = create_client()
        payload = {
            "activity_id": activity["id"],
            "client_id": client["id"],
            "anonym_visits": 3,
            "visits": [
                {"name": "Alice", "price": 1500},
                {"name": "Bob", "price": 1500},
            ],
        }

        response = api_client.post("/api/v1/records", json=payload)
        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
        body = response.json()
        assert body["seats"] == 5  # 2 visits + 3 anonym
        assert body["anonym_visits"] == 3
        assert len(body["visits"]) == 2

    def test_create_record_default_anonym_visits_zero(self, api_client, create_activity, create_client) -> None:
        """POST /api/records without anonym_visits → seats = len(visits), anonym_visits=0."""
        activity = create_activity()
        client = create_client()
        payload = {
            "activity_id": activity["id"],
            "client_id": client["id"],
            "visits": [{"name": "Solo", "price": 2000}],
        }

        response = api_client.post("/api/v1/records", json=payload)
        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
        body = response.json()
        assert body["seats"] == 1
        assert body["anonym_visits"] == 0

    def test_patch_anonym_visits_updates_seats(self, api_client, create_record) -> None:
        """PATCH /api/records/{id} with anonym_visits recalculates seats."""
        record = create_record()  # default: 1 visit, seats=1, anonym_visits=0

        resp = api_client.patch(f"/api/v1/records/{record['id']}", json={
            "anonym_visits": 4,
        })
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        body = resp.json()
        assert body["anonym_visits"] == 4
        assert body["seats"] == 5  # 1 visit + 4 anonym

    def test_put_record_with_anonym_visits(self, api_client, create_activity, create_client, create_record) -> None:
        """PUT /api/records/{id} with anonym_visits computes seats correctly."""
        record = create_record()  # 1 visit

        resp = api_client.put(f"/api/v1/records/{record['id']}", json={
            "activity_id": record["activity_id"],
            "client_id": record["client_id"],
            "anonym_visits": 2,
            "visits": [
                {"name": "Guest1", "price": 1000},
                {"name": "Guest2", "price": 1000},
            ],
        })
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        body = resp.json()
        assert body["seats"] == 4  # 2 visits + 2 anonym
        assert body["anonym_visits"] == 2


class TestRecordTariffId:
    """Phase 0: tariff_id round-trip through Record API (nested visits)."""

    def test_get_record_includes_tariff_id_in_visits(
        self, api_client, sample_visit_with_tariff
    ) -> None:
        """Scenario 2: GET /api/v1/records/{id} includes tariff_id in nested visits."""
        record_id = sample_visit_with_tariff["record"]["id"]
        response = api_client.get(f"/api/v1/records/{record_id}")
        assert response.status_code == 200
        visits = response.json()["visits"]
        assert len(visits) >= 1
        assert "tariff_id" in visits[0], (
            f"'tariff_id' not in nested visit: {list(visits[0].keys())}"
        )

    def test_patch_record_preserves_tariff_id_in_visits(
        self, api_client, sample_record_with_visit, sample_tariff
    ) -> None:
        """Scenario 3: PATCH /api/v1/records/{id} accepts tariff_id in visits array."""
        record = sample_record_with_visit
        visit_id = record["visits"][0]["id"]
        patch_data = {
            "visits": [
                {
                    "id": visit_id,
                    "tariff_id": sample_tariff,
                    "price": 3500,
                    "status": "waiting",
                }
            ]
        }
        response = api_client.patch(
            f"/api/v1/records/{record['id']}", json=patch_data
        )
        assert response.status_code == 200
        patched_visits = response.json()["visits"]
        assert len(patched_visits) >= 1
        assert "tariff_id" in patched_visits[0], (
            f"'tariff_id' not in patched visit: {list(patched_visits[0].keys())}"
        )
        assert patched_visits[0]["tariff_id"] == sample_tariff
