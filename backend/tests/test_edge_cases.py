"""Edge case tests for API validation, boundaries, and data integrity."""

import pytest
from pydantic import ValidationError

from src.schemas.activity import ActivityResponse
from src.schemas.client import ClientResponse
from src.schemas.payment import PaymentResponse
from src.schemas.record import RecordResponse
from src.schemas.service import ServiceResponse
from tests.conftest import query_db

pytestmark = pytest.mark.integration


# ─── Existing enum validation tests (kept as-is) ──────────────────────────────


class TestEnumValidation:
    """Test enum validation for schema fields."""

    def test_record_status_invalid_returns_422(self, api_client):
        """Invalid record status should return 422."""
        resp = api_client.post(
            "/api/v1/records",
            json={
                "activity_id": "x",
                "client_id": "x",
                "status": "banana",
                "seats": 1,
                "visits": [],
            },
        )
        assert resp.status_code == 422

    def test_visit_status_invalid_returns_422(self, api_client):
        """Invalid visit status should return 422."""
        resp = api_client.put(
            "/api/v1/visits/v1/status",
            json={"status": "fake"},
        )
        assert resp.status_code == 422

    def test_payment_method_invalid_returns_422(self, api_client):
        """Invalid payment method should return 422."""
        resp = api_client.post(
            "/api/v1/payments",
            json={
                "record_id": "x",
                "amount": 100,
                "method": "crypto",
            },
        )
        assert resp.status_code == 422

    def test_channel_invalid_returns_422(self, api_client):
        """Invalid client channel should return 422."""
        resp = api_client.post(
            "/api/v1/clients",
            json={
                "name": "Test",
                "phone": "+79990001122",
                "channel": "instagram",
            },
        )
        assert resp.status_code == 422


# ─── Record edge cases ────────────────────────────────────────────────────────


class TestRecordEdgeCases:
    """Record validation and boundary tests."""

    def test_create_record_empty_visits(self, api_client, create_activity):
        """Empty visits array → 201, seats=0."""
        activity = create_activity()
        payload = {
            "activity_id": activity["id"],
            "visits": [],
        }
        response = api_client.post("/api/v1/records", json=payload)

        assert response.status_code == 201
        body = response.json()
        assert body["seats"] == 0
        assert body["visits"] == []

    def test_create_record_invalid_activity(self, api_client):
        """Non-existent activity_id → should be rejected (FK enforced)."""
        payload = {
            "activity_id": "nonexistent-activity-id",
            "visits": [],
        }
        response = api_client.post("/api/v1/records", json=payload)

        # FK enforcement rejects this with 422
        assert response.status_code == 422

    def test_update_record_status(self, api_client, create_record):
        """Update status → 200, status changed in DB."""
        record = create_record()
        assert record["status"] == "pending"

        response = api_client.put(
            f"/api/v1/records/{record['id']}",
            json={
                "activity_id": record["activity_id"],
                "client_id": record["client_id"],
                "status": "confirmed",
                "comment": record.get("comment"),
                "visits": record["visits"],
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "confirmed"

        # Verify in DB
        rows = query_db(
            f"SELECT status FROM records WHERE id='{record['id']}'"
        )
        assert rows[0]["status"] == "confirmed"

    def test_create_record_with_phone(self, api_client, create_activity):
        """Phone-based creation → client created automatically."""
        activity = create_activity()
        payload = {
            "activity_id": activity["id"],
            "phone": "+79995551234",
            "visits": [
                {"name": "Тест", "age": 10, "price": 2000},
            ],
        }
        response = api_client.post("/api/v1/records", json=payload)

        assert response.status_code == 201
        body = response.json()
        assert body["client_id"] is not None
        assert body["seats"] == 1

        # Verify client was created with the phone
        client_resp = api_client.get(f"/api/v1/clients/{body['client_id']}")
        assert client_resp.status_code == 200
        assert client_resp.json()["phone"] == "+79995551234"

    def test_create_record_existing_phone(self, api_client, create_activity, create_client):
        """Existing phone → client reused, not duplicated."""
        existing_client = create_client(phone="+79998887766")
        activity = create_activity()

        payload = {
            "activity_id": activity["id"],
            "phone": "+79998887766",
            "visits": [
                {"name": "Повтор", "age": 12, "price": 1500},
            ],
        }
        response = api_client.post("/api/v1/records", json=payload)

        assert response.status_code == 201
        body = response.json()
        assert body["client_id"] == existing_client["id"]


# ─── Client edge cases ────────────────────────────────────────────────────────


class TestClientEdgeCases:
    """Client validation and boundary tests."""

    def test_create_client_no_phone(self, api_client):
        """Missing phone → 201 (phone is optional, returns null)."""
        payload = {
            "name": "No Phone",
            "channel": "telegram",
        }
        response = api_client.post("/api/v1/clients", json=payload)

        assert response.status_code == 201
        data = response.json()
        assert data["phone"] is None

    def test_create_client_no_name(self, api_client):
        """Missing name → 201 (name is optional, returns null)."""
        payload = {
            "phone": "+79990001234",
            "channel": "telegram",
        }
        response = api_client.post("/api/v1/clients", json=payload)

        assert response.status_code == 201
        data = response.json()
        assert data["name"] is None

    def test_create_client_no_channel(self, api_client):
        """Missing channel → 201 (channel is optional, returns null)."""
        payload = {
            "name": "No Channel",
            "phone": "+79990001234",
        }
        response = api_client.post("/api/v1/clients", json=payload)

        assert response.status_code == 201
        data = response.json()
        assert data["channel"] is None

    def test_search_phone_not_found(self, api_client):
        """Unknown phone → 404."""
        response = api_client.get(
            "/api/v1/clients/search",
            params={"phone": "+00000000000"},
        )
        assert response.status_code == 404

    def test_search_phone_inactive(self, api_client, create_client):
        """Deleted client → 404 on phone search."""
        client = create_client(phone="+79991112233")
        # Soft-delete
        api_client.delete(f"/api/v1/clients/{client['id']}")

        response = api_client.get(
            "/api/v1/clients/search",
            params={"phone": "+79991112233"},
        )
        assert response.status_code == 404


# ─── Payment edge cases ───────────────────────────────────────────────────────


class TestPaymentEdgeCases:
    """Payment validation and boundary tests."""

    def test_zero_amount(self, api_client, create_record):
        """amount=0 → should be rejected (amount must be > 0)."""
        record = create_record()
        payload = {
            "record_id": record["id"],
            "amount": 0,
            "method": "cash",
        }
        response = api_client.post("/api/v1/payments", json=payload)

        # Schema should reject zero amount; currently accepts it
        assert response.status_code == 422

    def test_negative_amount(self, api_client, create_record):
        """amount=-100 → should be rejected (amount must be > 0)."""
        record = create_record()
        payload = {
            "record_id": record["id"],
            "amount": -100,
            "method": "card",
        }
        response = api_client.post("/api/v1/payments", json=payload)

        # Schema should reject negative amount; currently accepts it
        assert response.status_code == 422

    def test_invalid_method(self, api_client, create_record):
        """method='crypto' → 422 (not a valid PaymentMethod)."""
        record = create_record()
        payload = {
            "record_id": record["id"],
            "amount": 1000,
            "method": "crypto",
        }
        response = api_client.post("/api/v1/payments", json=payload)

        assert response.status_code == 422

    def test_payment_no_method(self, api_client, create_record):
        """Omitting method → 201 (method is optional in schema)."""
        record = create_record()
        payload = {
            "record_id": record["id"],
            "amount": 2500,
        }
        response = api_client.post("/api/v1/payments", json=payload)

        assert response.status_code == 201
        assert response.json()["method"] is None

    def test_payment_invalid_record_id(self, api_client):
        """Non-existent record_id → should be rejected (FK enforced)."""
        payload = {
            "record_id": "nonexistent-record-id",
            "amount": 1000,
            "method": "cash",
        }
        response = api_client.post("/api/v1/payments", json=payload)

        # FK enforcement rejects this with 422
        assert response.status_code == 422


# ─── Activity edge cases ──────────────────────────────────────────────────────


class TestActivityEdgeCases:
    """Activity validation and boundary tests."""

    def test_patch_partial(self, api_client, create_activity):
        """PATCH updates only sent fields, leaves others unchanged."""
        activity = create_activity(capacity=10, is_private=False)

        # Patch only capacity
        response = api_client.patch(
            f"/api/v1/activities/{activity['id']}",
            json={"capacity": 25},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["capacity"] == 25
        # Other fields remain unchanged
        assert body["is_private"] is False
        assert body["duration"] == activity["duration"]

    def test_occupied_count(self, api_client, create_record):
        """Activity occupied = number of records for that activity."""
        record = create_record()
        activity_id = record["activity_id"]

        response = api_client.get(f"/api/v1/activities/{activity_id}")
        assert response.status_code == 200
        assert response.json()["occupied"] == 1

    def test_occupied_increases_with_more_records(self, api_client, create_record):
        """Occupied count increases with additional records."""
        record1 = create_record()
        activity_id = record1["activity_id"]
        record2 = create_record(activity_id=activity_id)

        response = api_client.get(f"/api/v1/activities/{activity_id}")
        assert response.status_code == 200
        assert response.json()["occupied"] == 2

    # ─── BUG #84: occupied = SUM(seats), not COUNT(records) ──────────────────

    def test_occupied_sums_seats_not_records(self, api_client, create_record, _create_activity_payload):
        """occupied = SUM(seats) over active records, not count of records."""
        act_payload = _create_activity_payload()
        act_resp = api_client.post("/api/v1/activities", json=act_payload)
        assert act_resp.status_code == 201
        act_id = act_resp.json()["id"]

        # Three records with 1, 2, 3 visits (= seats 1+2+3)
        create_record(activity_id=act_id, visits=[{"name": "A", "price": 1000}])
        create_record(activity_id=act_id, visits=[{"name": "A", "price": 1000}, {"name": "B", "price": 1000}])
        create_record(activity_id=act_id, visits=[
            {"name": "A", "price": 1000},
            {"name": "B", "price": 1000},
            {"name": "C", "price": 1000},
        ])

        response = api_client.get(f"/api/v1/activities/{act_id}")
        assert response.status_code == 200
        assert response.json()["occupied"] == 6  # 1+2+3, not 3

    def test_occupied_excludes_cancelled(self, api_client, create_record, _create_activity_payload):
        """occupied excludes records with status=cancelled."""
        act_payload = _create_activity_payload()
        act_resp = api_client.post("/api/v1/activities", json=act_payload)
        assert act_resp.status_code == 201
        act_id = act_resp.json()["id"]

        r1 = create_record(activity_id=act_id, visits=[
            {"name": "A", "price": 1000},
            {"name": "B", "price": 1000},
            {"name": "C", "price": 1000},
        ])
        r2 = create_record(activity_id=act_id, visits=[
            {"name": "A", "price": 1000},
            {"name": "B", "price": 1000},
            {"name": "C", "price": 1000},
            {"name": "D", "price": 1000},
            {"name": "E", "price": 1000},
        ])

        # Cancel r2
        patch_resp = api_client.patch(
            f"/api/v1/records/{r2['id']}",
            json={"status": "cancelled"},
        )
        assert patch_resp.status_code == 200

        response = api_client.get(f"/api/v1/activities/{act_id}")
        assert response.json()["occupied"] == 3  # only r1 counts (3 seats)

    def test_occupied_excludes_no_show(self, api_client, create_record, _create_activity_payload):
        """occupied excludes records with status=no_show."""
        act_payload = _create_activity_payload()
        act_resp = api_client.post("/api/v1/activities", json=act_payload)
        assert act_resp.status_code == 201
        act_id = act_resp.json()["id"]

        r1 = create_record(activity_id=act_id, visits=[
            {"name": "A", "price": 1000},
            {"name": "B", "price": 1000},
            {"name": "C", "price": 1000},
        ])
        r2 = create_record(activity_id=act_id, visits=[
            {"name": "A", "price": 1000},
            {"name": "B", "price": 1000},
            {"name": "C", "price": 1000},
            {"name": "D", "price": 1000},
            {"name": "E", "price": 1000},
        ])

        api_client.patch(f"/api/v1/records/{r2['id']}", json={"status": "no_show"})

        response = api_client.get(f"/api/v1/activities/{act_id}")
        assert response.json()["occupied"] == 3  # only r1 counts (3 seats)

    def test_activity_no_records_occupied_zero(self, api_client, create_activity):
        """Activity with no records → occupied=0."""
        activity = create_activity()

        response = api_client.get(f"/api/v1/activities/{activity['id']}")
        assert response.status_code == 200
        assert response.json()["occupied"] == 0


# ─── Data integrity tests ─────────────────────────────────────────────────────


class TestDataIntegrity:
    """Soft-delete and data consistency tests."""

    def test_soft_delete_excludes(self, api_client, create_record):
        """Deleted record not in list, but still accessible by ID."""
        record = create_record()
        record_id = record["id"]

        # Verify in list
        response = api_client.get("/api/v1/records")
        ids = [r["id"] for r in response.json()]
        assert record_id in ids

        # Soft-delete
        api_client.delete(f"/api/v1/records/{record_id}")

        # Not in list
        response = api_client.get("/api/v1/records")
        ids = [r["id"] for r in response.json()]
        assert record_id not in ids

        # Still accessible by ID
        response = api_client.get(f"/api/v1/records/{record_id}")
        assert response.status_code == 200
        assert response.json()["is_active"] is False

    def test_soft_delete_client_excludes(self, api_client, create_client):
        """Deleted client not in list."""
        client = create_client()
        client_id = client["id"]

        api_client.delete(f"/api/v1/clients/{client_id}")

        response = api_client.get("/api/v1/clients")
        items = response.json()["items"]
        ids = [c["id"] for c in items]
        assert client_id not in ids

    def test_double_delete_idempotent(self, api_client, create_record):
        """Deleting an already-deleted record → should return 404."""
        record = create_record()
        record_id = record["id"]

        # First delete succeeds
        response = api_client.delete(f"/api/v1/records/{record_id}")
        assert response.status_code == 204

        # Second delete should return 404 (record already deleted)
        response = api_client.delete(f"/api/v1/records/{record_id}")
        assert response.status_code == 404

    def test_client_visitors_excludes_deleted(self, api_client, create_client):
        """Soft-deleted visitors excluded from client visitors list."""
        client = create_client()

        # Create a visitor
        v1_resp = api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Active", "age": 25,
        })
        assert v1_resp.status_code == 201
        v1_id = v1_resp.json()["id"]

        # Create another visitor
        v2_resp = api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Deleted", "age": 30,
        })
        v2_id = v2_resp.json()["id"]

        # Soft-delete v2
        api_client.delete(f"/api/v1/visitors/{v2_id}")

        # List client visitors — should only include v1
        response = api_client.get(f"/api/v1/clients/{client['id']}/visitors")
        assert response.status_code == 200
        visitor_ids = [v["id"] for v in response.json()]
        assert v1_id in visitor_ids
        assert v2_id not in visitor_ids


# ─── Response contract tests ───────────────────────────────────────────────────


class TestResponseContracts:
    """Verify API responses match Pydantic schemas (contract testing).

    These tests catch schema drift — when API responses change but
    schemas don't update.  Each test creates its own data via fixtures
    to ensure the endpoint returns at least one item, then validates
    every item against the corresponding Pydantic response schema.
    """

    def test_records_schema(self, api_client, create_record):
        """GET /api/v1/records — each item validates against RecordResponse."""
        create_record()  # ensure at least one record exists
        resp = api_client.get("/api/v1/records")
        assert resp.status_code == 200
        for item in resp.json():
            RecordResponse.model_validate(item)  # raises ValidationError if mismatch

    def test_clients_schema(self, api_client, create_client):
        """GET /api/v1/clients — each item validates against ClientResponse."""
        create_client()
        resp = api_client.get("/api/v1/clients")
        assert resp.status_code == 200
        for item in resp.json()["items"]:
            ClientResponse.model_validate(item)

    def test_payments_schema(self, api_client, create_record):
        """GET /api/v1/payments — each item validates against PaymentResponse."""
        # Create a record first, then a payment
        record = create_record()
        api_client.post(
            "/api/v1/payments",
            json={
                "record_id": record["id"],
                "amount": 1000,
                "method": "cash",
            },
        )
        resp = api_client.get("/api/v1/payments")
        assert resp.status_code == 200
        for item in resp.json():
            PaymentResponse.model_validate(item)

    def test_activities_schema(self, api_client, create_activity):
        """GET /api/v1/activities — each item validates against ActivityResponse."""
        create_activity()
        resp = api_client.get("/api/v1/activities")
        assert resp.status_code == 200
        for item in resp.json():
            ActivityResponse.model_validate(item)

    def test_services_schema(self, api_client, create_service):
        """GET /api/v1/services — each item validates against ServiceResponse."""
        create_service()
        resp = api_client.get("/api/v1/services")
        assert resp.status_code == 200
        for item in resp.json():
            ServiceResponse.model_validate(item)
