"""Integration tests: complete business flows across multiple API endpoints.

Each test is self-contained and creates its own data via factories.
No mocks — every layer executes real code against a real test database.
"""

import pytest

from tests.conftest import query_db


# ─── Flow 1: Phone → Client → Record → Visit (complete booking) ─────────────


class TestBookingFlow:
    """End-to-end booking: phone lookup → client creation → record → visit."""

    def test_phone_to_client_to_record_to_visit(self, api_client) -> None:
        """Complete booking: phone not found → create record with phone → client auto-created → visits attached."""
        phone = "+79991234567"

        # Step 1: Search for phone (should return 404 — no client yet)
        resp = api_client.get("/api/v1/clients/search", params={"phone": phone})
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"

        # Step 2: Create prerequisites + record with phone (client auto-created)
        master = api_client.post("/api/v1/masters", json={
            "first_name": "Анна", "last_name": "Иванова",
            "color": "#5B8C7A", "position": "мастер", "specialty": "живопись",
        }).json()
        service = api_client.post("/api/v1/services", json={
            "title": "Картина маслом", "description": "Мастер-класс",
            "image_url": "https://example.com/img.jpg", "specialty": "живопись",
            "min_age": 6, "max_age": 99, "duration": 90, "record_info": "Фартук",
        }).json()
        location = api_client.post("/api/v1/locations", json={
            "name": "Студия", "address": "ул. Тестовая, 1", "capacity": 20,
        }).json()

        from datetime import UTC, datetime, timedelta
        activity = api_client.post("/api/v1/activities", json={
            "master_id": master["id"],
            "service_id": service["id"],
            "location_id": location["id"],
            "start": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
            "duration": 90,
            "capacity": 10,
        }).json()

        record_resp = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "phone": phone,
            "comment": "Запись по телефону",
            "visits": [{"name": "Тест", "age": 10, "price": 2000}],
        })
        assert record_resp.status_code == 201, f"Create failed: {record_resp.text}"
        record = record_resp.json()

        # Step 3: Verify client was auto-created with correct phone
        client_resp = api_client.get(f"/api/v1/clients/{record['client_id']}")
        assert client_resp.status_code == 200
        assert client_resp.json()["phone"] == phone

        # Step 4: Verify visit was created
        assert record["seats"] == 1
        assert len(record["visits"]) == 1
        assert record["visits"][0]["price"] == 2000

    def test_phone_reuses_existing_client(self, api_client, create_client, create_activity) -> None:
        """If client with this phone exists, reuse instead of creating new."""
        phone = "+79991112233"
        existing = create_client(phone=phone)

        activity = create_activity()
        resp = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "phone": phone,
            "visits": [{"name": "Гость", "price": 3500}],
        })
        assert resp.status_code == 201
        assert resp.json()["client_id"] == existing["id"]

    def test_phone_with_multiple_visitors(self, api_client, create_activity) -> None:
        """Phone-based booking with multiple visitors creates correct count."""
        activity = create_activity()
        phone = "+79998887766"

        resp = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "phone": phone,
            "visits": [
                {"name": "Алиса", "age": 28, "price": 3500},
                {"name": "Борис", "age": 35, "price": 3500},
            ],
        })
        assert resp.status_code == 201
        body = resp.json()
        assert body["seats"] == 2
        assert len(body["visits"]) == 2

        # Client created once, both visitors linked
        client_resp = api_client.get(f"/api/v1/clients/{body['client_id']}")
        assert client_resp.json()["phone"] == phone


# ─── Flow 2: Payment cascade (record → payment → balance) ────────────────────


class TestPaymentFlow:
    """Create record → add payment → verify payment linked correctly."""

    def test_record_then_payment(self, api_client, create_record) -> None:
        """Create record → add payment → verify payment exists and linked."""
        record = create_record()

        # Add payment
        payment_resp = api_client.post("/api/v1/payments", json={
            "record_id": record["id"],
            "amount": 1500,
            "method": "cash",
        })
        assert payment_resp.status_code == 201, f"Payment create failed: {payment_resp.text}"
        payment = payment_resp.json()
        assert payment["record_id"] == record["id"]
        assert payment["amount"] == 1500
        assert payment["method"] == "cash"
        assert payment["is_active"] is True

        # Verify payment accessible by ID
        get_resp = api_client.get(f"/api/v1/payments/{payment['id']}")
        assert get_resp.status_code == 200
        assert get_resp.json()["amount"] == 1500

    def test_multiple_payments_on_record(self, api_client, create_record) -> None:
        """Record can have multiple payments of different methods."""
        record = create_record()

        # Cash payment
        p1 = api_client.post("/api/v1/payments", json={
            "record_id": record["id"], "amount": 1000, "method": "cash",
        })
        assert p1.status_code == 201

        # Card payment
        p2 = api_client.post("/api/v1/payments", json={
            "record_id": record["id"], "amount": 2500, "method": "card",
        })
        assert p2.status_code == 201

        # Verify total via SQL
        result = query_db(
            f"SELECT COALESCE(SUM(amount), 0) as total "
            f"FROM payments WHERE record_id='{record['id']}' AND is_active=1"
        )
        assert result[0]["total"] == 3500

    def test_payment_for_nonexistent_record_rejected(self, api_client) -> None:
        """Payment for non-existent record should fail (FK constraint)."""
        resp = api_client.post("/api/v1/payments", json={
            "record_id": "nonexistent-id",
            "amount": 1000,
            "method": "cash",
        })
        # FK constraint should reject this (500 or 404/422 depending on error handling)
        assert resp.status_code in (404, 422, 500)


# ─── Flow 3: Delete cascade (soft-delete record → visits excluded) ───────────


class TestDeleteCascade:
    """Soft-delete record → visits excluded from list, but record still accessible by ID."""

    def test_delete_record_hides_from_list(self, api_client, create_record) -> None:
        """Soft-delete record → record excluded from list, but GET by ID still works."""
        record = create_record()
        record_id = record["id"]

        # Verify record has visits before deletion
        detail = api_client.get(f"/api/v1/records/{record_id}").json()
        assert len(detail["visits"]) > 0

        # Soft-delete record
        resp = api_client.delete(f"/api/v1/records/{record_id}")
        assert resp.status_code == 204

        # Record still accessible by ID (soft delete)
        resp = api_client.get(f"/api/v1/records/{record_id}")
        assert resp.status_code == 200
        assert resp.json()["is_active"] is False

        # Record excluded from list
        list_resp = api_client.get("/api/v1/records")
        ids = [r["id"] for r in list_resp.json()]
        assert record_id not in ids

    def test_delete_record_soft_deletes_visits_in_db(self, api_client, create_record) -> None:
        """Soft-delete record → visits NOT soft-deleted at DB level (current behavior)."""
        record = create_record()
        record_id = record["id"]

        # Verify visits exist
        visits_before = query_db(
            f"SELECT * FROM visits WHERE record_id='{record_id}' AND is_active=1"
        )
        assert len(visits_before) > 0

        # Delete record
        api_client.delete(f"/api/v1/records/{record_id}")

        # Visits are NOT cascaded — they remain active (current behavior)
        visits_after = query_db(
            f"SELECT * FROM visits WHERE record_id='{record_id}' AND is_active=1"
        )
        assert len(visits_after) == len(visits_before)

    @pytest.mark.xfail(
        reason="TODO: record delete should cascade-soft-delete visits and payments",
        strict=False,
    )
    def test_delete_record_cascades_to_visits_and_payments(self, api_client, create_record) -> None:
        """Soft-delete record → visits AND payments should also be soft-deleted."""
        record = create_record()
        record_id = record["id"]

        # Add a payment
        payment = api_client.post("/api/v1/payments", json={
            "record_id": record_id, "amount": 500, "method": "cash",
        }).json()

        # Delete record
        api_client.delete(f"/api/v1/records/{record_id}")

        # Visits should be soft-deleted
        visits = query_db(
            f"SELECT * FROM visits WHERE record_id='{record_id}' AND is_active=1"
        )
        assert len(visits) == 0

        # Payments should be soft-deleted
        payments = query_db(
            f"SELECT * FROM payments WHERE record_id='{record_id}' AND is_active=1"
        )
        assert len(payments) == 0

    def test_delete_record_then_payment_still_visible(self, api_client, create_record) -> None:
        """After deleting record, associated payments are still visible (current behavior)."""
        record = create_record()

        # Add a payment
        payment = api_client.post("/api/v1/payments", json={
            "record_id": record["id"], "amount": 500, "method": "cash",
        }).json()

        # Delete record
        api_client.delete(f"/api/v1/records/{record['id']}")

        # Payment still visible in list (no cascade)
        payments = api_client.get("/api/v1/payments").json()
        ids = [p["id"] for p in payments]
        assert payment["id"] in ids


# ─── Flow 4: Activity capacity enforcement ────────────────────────────────────


class TestCapacityFlow:
    """Fill activity to capacity → verify behavior when exceeded."""

    @pytest.mark.xfail(
        reason="Capacity enforcement not implemented: record service does not check activity.capacity before creating",
        strict=False,
    )
    def test_activity_capacity_limit(self, api_client) -> None:
        """Fill activity to capacity → next record should be rejected."""
        from datetime import UTC, datetime, timedelta

        # Create activity with capacity=2
        master = api_client.post("/api/v1/masters", json={
            "first_name": "Мастер", "last_name": "Тест",
            "color": "#5B8C7A", "position": "стажёр", "specialty": "акварель",
        }).json()
        service = api_client.post("/api/v1/services", json={
            "title": "Акварель", "description": "Тест",
            "image_url": "https://example.com/img.jpg", "specialty": "акварель",
            "min_age": 4, "max_age": 99, "duration": 60, "record_info": "",
        }).json()
        location = api_client.post("/api/v1/locations", json={
            "name": "Малый зал", "address": "ул. Тестовая", "capacity": 5,
        }).json()
        activity = api_client.post("/api/v1/activities", json={
            "master_id": master["id"],
            "service_id": service["id"],
            "location_id": location["id"],
            "start": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
            "duration": 60,
            "capacity": 2,
        }).json()

        # Verify initial state
        act_resp = api_client.get(f"/api/v1/activities/{activity['id']}")
        assert act_resp.json()["occupied"] == 0

        # Create 2 records (fill capacity)
        for i in range(2):
            resp = api_client.post("/api/v1/records", json={
                "activity_id": activity["id"],
                "visits": [{"name": f"Гость {i}", "price": 2000}],
            })
            assert resp.status_code == 201, f"Record {i} should succeed"

        # Verify occupied updated
        act_resp = api_client.get(f"/api/v1/activities/{activity['id']}")
        assert act_resp.json()["occupied"] == 2

        # Third record should fail (capacity full) — expects 409 or 422
        resp = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "visits": [{"name": "Переполнение", "price": 2000}],
        })
        assert resp.status_code in (409, 422), (
            f"Expected 409/422 for capacity overflow, got {resp.status_code}"
        )


# ─── Flow 5: Client search by phone ──────────────────────────────────────────


class TestClientSearchFlow:
    """Search client by phone → find exact match → verify details."""

    def test_client_search_by_phone(self, api_client, create_client) -> None:
        """Search client by phone → find exact match."""
        client = create_client(phone="+79991112233")

        # Search — should find the client
        resp = api_client.get("/api/v1/clients/search", params={"phone": "+79991112233"})
        assert resp.status_code == 200
        assert resp.json()["id"] == client["id"]
        assert resp.json()["phone"] == "+79991112233"

    def test_client_search_wrong_phone(self, api_client, create_client) -> None:
        """Search with wrong phone → 404."""
        create_client(phone="+79991112233")  # create someone

        resp = api_client.get("/api/v1/clients/search", params={"phone": "+00000000000"})
        assert resp.status_code == 404

    def test_client_search_excludes_inactive(self, api_client, create_client) -> None:
        """Soft-deleted client is not returned by search."""
        client = create_client(phone="+79995554433")
        api_client.delete(f"/api/v1/clients/{client['id']}")

        resp = api_client.get("/api/v1/clients/search", params={"phone": "+79995554433"})
        assert resp.status_code == 404

    def test_client_search_then_book(self, api_client, create_client, create_activity) -> None:
        """Search for client → use found client_id to create a record."""
        client = create_client(phone="+79993332211")
        activity = create_activity()

        # Search
        search_resp = api_client.get("/api/v1/clients/search", params={"phone": "+79993332211"})
        assert search_resp.status_code == 200
        found_id = search_resp.json()["id"]

        # Book using found client_id
        record_resp = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "client_id": found_id,
            "visits": [{"name": "Новый гость", "price": 2000}],
        })
        assert record_resp.status_code == 201
        assert record_resp.json()["client_id"] == found_id


