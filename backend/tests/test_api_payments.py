"""Tests for the Payments CRUD API endpoints."""

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

    master = api_client.post("/api/v1/staff", json=MASTER_PAYLOAD).json()
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
    """Payment-create created_at handling (CRUD covered by contract)."""

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


class TestPaymentTotals:
    """GET /api/v1/payments/totals — batch aggregate endpoint."""

    def _create_payment(self, api_client, record_id: str, amount: int) -> None:
        response = api_client.post(
            "/api/v1/payments",
            json={**PAYMENT_PAYLOAD, "record_id": record_id, "amount": amount},
        )
        assert response.status_code == 201

    def test_totals_multiple_records(self, api_client) -> None:
        r1, r2 = _create_record(api_client), _create_record(api_client)
        self._create_payment(api_client, r1, 3000)
        self._create_payment(api_client, r1, 1500)
        self._create_payment(api_client, r2, 2000)
        response = api_client.get(
            "/api/v1/payments/totals",
            params=[("record_ids", r1), ("record_ids", r2)],
        )
        assert response.status_code == 200
        assert response.json() == {"totals": {r1: 4500, r2: 2000}}

    def test_totals_record_without_payments_absent(self, api_client) -> None:
        r1, r2 = _create_record(api_client), _create_record(api_client)
        self._create_payment(api_client, r1, 3000)
        response = api_client.get(
            "/api/v1/payments/totals",
            params=[("record_ids", r1), ("record_ids", r2)],
        )
        assert response.status_code == 200
        assert response.json() == {"totals": {r1: 3000}}

    def test_totals_empty_record_ids_returns_empty(self, api_client) -> None:
        response = api_client.get("/api/v1/payments/totals")
        assert response.status_code == 200
        assert response.json() == {"totals": {}}

    def test_totals_over_cap_returns_422(self, api_client) -> None:
        params = [("record_ids", f"rec-{i}") for i in range(201)]
        response = api_client.get("/api/v1/payments/totals", params=params)
        assert response.status_code == 422

    def test_totals_excludes_deleted_payments(self, api_client) -> None:
        r1 = _create_record(api_client)
        self._create_payment(api_client, r1, 3000)
        list_resp = api_client.get("/api/v1/payments", params={"record_id": r1})
        payment_id = list_resp.json()["items"][0]["id"]
        del_resp = api_client.delete(f"/api/v1/payments/{payment_id}")
        assert del_resp.status_code == 204
        response = api_client.get(
            "/api/v1/payments/totals",
            params=[("record_ids", r1)],
        )
        assert response.status_code == 200
        assert response.json() == {"totals": {}}

    def test_totals_not_limited_by_list_pagination(self, api_client) -> None:
        """Regression #186: aggregate must include payments beyond the per_page<=100 list cap."""
        r1 = _create_record(api_client)
        for _ in range(105):
            self._create_payment(api_client, r1, 100)
        response = api_client.get(
            "/api/v1/payments/totals",
            params=[("record_ids", r1)],
        )
        assert response.status_code == 200
        assert response.json() == {"totals": {r1: 10500}}
