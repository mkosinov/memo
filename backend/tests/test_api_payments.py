"""Tests for the Payments CRUD API endpoints."""

import pytest

pytestmark = pytest.mark.api

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
    "channel": "telegram",
}

VISITOR_PAYLOAD = {"name": "Alice", "age": 28}

PAYMENT_PAYLOAD = {
    "record_id": "",  # filled in _create_record
    "amount": 3000,
    "method": "card",
}


def _create_record(api_client) -> str:
    """Create all prerequisites and return a record_id."""
    from datetime import UTC, datetime, timedelta

    master = api_client.post("/api/v1/masters", json=MASTER_PAYLOAD).json()
    service = api_client.post("/api/v1/services", json=SERVICE_PAYLOAD).json()
    location = api_client.post("/api/v1/locations", json=LOCATION_PAYLOAD).json()
    created_client = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD).json()

    visitor_data = {**VISITOR_PAYLOAD, "client_id": created_client["id"]}
    visitor1 = api_client.post("/api/v1/visitors", json=visitor_data).json()

    start = datetime.now(UTC) + timedelta(days=1)
    activity = api_client.post(
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

    record_payload = {
        "activity_id": activity["id"],
        "client_id": created_client["id"],
        "comment": "Test record",
        "visits": [
            {"visitor_id": visitor1["id"], "price": 1500, "status": "waiting"},
        ],
    }
    record_resp = api_client.post("/api/v1/records", json=record_payload)
    return record_resp.json()["id"]


class TestPaymentsCrud:
    """Full CRUD round-trip for /api/payments."""

    def test_create_payment(self, api_client) -> None:
        """POST /api/payments creates a payment and returns 201."""
        record_id = _create_record(api_client)
        payload = {**PAYMENT_PAYLOAD, "record_id": record_id}

        response = api_client.post("/api/v1/payments", json=payload)

        assert response.status_code == 201
        body = response.json()
        assert body["record_id"] == record_id
        assert body["amount"] == 3000
        assert body["method"] == "card"
        assert "id" in body
        assert "created_at" in body
        assert "updated_at" in body
        assert body["is_active"] is True

    def test_list_payments_includes_created(self, api_client) -> None:
        """GET /api/payments returns a list containing the created payment."""
        record_id = _create_record(api_client)
        payload = {**PAYMENT_PAYLOAD, "record_id": record_id}
        create_resp = api_client.post("/api/v1/payments", json=payload)
        payment_id = create_resp.json()["id"]

        response = api_client.get("/api/v1/payments")
        assert response.status_code == 200
        payments = response.json()
        assert isinstance(payments, list)
        ids = [p["id"] for p in payments]
        assert payment_id in ids

    def test_get_payment_by_id(self, api_client) -> None:
        """GET /api/payments/{id} returns the specific payment."""
        record_id = _create_record(api_client)
        payload = {**PAYMENT_PAYLOAD, "record_id": record_id}
        create_resp = api_client.post("/api/v1/payments", json=payload)
        payment_id = create_resp.json()["id"]

        response = api_client.get(f"/api/v1/payments/{payment_id}")
        assert response.status_code == 200
        body = response.json()
        assert body["id"] == payment_id
        assert body["amount"] == 3000

    def test_update_payment(self, api_client) -> None:
        """PUT /api/payments/{id} updates all fields."""
        record_id = _create_record(api_client)
        payload = {**PAYMENT_PAYLOAD, "record_id": record_id}
        create_resp = api_client.post("/api/v1/payments", json=payload)
        payment_id = create_resp.json()["id"]

        update_data = {
            "record_id": record_id,
            "amount": 5000,
            "method": "cash",
        }
        response = api_client.put(f"/api/v1/payments/{payment_id}", json=update_data)
        assert response.status_code == 200
        body = response.json()
        assert body["amount"] == 5000
        assert body["method"] == "cash"

    def test_delete_payment_soft_deletes(self, api_client) -> None:
        """DELETE /api/payments/{id} soft-deletes and list excludes it."""
        record_id = _create_record(api_client)
        payload = {**PAYMENT_PAYLOAD, "record_id": record_id}
        create_resp = api_client.post("/api/v1/payments", json=payload)
        payment_id = create_resp.json()["id"]

        # Delete
        response = api_client.delete(f"/api/v1/payments/{payment_id}")
        assert response.status_code == 204

        # GET by id should still return it (soft delete)
        response = api_client.get(f"/api/v1/payments/{payment_id}")
        assert response.status_code == 200
        assert response.json()["is_active"] is False

        # List should NOT include the deleted payment
        response = api_client.get("/api/v1/payments")
        payments = response.json()
        ids = [p["id"] for p in payments]
        assert payment_id not in ids

    def test_get_nonexistent_payment_returns_404(self, api_client) -> None:
        """GET /api/payments/{fake_id} returns 404."""
        response = api_client.get("/api/v1/payments/nonexistent-id")
        assert response.status_code == 404

    def test_update_nonexistent_payment_returns_404(self, api_client) -> None:
        """PUT /api/payments/{fake_id} returns 404."""
        record_id = _create_record(api_client)
        response = api_client.put(
            "/api/v1/payments/nonexistent-id",
            json={**PAYMENT_PAYLOAD, "record_id": record_id},
        )
        assert response.status_code == 404

    def test_delete_nonexistent_payment_returns_404(self, api_client) -> None:
        """DELETE /api/payments/{fake_id} returns 404."""
        response = api_client.delete("/api/v1/payments/nonexistent-id")
        assert response.status_code == 404

    def test_patch_payment_partial(self, api_client) -> None:
        """Scenario 21: PATCH /api/v1/payments/{id} partial update."""
        record_id = _create_record(api_client)
        payload = {**PAYMENT_PAYLOAD, "record_id": record_id}
        create_resp = api_client.post("/api/v1/payments", json=payload)
        payment_id = create_resp.json()["id"]

        response = api_client.patch(
            f"/api/v1/payments/{payment_id}",
            json={"method": "cash"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["method"] == "cash"
        assert body["amount"] == 3000  # unchanged

    def test_patch_payment_null_amount_stripped(self, api_client) -> None:
        """Scenario 22: PATCH with amount: null is silently stripped via NOT_NULL_FIELDS."""
        record_id = _create_record(api_client)
        payload = {**PAYMENT_PAYLOAD, "record_id": record_id}
        create_resp = api_client.post("/api/v1/payments", json=payload)
        payment_id = create_resp.json()["id"]
        original_amount = create_resp.json()["amount"]

        response = api_client.patch(
            f"/api/v1/payments/{payment_id}",
            json={"amount": None, "method": "cash"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["amount"] == original_amount  # NOT nulled out
        assert body["method"] == "cash"

    def test_patch_payment_not_found_404(self, api_client) -> None:
        """Scenario 23: PATCH non-existent ID returns 404 with PAYMENT_NOT_FOUND code."""
        response = api_client.patch(
            "/api/v1/payments/nonexistent-id",
            json={"method": "card"},
        )
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "PAYMENT_NOT_FOUND"

    def test_create_payment_with_created_at_persists_it(self, api_client) -> None:
        """POST /api/v1/payments with created_at uses the client-supplied timestamp."""
        record_id = _create_record(api_client)
        payload = {
            "record_id": record_id,
            "amount": 500,
            "method": "card",
            "created_at": "2026-06-01T12:00:00",
        }

        response = api_client.post("/api/v1/payments", json=payload)
        assert response.status_code == 201, f"Create failed: {response.text}"
        body = response.json()
        # Compare date/time components (allow for serialization format variations)
        from datetime import datetime
        created = datetime.fromisoformat(body["created_at"])
        assert created.year == 2026
        assert created.month == 6
        assert created.day == 1
        assert created.hour == 12
        assert created.minute == 0

        # Confirm persistence via GET
        get_resp = api_client.get(f"/api/v1/payments/{body['id']}")
        assert get_resp.status_code == 200
        get_created = datetime.fromisoformat(get_resp.json()["created_at"])
        assert get_created.year == 2026
        assert get_created.month == 6
        assert get_created.day == 1

    def test_create_payment_without_created_at_defaults_now(self, api_client) -> None:
        """POST /api/v1/payments without created_at uses server default (now)."""
        from datetime import datetime, timedelta

        record_id = _create_record(api_client)
        payload = {
            "record_id": record_id,
            "amount": 500,
            "method": "card",
        }

        before = datetime.utcnow()
        response = api_client.post("/api/v1/payments", json=payload)
        after = datetime.utcnow()

        assert response.status_code == 201, f"Create failed: {response.text}"
        body = response.json()
        created = datetime.fromisoformat(body["created_at"])
        # created_at should be within the test window (with 1-minute margin)
        assert created >= before - timedelta(minutes=1)
        assert created <= after + timedelta(minutes=1)
