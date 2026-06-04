"""Tests for the Payments CRUD API endpoints."""

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
    "channel": "telegram",
}

VISITOR_PAYLOAD = {"name": "Alice", "age": 28}

PAYMENT_PAYLOAD = {
    "record_id": "",  # filled in _create_prerequisites
    "amount": 3000,
    "method": "card",
}


def _create_record(client: TestClient) -> str:
    """Create all prerequisites and return a record_id."""
    from datetime import UTC, datetime, timedelta

    master = client.post("/api/v1/masters", json=MASTER_PAYLOAD).json()
    service = client.post("/api/v1/services", json=SERVICE_PAYLOAD).json()
    location = client.post("/api/v1/locations", json=LOCATION_PAYLOAD).json()
    created_client = client.post("/api/v1/clients", json=CLIENT_PAYLOAD).json()

    visitor_data = {**VISITOR_PAYLOAD, "client_id": created_client["id"]}
    visitor1 = client.post("/api/v1/visitors", json=visitor_data).json()

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

    record_payload = {
        "activity_id": activity["id"],
        "client_id": created_client["id"],
        "comment": "Test record",
        "visits": [
            {"visitor_id": visitor1["id"], "price": 1500, "status": "waiting"},
        ],
    }
    record_resp = client.post("/api/v1/records", json=record_payload)
    return record_resp.json()["id"]


class TestPaymentsCrud:
    """Full CRUD round-trip for /api/payments."""

    def test_create_payment(self) -> None:
        """POST /api/payments creates a payment and returns 201."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            record_id = _create_record(client)
            payload = {**PAYMENT_PAYLOAD, "record_id": record_id}

            response = client.post("/api/v1/payments", json=payload)

        assert response.status_code == 201
        body = response.json()
        assert body["record_id"] == record_id
        assert body["amount"] == 3000
        assert body["method"] == "card"
        assert "id" in body
        assert "created_at" in body
        assert "updated_at" in body
        assert body["is_active"] is True

    def test_list_payments_includes_created(self) -> None:
        """GET /api/payments returns a list containing the created payment."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            record_id = _create_record(client)
            payload = {**PAYMENT_PAYLOAD, "record_id": record_id}
            create_resp = client.post("/api/v1/payments", json=payload)
            payment_id = create_resp.json()["id"]

            response = client.get("/api/v1/payments")
            assert response.status_code == 200
            payments = response.json()
            assert isinstance(payments, list)
            ids = [p["id"] for p in payments]
            assert payment_id in ids

    def test_get_payment_by_id(self) -> None:
        """GET /api/payments/{id} returns the specific payment."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            record_id = _create_record(client)
            payload = {**PAYMENT_PAYLOAD, "record_id": record_id}
            create_resp = client.post("/api/v1/payments", json=payload)
            payment_id = create_resp.json()["id"]

            response = client.get(f"/api/v1/payments/{payment_id}")
            assert response.status_code == 200
            body = response.json()
            assert body["id"] == payment_id
            assert body["amount"] == 3000

    def test_update_payment(self) -> None:
        """PUT /api/payments/{id} updates all fields."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            record_id = _create_record(client)
            payload = {**PAYMENT_PAYLOAD, "record_id": record_id}
            create_resp = client.post("/api/v1/payments", json=payload)
            payment_id = create_resp.json()["id"]

            update_data = {
                "record_id": record_id,
                "amount": 5000,
                "method": "cash",
            }
            response = client.put(f"/api/v1/payments/{payment_id}", json=update_data)
            assert response.status_code == 200
            body = response.json()
            assert body["amount"] == 5000
            assert body["method"] == "cash"

    def test_delete_payment_soft_deletes(self) -> None:
        """DELETE /api/payments/{id} soft-deletes and list excludes it."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            record_id = _create_record(client)
            payload = {**PAYMENT_PAYLOAD, "record_id": record_id}
            create_resp = client.post("/api/v1/payments", json=payload)
            payment_id = create_resp.json()["id"]

            # Delete
            response = client.delete(f"/api/v1/payments/{payment_id}")
            assert response.status_code == 204

            # GET by id should still return it (soft delete)
            response = client.get(f"/api/v1/payments/{payment_id}")
            assert response.status_code == 200
            assert response.json()["is_active"] is False

            # List should NOT include the deleted payment
            response = client.get("/api/v1/payments")
            payments = response.json()
            ids = [p["id"] for p in payments]
            assert payment_id not in ids

    def test_get_nonexistent_payment_returns_404(self) -> None:
        """GET /api/payments/{fake_id} returns 404."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.get("/api/v1/payments/nonexistent-id")
        assert response.status_code == 404

    def test_update_nonexistent_payment_returns_404(self) -> None:
        """PUT /api/payments/{fake_id} returns 404."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            record_id = _create_record(client)
            response = client.put(
                "/api/v1/payments/nonexistent-id",
                json={**PAYMENT_PAYLOAD, "record_id": record_id},
            )
        assert response.status_code == 404

    def test_delete_nonexistent_payment_returns_404(self) -> None:
        """DELETE /api/payments/{fake_id} returns 404."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.delete("/api/v1/payments/nonexistent-id")
        assert response.status_code == 404
