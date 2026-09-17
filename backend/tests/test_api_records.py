"""Tests for the Records + Visits CRUD API endpoints."""

import uuid as _uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from tests.conftest import query_db

pytestmark = pytest.mark.api


class TestRecordsCrud:
    """Full CRUD round-trip for /api/records with nested visits."""

    def test_create_record_with_visits(self, api_client, create_activity, create_client, sample_tariff) -> None:
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

        # GH #257 US1: the booking tail's default tariff must survive the
        # nested-create path — VisitItem carries tariff_id, the service must
        # persist it (same field the PUT path round-trips).
        payload = {
            "activity_id": activity["id"],
            "client_id": client["id"],
            "comment": "Test record",
            "visits": [
                {"visitor_id": v1["id"], "tariff_id": sample_tariff, "price": 1500},
                {"visitor_id": v2["id"], "tariff_id": sample_tariff, "price": 1500},
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
        assert body["visits"][0]["tariff_id"] == sample_tariff
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
        # #285 rev7: the commit must declare the state it confirmed — the
        # visit ids from the create response (no payments exist).
        visit_ids = [v["id"] for v in create_resp.json()["visits"]]

        # Delete (with-body execute — record has visits as deps, GH #139)
        response = api_client.request(
            "DELETE",
            f"/api/v1/records/{record_id}",
            json={
                "resolutions": {"visits": "cascade", "payments": "cascade"},
                "expected": {"visits": visit_ids, "payments": []},
            },
        )
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
        """DELETE /api/records/{fake_id} returns 404 (#285: via dry-run probe)."""
        response = api_client.request(
            "DELETE", "/api/v1/records/nonexistent-id", params={"dry_run": "true"}
        )
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


class TestAnonymousVisits:
    """Tests for anonymous visits on Record (#82, unified model #257).

    Anonymous guest = a visit element with ``visitor_id: None`` (and no
    name) — the counter field is gone.
    """

    @staticmethod
    def _anonymous(price: int = 0, status: str = "waiting") -> dict:
        return {"visitor_id": None, "price": price, "status": status}

    def test_create_record_with_anonymous_visits_only(self, api_client, create_activity, create_client) -> None:
        """POST /api/records with 5 anonymous visit elements → seats=5, all visitor_id NULL."""
        activity = create_activity()
        client = create_client()
        payload = {
            "activity_id": activity["id"],
            "client_id": client["id"],
            "visits": [self._anonymous() for _ in range(5)],
        }

        response = api_client.post("/api/v1/records", json=payload)
        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
        body = response.json()
        assert body["seats"] == 5
        assert len(body["visits"]) == 5
        assert all(v["visitor_id"] is None for v in body["visits"])

    def test_create_record_with_visits_and_anonymous_visits(self, api_client, create_activity, create_client) -> None:
        """POST /api/records with 2 named visits + 3 anonymous → seats=5."""
        activity = create_activity()
        client = create_client()
        payload = {
            "activity_id": activity["id"],
            "client_id": client["id"],
            "visits": [
                {"name": "Alice", "price": 1500},
                {"name": "Bob", "price": 1500},
                *(self._anonymous(price=0) for _ in range(3)),
            ],
        }

        response = api_client.post("/api/v1/records", json=payload)
        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
        body = response.json()
        assert body["seats"] == 5  # 2 named + 3 anonymous visits
        assert len(body["visits"]) == 5
        named = [v for v in body["visits"] if v["visitor_id"] is not None]
        anonymous = [v for v in body["visits"] if v["visitor_id"] is None]
        assert len(named) == 2
        assert len(anonymous) == 3

    def test_create_record_default_anonymous_visits_zero(self, api_client, create_activity, create_client) -> None:
        """POST /api/records without anonymous elements → seats = len(visits)."""
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
        assert len(body["visits"]) == 1
        assert body["visits"][0]["visitor_id"] is not None

    def test_patch_anonymous_visits_updates_seats(self, api_client, create_record) -> None:
        """PATCH /api/records/{id} with anonymous visit elements recalculates seats."""
        record = create_record()  # default: 1 named visit, seats=1

        resp = api_client.patch(f"/api/v1/records/{record['id']}", json={
            "visits": [
                *record["visits"],
                *(self._anonymous() for _ in range(4)),
            ],
        })
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        body = resp.json()
        assert body["seats"] == 5  # 1 named + 4 anonymous
        anonymous = [v for v in body["visits"] if v["visitor_id"] is None]
        assert len(anonymous) == 4

    def test_put_record_with_anonymous_visits(self, api_client, create_activity, create_client, create_record) -> None:
        """PUT /api/records/{id} with anonymous visit elements computes seats correctly.

        Named visits are passed ID-based: PUT does not resolve ``name``
        payloads (pre-existing behavior — resolution happens on create).
        """
        record = create_record()  # 1 named visit
        visitor_a = api_client.post("/api/v1/visitors", json={
            "client_id": record["client_id"], "name": "Guest1", "age": None,
        }).json()
        visitor_b = api_client.post("/api/v1/visitors", json={
            "client_id": record["client_id"], "name": "Guest2", "age": None,
        }).json()

        resp = api_client.put(f"/api/v1/records/{record['id']}", json={
            "activity_id": record["activity_id"],
            "client_id": record["client_id"],
            "visits": [
                {"visitor_id": visitor_a["id"], "price": 1000},
                {"visitor_id": visitor_b["id"], "price": 1000},
                *(self._anonymous() for _ in range(2)),
            ],
        })
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        body = resp.json()
        assert body["seats"] == 4  # 2 named + 2 anonymous visits
        anonymous = [v for v in body["visits"] if v["visitor_id"] is None]
        named = [v for v in body["visits"] if v["visitor_id"] is not None]
        assert len(anonymous) == 2
        assert len(named) == 2


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


class TestRecordsListFilters:
    """Server-side filters on GET /api/v1/records (#191)."""

    def test_filter_date_range_whole_day_inclusive(self, api_client, create_activity, create_record):
        late = create_activity(start=datetime(2026, 8, 5, 23, 30))
        early_next = create_activity(start=datetime(2026, 8, 6, 0, 0))
        r_in = create_record(activity_id=late["id"])
        r_out = create_record(activity_id=early_next["id"])
        resp = api_client.get("/api/v1/records", params={"date_from": "2026-08-05", "date_to": "2026-08-05"})
        assert resp.status_code == 200
        ids = [r["id"] for r in resp.json()["items"]]
        assert r_in["id"] in ids and r_out["id"] not in ids

    def test_filter_date_from_only(self, api_client, create_activity, create_record):
        before = create_activity(start=datetime(2026, 8, 1, 10, 0))
        after = create_activity(start=datetime(2026, 8, 5, 10, 0))
        r_before = create_record(activity_id=before["id"])
        r_after = create_record(activity_id=after["id"])
        resp = api_client.get("/api/v1/records", params={"date_from": "2026-08-03"})
        ids = [r["id"] for r in resp.json()["items"]]
        assert r_after["id"] in ids and r_before["id"] not in ids

    def test_filter_date_to_only(self, api_client, create_activity, create_record):
        before = create_activity(start=datetime(2026, 8, 1, 10, 0))
        after = create_activity(start=datetime(2026, 8, 5, 10, 0))
        r_before = create_record(activity_id=before["id"])
        r_after = create_record(activity_id=after["id"])
        resp = api_client.get("/api/v1/records", params={"date_to": "2026-08-03"})
        ids = [r["id"] for r in resp.json()["items"]]
        assert r_before["id"] in ids and r_after["id"] not in ids

    def test_filter_location_id(self, api_client, create_activity, create_record):
        a = create_activity()
        b = create_activity()
        r_a = create_record(activity_id=a["id"])
        r_b = create_record(activity_id=b["id"])
        resp = api_client.get("/api/v1/records", params={"location_id": a["location_id"]})
        ids = [r["id"] for r in resp.json()["items"]]
        assert r_a["id"] in ids and r_b["id"] not in ids

    def test_filter_service_id(self, api_client, create_activity, create_record):
        a = create_activity()
        b = create_activity()
        r_a = create_record(activity_id=a["id"])
        r_b = create_record(activity_id=b["id"])
        resp = api_client.get("/api/v1/records", params={"service_id": a["service_id"]})
        ids = [r["id"] for r in resp.json()["items"]]
        assert r_a["id"] in ids and r_b["id"] not in ids

    def test_filter_master_id(self, api_client, create_activity, create_record):
        a = create_activity()
        b = create_activity()
        r_a = create_record(activity_id=a["id"])
        r_b = create_record(activity_id=b["id"])
        resp = api_client.get("/api/v1/records", params={"master_id": a["master_id"]})
        ids = [r["id"] for r in resp.json()["items"]]
        assert r_a["id"] in ids and r_b["id"] not in ids

    def test_filter_status(self, api_client, create_record):
        r_waiting = create_record()  # visits default status waiting
        r_visited = create_record(visits=[{"name": "Гость", "price": 3500, "status": "visited"}])
        resp = api_client.get("/api/v1/records", params={"status": "visited"})
        ids = [r["id"] for r in resp.json()["items"]]
        assert r_visited["id"] in ids and r_waiting["id"] not in ids

    def test_filter_activity_id(self, api_client, create_activity, create_record):
        a = create_activity()
        r_a = create_record(activity_id=a["id"])
        r_other = create_record()
        resp = api_client.get("/api/v1/records", params={"activity_id": a["id"]})
        body = resp.json()
        assert [r["id"] for r in body["items"]] == [r_a["id"]] and body["total"] == 1

    def test_filter_combined_location_master_status(self, api_client, create_activity, create_record):
        a = create_activity()
        b = create_activity()
        r_a = create_record(activity_id=a["id"], visits=[{"name": "Гость", "price": 3500, "status": "visited"}])
        create_record(activity_id=a["id"])  # same master+location, wrong status
        create_record(activity_id=b["id"], visits=[{"name": "Гость", "price": 3500, "status": "visited"}])  # right status, wrong activity refs
        resp = api_client.get(
            "/api/v1/records",
            params={"location_id": a["location_id"], "master_id": a["master_id"], "status": "visited"},
        )
        body = resp.json()
        assert [r["id"] for r in body["items"]] == [r_a["id"]] and body["total"] == 1

    def test_filter_combined_date_status(self, api_client, create_activity, create_record):
        in_range = create_activity(start=datetime(2026, 8, 5, 10, 0))
        out_range = create_activity(start=datetime(2026, 9, 5, 10, 0))
        r_match = create_record(activity_id=in_range["id"], visits=[{"name": "Гость", "price": 3500, "status": "visited"}])
        create_record(activity_id=in_range["id"])  # in range, wrong status
        create_record(activity_id=out_range["id"], visits=[{"name": "Гость", "price": 3500, "status": "visited"}])  # right status, out of range
        resp = api_client.get("/api/v1/records", params={"date_from": "2026-08-01", "date_to": "2026-08-31", "status": "visited"})
        body = resp.json()
        assert [r["id"] for r in body["items"]] == [r_match["id"]] and body["total"] == 1

    def test_total_reflects_filtered_count(self, api_client, create_activity, create_record):
        a = create_activity()
        create_record(activity_id=a["id"])
        create_record(activity_id=a["id"])
        create_record()
        resp = api_client.get("/api/v1/records", params={"activity_id": a["id"], "per_page": 1})
        body = resp.json()
        assert body["total"] == 2 and len(body["items"]) == 1


class TestRecordsListSearch:
    """Server-side `?q=` search on GET /api/v1/records (GH #212, spec §5.2 records row).

    Substring over client.name / client.phone / client.email / service.title
    (Client LEFT OUTER — client_id nullable; Service LEFT OUTER through the
    already-joined Activity). Exact record.id equality when q is a full UUID.
    """

    @staticmethod
    def _ids(resp) -> list[str]:
        assert resp.status_code == 200, f"{resp.status_code}: {resp.text}"
        return [r["id"] for r in resp.json()["items"]]

    @staticmethod
    def _activity_on(api_client, *, master_id, service_id, location_id, start):
        resp = api_client.post("/api/v1/activities", json={
            "master_id": master_id, "service_id": service_id, "location_id": location_id,
            "start": start.isoformat(), "duration": 90, "capacity": 10, "is_private": False,
        })
        assert resp.status_code == 201, f"{resp.status_code}: {resp.text}"
        return resp.json()

    def test_search_by_client_name(self, api_client, create_client, create_record):
        target = create_record(client_id=create_client(name="Аполлинария")["id"])
        other = create_record()
        ids = self._ids(api_client.get("/api/v1/records", params={"q": "поллина"}))
        assert target["id"] in ids and other["id"] not in ids

    def test_search_by_client_phone(self, api_client, create_client, create_record):
        cl = create_client(phone="+79990001122")
        target = create_record(client_id=cl["id"])
        other = create_record()
        ids = self._ids(api_client.get("/api/v1/records", params={"q": "000112"}))
        assert target["id"] in ids and other["id"] not in ids

    def test_search_by_client_email(self, api_client, create_client, create_record):
        cl = create_client(email="apollinaria@example.com")
        target = create_record(client_id=cl["id"])
        other = create_record()  # default client email is None
        ids = self._ids(api_client.get("/api/v1/records", params={"q": "apollinaria"}))
        assert target["id"] in ids and other["id"] not in ids

    def test_search_by_service_title(
        self, api_client, create_master, create_service, create_location, create_record
    ):
        svc = create_service(title="Гончарная мастерская")
        master, location = create_master(), create_location()
        a = self._activity_on(
            api_client, master_id=master["id"], service_id=svc["id"],
            location_id=location["id"], start=datetime(2026, 8, 5, 10, 0),
        )
        target = create_record(activity_id=a["id"])
        other = create_record()  # default "Test Service N" title
        ids = self._ids(api_client.get("/api/v1/records", params={"q": "ончарная"}))
        assert target["id"] in ids and other["id"] not in ids

    def test_search_full_uuid_returns_exact_record(self, api_client, create_record):
        rec = create_record()
        create_record()  # decoy: uuid clause must match exactly one row
        body = api_client.get("/api/v1/records", params={"q": rec["id"]}).json()
        assert [r["id"] for r in body["items"]] == [rec["id"]] and body["total"] == 1

    def test_search_partial_id_no_match(self, api_client, create_record):
        rec = create_record()
        body = api_client.get("/api/v1/records", params={"q": rec["id"][:8]}).json()
        assert rec["id"] not in [r["id"] for r in body["items"]]
        assert body["total"] == 0

    @pytest.mark.parametrize("q", ["a", ""])
    def test_search_q_length_validation_422(self, api_client, q):
        resp = api_client.get("/api/v1/records", params={"q": q})
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"

    def test_search_combined_with_location_and_status(
        self, api_client, create_activity, create_client, create_record
    ):
        cl = create_client(name="Клавдия")
        a, b = create_activity(), create_activity()
        visited = [{"name": "Гость", "price": 3500, "status": "visited"}]
        target = create_record(activity_id=a["id"], client_id=cl["id"], visits=visited)
        create_record(activity_id=a["id"], visits=visited)  # q-match location, wrong client
        create_record(activity_id=b["id"], client_id=cl["id"], visits=visited)  # q-match, wrong location
        create_record(activity_id=a["id"], client_id=cl["id"])  # q+loc match, wrong status (waiting)
        body = api_client.get("/api/v1/records", params={
            "q": "лавди", "location_id": a["location_id"], "status": "visited",
        }).json()
        assert [r["id"] for r in body["items"]] == [target["id"]] and body["total"] == 1

    def test_search_combined_with_service_master_date(
        self, api_client, create_master, create_service, create_location,
        create_activity, create_record,
    ):
        svc = create_service(title="Мозаика панно")
        master, location = create_master(), create_location()
        a = self._activity_on(
            api_client, master_id=master["id"], service_id=svc["id"],
            location_id=location["id"], start=datetime(2026, 8, 5, 10, 0),
        )
        b_other_service = create_activity(start=datetime(2026, 8, 5, 12, 0))  # right master/date, wrong service
        c_other_master_date = self._activity_on(
            api_client, master_id=create_master()["id"], service_id=svc["id"],
            location_id=location["id"], start=datetime(2026, 9, 5, 10, 0),
        )
        target = create_record(activity_id=a["id"])
        create_record(activity_id=b_other_service["id"])
        create_record(activity_id=c_other_master_date["id"])
        body = api_client.get("/api/v1/records", params={
            "q": "озаик", "service_id": svc["id"], "master_id": master["id"],
            "date_from": "2026-08-01", "date_to": "2026-08-31",
        }).json()
        assert [r["id"] for r in body["items"]] == [target["id"]] and body["total"] == 1

    def test_search_total_after_q_with_pagination(self, api_client, create_client, create_record):
        cl = create_client(name="Многодетный")
        for _ in range(3):
            create_record(client_id=cl["id"])
        other = create_record()
        p1 = api_client.get("/api/v1/records", params={"q": "ногодет", "per_page": 2, "page": 1}).json()
        p2 = api_client.get("/api/v1/records", params={"q": "ногодет", "per_page": 2, "page": 2}).json()
        assert p1["total"] == 3 and len(p1["items"]) == 2
        assert p2["total"] == 3 and len(p2["items"]) == 1
        got = [r["id"] for r in p1["items"] + p2["items"]]
        assert other["id"] not in got and len(set(got)) == 3

    def test_search_null_client_found_by_service_title(
        self, api_client, create_master, create_service, create_location, create_record
    ):
        svc = create_service(title="Плетение макраме")
        master, location = create_master(), create_location()
        a = self._activity_on(
            api_client, master_id=master["id"], service_id=svc["id"],
            location_id=location["id"], start=datetime(2026, 8, 5, 10, 0),
        )
        anon = create_record(
            activity_id=a["id"], client_id=None,
            visits=[{"visitor_id": None, "price": 0, "status": "waiting"}],
        )
        other = create_record()  # decoy: default service title must NOT match
        ids = self._ids(api_client.get("/api/v1/records", params={"q": "летени"}))
        assert anon["id"] in ids and other["id"] not in ids  # LEFT OUTER join keeps NULL-client rows findable

    def test_search_null_client_absent_on_client_name_query(
        self, api_client, create_client, create_record
    ):
        cl = create_client(name="Серафима")
        named = create_record(client_id=cl["id"])
        anon = create_record(
            client_id=None,
            visits=[{"visitor_id": None, "price": 0, "status": "waiting"}],
        )
        resp = api_client.get("/api/v1/records", params={"q": "ерафим"})  # no error either way
        ids = self._ids(resp)
        assert named["id"] in ids and anon["id"] not in ids

    def test_search_cyrillic_case_insensitive(self, api_client, create_client, create_record):
        cl = create_client(name="ИВАНОВ")  # stored uppercase
        target = create_record(client_id=cl["id"])
        other = create_record()
        ids = self._ids(api_client.get("/api/v1/records", params={"q": "иванов"}))
        assert target["id"] in ids and other["id"] not in ids


class TestRecordsListSorting:
    """Server-side sorting on GET /api/v1/records (#191)."""

    @staticmethod
    def _ids(resp) -> list[str]:
        assert resp.status_code == 200
        return [r["id"] for r in resp.json()["items"]]

    def test_sort_date_asc_desc(self, api_client, create_activity, create_record):
        early = create_record(activity_id=create_activity(start=datetime(2026, 8, 4, 10, 0))["id"])
        late = create_record(activity_id=create_activity(start=datetime(2026, 8, 6, 10, 0))["id"])
        params = {"date_from": "2026-08-01", "date_to": "2026-08-10"}
        asc = self._ids(api_client.get("/api/v1/records", params={**params, "sort_by": "date", "sort_order": "asc"}))
        desc = self._ids(api_client.get("/api/v1/records", params={**params, "sort_by": "date", "sort_order": "desc"}))
        assert asc.index(early["id"]) < asc.index(late["id"])
        assert desc.index(late["id"]) < desc.index(early["id"])

    def test_sort_client_name_anonymous_first_on_asc(self, api_client, create_client, create_record):
        named = create_record(client_id=create_client(name="Анна")["id"])
        anon = create_record(
            client_id=None,
            visits=[{"visitor_id": None, "price": 0, "status": "waiting"}],
        )
        asc = self._ids(api_client.get("/api/v1/records", params={"sort_by": "client", "sort_order": "asc"}))
        assert asc.index(anon["id"]) < asc.index(named["id"])  # NULLS FIRST on asc (mirrors ''-first comparator)

    def test_sort_client_name_anonymous_last_on_desc(self, api_client, create_client, create_record):
        named = create_record(client_id=create_client(name="Анна")["id"])
        anon = create_record(
            client_id=None,
            visits=[{"visitor_id": None, "price": 0, "status": "waiting"}],
        )
        desc = self._ids(api_client.get("/api/v1/records", params={"sort_by": "client", "sort_order": "desc"}))
        assert desc.index(named["id"]) < desc.index(anon["id"])  # NULLS LAST on desc

    def test_sort_guests_counts_named_visits_not_raw_seats(self, api_client, create_record):
        # BLOCKER-guard test (#257): guests sort = seats - named_visit_count,
        # i.e. only NAMED visits count. Anonymous-only record (A: 2 named +
        # 3 anonymous → seats=5, named=2) must rank BELOW a 4-named record
        # (B: seats=4, named=4) on asc — a raw-seats sort would invert them.
        anon_heavy = create_record(visits=[
            {"name": "А1", "price": 1000, "status": "waiting"},
            {"name": "А2", "price": 1000, "status": "waiting"},
            {"visitor_id": None, "price": 0, "status": "waiting"},
            {"visitor_id": None, "price": 0, "status": "waiting"},
            {"visitor_id": None, "price": 0, "status": "waiting"},
        ])  # seats=5, named visits=2
        four = create_record(visits=[
            {"name": "Б1", "price": 1000, "status": "waiting"},
            {"name": "Б2", "price": 1000, "status": "waiting"},
            {"name": "Б3", "price": 1000, "status": "waiting"},
            {"name": "Б4", "price": 1000, "status": "waiting"},
        ])  # seats=4, named visits=4
        asc = self._ids(api_client.get("/api/v1/records", params={"sort_by": "guests", "sort_order": "asc"}))
        assert asc.index(anon_heavy["id"]) < asc.index(four["id"])  # 2 < 4; raw-seats sort would invert

    def test_sort_guests_counts_named_visits_including_cancelled(self, api_client, create_record):
        # Parity pin with the pre-#257 ``seats - anonym_visits`` semantic:
        # ALL named visits count as guests regardless of status — a record
        # whose named visits are ALL cancelled still sorts by its named
        # count (2), NOT 0. (An active-status filter on the guests
        # subquery is a possible future change — deliberately NOT
        # implemented, #257.)
        cancelled_only = create_record(visits=[
            {"name": "А1", "price": 1000, "status": "cancelled"},
            {"name": "А2", "price": 1000, "status": "cancelled"},
        ])  # 2 named, both cancelled → guests = 2 (named count kept)
        one_named = create_record(visits=[
            {"name": "Б1", "price": 1000, "status": "waiting"},
        ])  # guests = 1
        asc = self._ids(api_client.get("/api/v1/records", params={"sort_by": "guests", "sort_order": "asc"}))
        # asc: fewer named visits first — 1 before 2; an active-only filter
        # would invert this (cancelled-only would drop to 0 and sort first)
        assert asc.index(one_named["id"]) < asc.index(cancelled_only["id"])  # 1 < 2

    def test_sort_guests_desc(self, api_client, create_record):
        one = create_record(visits=[{"name": "А", "price": 1000, "status": "waiting"}])
        two = create_record(visits=[
            {"name": "А", "price": 1000, "status": "waiting"},
            {"name": "Б", "price": 1000, "status": "waiting"},
        ])
        desc = self._ids(api_client.get("/api/v1/records", params={"sort_by": "guests", "sort_order": "desc"}))
        assert desc.index(two["id"]) < desc.index(one["id"])

    def test_sort_total(self, api_client, create_record):
        cheap = create_record(visits=[{"name": "А", "price": 1000, "status": "waiting"}])
        pricey = create_record(visits=[{"name": "А", "price": 5000, "status": "waiting"}])
        ids = self._ids(api_client.get("/api/v1/records", params={"sort_by": "total", "sort_order": "asc"}))
        assert ids.index(cheap["id"]) < ids.index(pricey["id"])

    def test_sort_payment_bucket_asc(self, api_client, create_record):
        full = create_record(visits=[{"name": "А", "price": 3500, "status": "waiting"}])
        partial = create_record(visits=[{"name": "Б", "price": 3500, "status": "waiting"}])
        unpaid = create_record(visits=[{"name": "В", "price": 3500, "status": "waiting"}])
        api_client.post("/api/v1/payments", json={"record_id": full["id"], "amount": 3500, "method": "card"})
        api_client.post("/api/v1/payments", json={"record_id": partial["id"], "amount": 1500, "method": "card"})
        ids = self._ids(api_client.get("/api/v1/records", params={"sort_by": "payment", "sort_order": "asc"}))
        assert ids.index(full["id"]) < ids.index(partial["id"]) < ids.index(unpaid["id"])

    def test_sort_payment_bucket_desc(self, api_client, create_record):
        full = create_record(visits=[{"name": "А", "price": 3500, "status": "waiting"}])
        partial = create_record(visits=[{"name": "Б", "price": 3500, "status": "waiting"}])
        unpaid = create_record(visits=[{"name": "В", "price": 3500, "status": "waiting"}])
        api_client.post("/api/v1/payments", json={"record_id": full["id"], "amount": 3500, "method": "card"})
        api_client.post("/api/v1/payments", json={"record_id": partial["id"], "amount": 1500, "method": "card"})
        ids = self._ids(api_client.get("/api/v1/records", params={"sort_by": "payment", "sort_order": "desc"}))
        assert ids.index(unpaid["id"]) < ids.index(partial["id"]) < ids.index(full["id"])

    def test_sort_pages_disjoint(self, api_client, create_record):
        for _ in range(3):
            create_record()
        p1 = self._ids(api_client.get("/api/v1/records", params={"sort_by": "date", "page": 1, "per_page": 2}))
        p2 = self._ids(api_client.get("/api/v1/records", params={"sort_by": "date", "page": 2, "per_page": 2}))
        assert not set(p1) & set(p2)

    # --- name-based sorts: explicit reference names via factory overrides ---
    # create_activity spawns its own master/service/location, so for name-controlled
    # sorts build the activity manually on factories with explicit names:

    @staticmethod
    def _activity_on(api_client, *, master_id, service_id, location_id, start):
        resp = api_client.post("/api/v1/activities", json={
            "master_id": master_id, "service_id": service_id, "location_id": location_id,
            "start": start.isoformat(), "duration": 90, "capacity": 10, "is_private": False,
        })
        assert resp.status_code == 201
        return resp.json()

    def test_sort_service_title_asc_desc(self, api_client, create_master, create_service, create_location, create_record):
        master, location = create_master(), create_location()
        svc_a = create_service(title="Аква")
        svc_b = create_service(title="Яла")
        a = self._activity_on(api_client, master_id=master["id"], service_id=svc_a["id"], location_id=location["id"], start=datetime(2026, 8, 5, 10, 0))
        b = self._activity_on(api_client, master_id=master["id"], service_id=svc_b["id"], location_id=location["id"], start=datetime(2026, 8, 5, 12, 0))
        r_a = create_record(activity_id=a["id"])
        r_b = create_record(activity_id=b["id"])
        asc = self._ids(api_client.get("/api/v1/records", params={"sort_by": "service", "sort_order": "asc"}))
        desc = self._ids(api_client.get("/api/v1/records", params={"sort_by": "service", "sort_order": "desc"}))
        assert asc.index(r_a["id"]) < asc.index(r_b["id"])
        assert desc.index(r_b["id"]) < desc.index(r_a["id"])

    def test_sort_master_name_asc_desc(self, api_client, create_master, create_service, create_location, create_record):
        service, location = create_service(), create_location()
        m_a = create_master(first_name="Иван", last_name="Арбузов")
        m_b = create_master(first_name="Пётр", last_name="Яблонев")
        a = self._activity_on(api_client, master_id=m_a["id"], service_id=service["id"], location_id=location["id"], start=datetime(2026, 8, 5, 10, 0))
        b = self._activity_on(api_client, master_id=m_b["id"], service_id=service["id"], location_id=location["id"], start=datetime(2026, 8, 5, 12, 0))
        r_a = create_record(activity_id=a["id"])
        r_b = create_record(activity_id=b["id"])
        asc = self._ids(api_client.get("/api/v1/records", params={"sort_by": "master", "sort_order": "asc"}))
        desc = self._ids(api_client.get("/api/v1/records", params={"sort_by": "master", "sort_order": "desc"}))
        assert asc.index(r_a["id"]) < asc.index(r_b["id"])  # Арбузов < Яблонев (displayMasterName = "Last First")
        assert desc.index(r_b["id"]) < desc.index(r_a["id"])

    def test_sort_location_name_asc_desc(self, api_client, create_master, create_service, create_location, create_record):
        master, service = create_master(), create_service()
        l_a = create_location(name="Арбат")
        l_b = create_location(name="Яуза")
        a = self._activity_on(api_client, master_id=master["id"], service_id=service["id"], location_id=l_a["id"], start=datetime(2026, 8, 5, 10, 0))
        b = self._activity_on(api_client, master_id=master["id"], service_id=service["id"], location_id=l_b["id"], start=datetime(2026, 8, 5, 12, 0))
        r_a = create_record(activity_id=a["id"])
        r_b = create_record(activity_id=b["id"])
        asc = self._ids(api_client.get("/api/v1/records", params={"sort_by": "location", "sort_order": "asc"}))
        desc = self._ids(api_client.get("/api/v1/records", params={"sort_by": "location", "sort_order": "desc"}))
        assert asc.index(r_a["id"]) < asc.index(r_b["id"])
        assert desc.index(r_b["id"]) < desc.index(r_a["id"])

    def test_sort_status_asc_desc(self, api_client, create_record):
        visited = create_record(visits=[{"name": "А", "price": 1000, "status": "visited"}])
        waiting = create_record()  # visits default status waiting
        asc = self._ids(api_client.get("/api/v1/records", params={"sort_by": "status", "sort_order": "asc"}))
        desc = self._ids(api_client.get("/api/v1/records", params={"sort_by": "status", "sort_order": "desc"}))
        assert asc.index(visited["id"]) < asc.index(waiting["id"])  # 'visited' < 'waiting'
        assert desc.index(waiting["id"]) < desc.index(visited["id"])

    def test_sort_total_desc(self, api_client, create_record):
        cheap = create_record(visits=[{"name": "А", "price": 1000, "status": "waiting"}])
        pricey = create_record(visits=[{"name": "А", "price": 5000, "status": "waiting"}])
        ids = self._ids(api_client.get("/api/v1/records", params={"sort_by": "total", "sort_order": "desc"}))
        assert ids.index(pricey["id"]) < ids.index(cheap["id"])


class TestRecordsList422:
    """Explicit 422 validation on GET /api/v1/records (#191, #182 style)."""

    @pytest.mark.parametrize("params", [
        {"sort_by": "bogus"},
        {"sort_order": "sideways"},
        {"status": "bogus"},
        {"date_from": "not-a-date"},
        {"date_from": "2026-08-09", "date_to": "2026-08-03"},
    ])
    def test_invalid_params_return_422(self, api_client, params):
        resp = api_client.get("/api/v1/records", params=params)
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"


# ─── Unified DELETE route (GH #139, Addendum 13) ─────────────────────────────


def _link_record_tag(api_client, record_id: str, tag_name: str | None = None) -> str:
    """Insert a ``record_tags`` join row directly via SQL and return the tag id.

    The records API does not expose tag linking on create/update, so we go via
    ``query_db`` to seed the auto-cascade dep (FK-ON-safe: both ids exist).
    """
    tag_name = tag_name or f"rt-{record_id[:8]}"
    tag_id = api_client.post("/api/v1/tags", json={"tag": tag_name}).json()["id"]
    query_db(
        f"INSERT INTO record_tags (record_id, tag_id) "
        f"VALUES ('{record_id}', '{tag_id}')"
    )
    return tag_id


@pytest.fixture
def sse_subscriber():
    """Subscribe to the event hub for ONE test; drain/unsubscribe on exit.

    Same mechanism as the ``subscriber`` fixture in test_events_emit.py
    (module-local there); the test drains setup noise before the mutation
    under check and asserts the post-mutation queue is empty.
    """
    from src.events.hub import hub

    q = hub.subscribe()
    try:
        yield q
    finally:
        hub.unsubscribe(q)


def _drain_events(q) -> list:
    """Collect everything currently sitting in the hub queue."""
    events = []
    while not q.empty():
        events.append(q.get_nowait())
    return events


class TestDeleteUnifiedRoute:
    """DELETE /api/v1/records/{id} — unified delete contract (dry-run preview /
    body with expected id-sets; no-body forbidden).

    #285 rev7: the legacy no-body "execute-if-clean" mode is REMOVED. Modes:
      * ?dry_run=true — pure preview: collect_dependencies → empty → 204
        WITHOUT deleting; non-empty → 409 + dependency tree; missing → 404.
        Never modifies rows, emits no SSE; combined with a resolutions
        body → 422.
      * No body, no flag → 422 {"detail": "expected_state_required"} —
        every real deletion must declare its state.
      * Body {"expected": {...}} — the deferred-delete commit: ``expected``
        id-sets (rev6) are verified against the CURRENT dependency tree
        BEFORE the resolutions validation; mismatch → 409
        ``stale_dependencies`` + tree. Subset semantics (rev6): a dep that
        disappeared in the undo window does not block (deleting less than
        confirmed); a dep that APPEARED does. Auto-deps (record_tags) are
        exempt. Clean record + {"expected": {}} → 204 hard delete.
      * Body {"resolutions": {...}, "expected": {...}} — expected check →
        resolutions validation (§6) → atomic cascade → 204. A cascade
        commit WITHOUT ``expected`` → 422 expected_state_required.

    Record deps (Addendum 13):
      * visits   → cascade, auto=False (user choice)
      * payments → cascade, auto=False (user choice)
      * record_tags → cascade, auto=True (join rows)

    No blocking deps (allowed_actions never empty for Record); no undo flow.
    Execution stays in RecordService.delete (the @transactional cascade
    visits → payments → record_tags → record) — NOT through CASCADE_HANDLERS.
    """

    # ── rev7: no-body DELETE without flag → 422 expected_state_required ────

    def test_delete_no_body_without_flag_returns_422(
        self, api_client, create_activity, create_client
    ) -> None:
        """Rev7: bare DELETE (no body, no flag) → 422, row untouched."""
        activity = create_activity()
        client = create_client()
        record = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "client_id": client["id"],
            "visits": [],
        }).json()

        resp = api_client.delete(f"/api/v1/records/{record['id']}")

        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"
        # Row untouched (the legacy execute-if-clean path is gone).
        assert api_client.get(f"/api/v1/records/{record['id']}").status_code == 200

    def test_delete_no_body_nonexistent_returns_422(self, api_client) -> None:
        """Rev7 rejects the request shape before any DB probe (not a 404)."""
        resp = api_client.delete("/api/v1/records/nonexistent-record-id")
        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"

    def test_delete_no_body_with_deps_returns_422(
        self, api_client, create_record
    ) -> None:
        """Rev7: bare DELETE on a record with deps → 422, not a 409 preview."""
        record = create_record(
            visits=[{"name": "Alice", "price": 3500, "status": "waiting"}]
        )
        record_id = record["id"]
        # Add a payment (dep).
        api_client.post("/api/v1/payments", json={
            "record_id": record_id, "amount": 1000, "method": "cash",
        })
        # Add a record_tag (auto dep).
        _link_record_tag(api_client, record_id, tag_name=f"rt-{record_id[:8]}")

        resp = api_client.delete(f"/api/v1/records/{record_id}")

        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"
        # Row untouched.
        assert api_client.get(f"/api/v1/records/{record_id}").status_code == 200

    def test_delete_nonexistent_record_with_body_returns_404(self, api_client) -> None:
        """With body + nonexistent id → 404 (scope probe fires first)."""
        resp = api_client.request(
            "DELETE",
            "/api/v1/records/nonexistent-record-id",
            json={
                "resolutions": {"visits": "cascade", "payments": "cascade"},
                "expected": {},
            },
        )
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "RECORD_NOT_FOUND"

    def test_delete_clean_record_with_expected_empty_body_returns_204(
        self, api_client, create_activity, create_client
    ) -> None:
        """Execution moved to the body branch: {"expected": {}} + clean → 204.

        The commit of the deferred delete always carries the declared state;
        for a clean record that is an empty ``expected`` id-set (spec §3 D1).
        """
        activity = create_activity()
        client = create_client()
        record = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "client_id": client["id"],
            "visits": [],
        }).json()

        resp = api_client.request(
            "DELETE",
            f"/api/v1/records/{record['id']}",
            json={"expected": {}},
        )

        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/records/{record['id']}").status_code == 404

    # ── expected id-set verification (rev5/rev6) — BEFORE resolutions ─────

    def test_expected_payment_appeared_in_window_returns_409_stale(
        self, api_client, create_record
    ) -> None:
        """(б) Payment landed in the undo window → 409 stale_dependencies.

        The record was clean at dry-run time (expected: {}); a payment
        appeared before the deferred commit → the id-set check must refuse
        the delete and leave the record AND the payment alive.
        """
        record = create_record(visits=[])  # clean at dry-run time
        record_id = record["id"]
        api_client.post("/api/v1/payments", json={
            "record_id": record_id, "amount": 1000, "method": "cash",
        })

        resp = api_client.request(
            "DELETE",
            f"/api/v1/records/{record_id}",
            json={"expected": {}},
        )

        assert resp.status_code == 409
        body = resp.json()
        assert body["detail"] == "stale_dependencies"
        # Current tree in DependencyNode shape (parsed by ApiError.dependencies).
        deps = {d["entity"]: d for d in body["dependencies"]}
        assert deps["payments"]["count"] == 1
        assert deps["payments"]["allowed_actions"] == ["cascade"]
        # Nothing deleted.
        assert api_client.get(f"/api/v1/records/{record_id}").status_code == 200
        assert query_db(
            f"SELECT * FROM payments WHERE record_id='{record_id}'"
        ), "payment must survive the stale commit"

    def test_expected_cascade_matching_ids_executes_204(
        self, api_client, create_record
    ) -> None:
        """(в) 2 visits + resolutions + expected {visits: [id1, id2]} → 204."""
        record = create_record(
            visits=[
                {"name": "Alice", "price": 3500, "status": "waiting"},
                {"name": "Bob", "price": 2500, "status": "waiting"},
            ]
        )
        record_id = record["id"]
        visit_ids = [v["id"] for v in record["visits"]]

        resp = api_client.request(
            "DELETE",
            f"/api/v1/records/{record_id}",
            json={
                "resolutions": {"visits": "cascade", "payments": "cascade"},
                "expected": {"visits": visit_ids, "payments": []},
            },
        )

        assert resp.status_code == 204
        # Cascade executed: record + visits gone.
        assert api_client.get(f"/api/v1/records/{record_id}").status_code == 404
        for vid in visit_ids:
            assert query_db(f"SELECT * FROM visits WHERE id='{vid}'") == []

    def test_expected_extra_visit_appeared_returns_409_not_422(
        self, api_client, create_record
    ) -> None:
        """(г) Valid resolutions but stale expected (visit appeared) → 409.

        Pins the ORDER: the expected id-set check runs BEFORE the
        resolutions validation — the commit fails with 409
        stale_dependencies, not 422, and nothing is deleted.
        """
        record = create_record(
            visits=[
                {"name": "Alice", "price": 3500, "status": "waiting"},
                {"name": "Bob", "price": 2500, "status": "waiting"},
            ]
        )
        record_id = record["id"]
        visit_ids = [v["id"] for v in record["visits"]]
        # The race: a third visit appears between dry-run and commit.
        visitor = api_client.post("/api/v1/visitors", json={
            "client_id": record["client_id"], "name": "Carol", "age": 40,
        }).json()
        extra_visit = api_client.post(
            "/api/v1/visits",
            json={
                "record_id": record_id,
                "visitor_id": visitor["id"],
                "price": 1500,
            },
        )
        assert extra_visit.status_code == 201, extra_visit.text

        resp = api_client.request(
            "DELETE",
            f"/api/v1/records/{record_id}",
            json={
                "resolutions": {"visits": "cascade", "payments": "cascade"},
                "expected": {"visits": [visit_ids[0]]},
            },
        )

        assert resp.status_code == 409, f"got {resp.status_code}: {resp.text}"
        assert resp.json()["detail"] == "stale_dependencies"
        # Nothing deleted — record and BOTH confirmed visits survive.
        assert api_client.get(f"/api/v1/records/{record_id}").status_code == 200
        for vid in visit_ids:
            assert query_db(f"SELECT * FROM visits WHERE id='{vid}'") != []

    def test_expected_exchange_same_counter_returns_409(
        self, api_client, create_record
    ) -> None:
        """(д) Swap at equal counter: expected [a], DB holds visit b → 409.

        rev6: id-sets, not counters — the counters would both read 1, but
        the confirmed id is not among the current rows → stale.
        """
        record = create_record(
            visits=[{"name": "Alice", "price": 3500, "status": "waiting"}]
        )
        record_id = record["id"]
        db_visit_id = record["visits"][0]["id"]
        ghost_id = str(_uuid.uuid4())

        resp = api_client.request(
            "DELETE",
            f"/api/v1/records/{record_id}",
            json={
                "resolutions": {"visits": "cascade", "payments": "cascade"},
                "expected": {"visits": [ghost_id]},
            },
        )

        assert resp.status_code == 409
        assert resp.json()["detail"] == "stale_dependencies"
        assert api_client.get(f"/api/v1/records/{record_id}").status_code == 200
        assert query_db(f"SELECT * FROM visits WHERE id='{db_visit_id}'") != []

    def test_expected_dep_disappeared_subset_passes_204(
        self, api_client, create_record
    ) -> None:
        """(е) Dependency vanished in the window → subset → 204 (delete less).

        expected claims visit «a»; by commit time the record has no visits.
        Subset (not equality) semantics: deleting less than confirmed is OK.
        """
        record = create_record(visits=[])  # clean by commit time
        record_id = record["id"]
        ghost_id = str(_uuid.uuid4())

        resp = api_client.request(
            "DELETE",
            f"/api/v1/records/{record_id}",
            json={"expected": {"visits": [ghost_id]}},
        )

        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/records/{record_id}").status_code == 404

    def test_expected_missing_entity_key_that_appeared_returns_409(
        self, api_client, create_record
    ) -> None:
        """(ж) expected covers visits but omits the payments key → 409.

        The payment exists in the DB but ``expected`` has no "payments" key
        at all — the missing key means «nothing was confirmed» for that
        entity → any current row is a stale dependency.
        """
        record = create_record(
            visits=[
                {"name": "Alice", "price": 3500, "status": "waiting"},
                {"name": "Bob", "price": 2500, "status": "waiting"},
            ]
        )
        record_id = record["id"]
        visit_ids = [v["id"] for v in record["visits"]]
        api_client.post("/api/v1/payments", json={
            "record_id": record_id, "amount": 1000, "method": "cash",
        })

        resp = api_client.request(
            "DELETE",
            f"/api/v1/records/{record_id}",
            json={
                "resolutions": {"visits": "cascade", "payments": "cascade"},
                "expected": {"visits": visit_ids},  # no "payments" key
            },
        )

        assert resp.status_code == 409
        body = resp.json()
        assert body["detail"] == "stale_dependencies"
        deps = {d["entity"]: d for d in body["dependencies"]}
        assert deps["payments"]["count"] == 1
        # Nothing deleted.
        assert api_client.get(f"/api/v1/records/{record_id}").status_code == 200

    def test_resolutions_without_expected_returns_422_expected_state_required(
        self, api_client, create_record
    ) -> None:
        """(з) rev7: cascade body without ``expected`` → 422, row untouched.

        Every real deletion must carry the declared state — a resolutions
        body alone is the rejected legacy shape.
        """
        record = create_record(
            visits=[{"name": "Alice", "price": 3500, "status": "waiting"}]
        )
        record_id = record["id"]

        resp = api_client.request(
            "DELETE",
            f"/api/v1/records/{record_id}",
            json={"resolutions": {"visits": "cascade", "payments": "cascade"}},
        )

        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"
        # Row untouched.
        assert api_client.get(f"/api/v1/records/{record_id}").status_code == 200
        assert record["visits"], "visits untouched too"

    # ── ?dry_run=true — pure preview (never modifies rows) ────────────────

    def test_dry_run_with_deps_returns_409_tree_and_row_alive(
        self, api_client, create_record
    ) -> None:
        """(а) dry-run on a record with deps → 409 + tree; row alive."""
        record = create_record(
            visits=[{"name": "Alice", "price": 3500, "status": "waiting"}]
        )
        record_id = record["id"]
        # Add a payment (dep).
        api_client.post("/api/v1/payments", json={
            "record_id": record_id, "amount": 1000, "method": "cash",
        })
        # Add a record_tag (auto dep).
        _link_record_tag(api_client, record_id, tag_name=f"rt-{record_id[:8]}")

        def _dep_counts() -> tuple[int, int, int]:
            return (
                query_db(
                    f"SELECT COUNT(*) AS c FROM visits WHERE record_id='{record_id}'"
                )[0]["c"],
                query_db(
                    f"SELECT COUNT(*) AS c FROM payments WHERE record_id='{record_id}'"
                )[0]["c"],
                query_db(
                    f"SELECT COUNT(*) AS c FROM record_tags WHERE record_id='{record_id}'"
                )[0]["c"],
            )

        before = _dep_counts()

        resp = api_client.request(
            "DELETE", f"/api/v1/records/{record_id}", params={"dry_run": "true"}
        )

        assert resp.status_code == 409
        body = resp.json()
        assert body["detail"] == "has_dependencies"
        deps = {d["entity"]: d for d in body["dependencies"]}
        assert deps["visits"]["count"] == 1
        assert deps["visits"]["allowed_actions"] == ["cascade"]
        assert deps["visits"]["cascade_preview"] is None
        assert deps["payments"]["count"] == 1
        assert deps["payments"]["allowed_actions"] == ["cascade"]
        assert deps["record_tags"]["count"] == 1
        assert deps["record_tags"]["allowed_actions"] == ["cascade"]
        # Record alive, dependency counters unchanged.
        assert api_client.get(f"/api/v1/records/{record_id}").status_code == 200
        assert _dep_counts() == before

    def test_dry_run_clean_record_returns_204_and_row_alive(
        self, api_client, create_activity, create_client
    ) -> None:
        """(б) dry-run on a clean record → 204 WITHOUT deleting; row alive."""
        activity = create_activity()
        client = create_client()
        record = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "client_id": client["id"],
            "visits": [],
        }).json()

        resp = api_client.request(
            "DELETE", f"/api/v1/records/{record['id']}", params={"dry_run": "true"}
        )

        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/records/{record['id']}").status_code == 200

    def test_dry_run_nonexistent_record_returns_404(self, api_client) -> None:
        """(в) dry-run probes existence: missing record → 404, same format."""
        resp = api_client.request(
            "DELETE", "/api/v1/records/nonexistent-record-id",
            params={"dry_run": "true"},
        )
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "RECORD_NOT_FOUND"

    def test_dry_run_with_resolutions_body_returns_422(
        self, api_client, create_record
    ) -> None:
        """(г) dry_run + resolutions body → 422; combo checked before probe."""
        record = create_record(visits=[])  # clean record

        for record_id in (record["id"], "nonexistent-record-id"):
            resp = api_client.request(
                "DELETE",
                f"/api/v1/records/{record_id}",
                params={"dry_run": "true"},
                json={"resolutions": {"visits": "cascade", "payments": "cascade"}},
            )
            assert resp.status_code == 422, f"{record_id}: {resp.text}"
            assert resp.json()["detail"] == "dry_run_with_resolutions_forbidden"

        # Row untouched.
        assert api_client.get(f"/api/v1/records/{record['id']}").status_code == 200

    def test_delete_record_with_cascade_resolutions_executes_204(
        self, api_client, create_record
    ) -> None:
        """With body → atomic cascade (visits → payments → record_tags → record) → 204.

        The executor is RecordService.delete (the existing @transactional
        cascade); validation runs via the deletion layer free functions
        (has_blocking_deps / validate_resolutions) before execution.
        """
        record = create_record(
            visits=[
                {"name": "Alice", "price": 3500, "status": "waiting"},
                {"name": "Bob", "price": 2500, "status": "waiting"},
            ]
        )
        record_id = record["id"]
        # Capture visit IDs.
        visit_ids = [v["id"] for v in record["visits"]]
        assert len(visit_ids) == 2
        # Add a payment.
        payment = api_client.post("/api/v1/payments", json={
            "record_id": record_id, "amount": 1000, "method": "cash",
        }).json()
        payment_id = payment["id"]
        # Add a record_tag (auto dep).
        _link_record_tag(api_client, record_id, tag_name=f"rt-{record_id[:8]}")

        # dry-run preview → 409 (deps present).
        resp = api_client.request(
            "DELETE", f"/api/v1/records/{record_id}", params={"dry_run": "true"}
        )
        assert resp.status_code == 409

        # With-body execute → 204. The commit carries both the user's
        # resolutions and the state confirmed at dry-run (rev7).
        resp = api_client.request(
            "DELETE",
            f"/api/v1/records/{record_id}",
            json={
                "resolutions": {"visits": "cascade", "payments": "cascade"},
                "expected": {"visits": visit_ids, "payments": [payment_id]},
            },
        )
        assert resp.status_code == 204

        # Cascade verification: record + visits + payments + record_tags gone.
        assert api_client.get(f"/api/v1/records/{record_id}").status_code == 404
        for vid in visit_ids:
            assert query_db(f"SELECT * FROM visits WHERE id='{vid}'") == []
        assert query_db(f"SELECT * FROM payments WHERE id='{payment_id}'") == []
        assert query_db(
            f"SELECT * FROM record_tags WHERE record_id='{record_id}'"
        ) == []

    def test_delete_record_with_wrong_action_returns_422(
        self, api_client, create_record
    ) -> None:
        """§6 rule 1: visits:cascade only; sending nullify → 422."""
        record = create_record(
            visits=[{"name": "Alice", "price": 3500, "status": "waiting"}]
        )
        record_id = record["id"]
        visit_id = record["visits"][0]["id"]
        # Add a payment so both non-auto deps are present.
        payment = api_client.post("/api/v1/payments", json={
            "record_id": record_id, "amount": 500, "method": "cash",
        }).json()

        resp = api_client.request(
            "DELETE",
            f"/api/v1/records/{record_id}",
            json={
                "resolutions": {"visits": "nullify", "payments": "cascade"},
                # expected matches the DB — the 422 must come from the
                # resolutions validation, not from the expected check.
                "expected": {"visits": [visit_id], "payments": [payment["id"]]},
            },
        )

        assert resp.status_code == 422
        # Row untouched.
        assert api_client.get(f"/api/v1/records/{record_id}").status_code == 200

    def test_delete_record_with_missing_dep_returns_422(
        self, api_client, create_record
    ) -> None:
        """§6 rule 2: body omits payments (a required non-auto dep) → 422."""
        record = create_record(
            visits=[{"name": "Alice", "price": 3500, "status": "waiting"}]
        )
        record_id = record["id"]
        visit_id = record["visits"][0]["id"]
        # Add a payment so payments is a required non-auto dep.
        payment = api_client.post("/api/v1/payments", json={
            "record_id": record_id, "amount": 500, "method": "cash",
        }).json()

        resp = api_client.request(
            "DELETE",
            f"/api/v1/records/{record_id}",
            json={
                "resolutions": {"visits": "cascade"},  # no payments resolution
                # expected matches the DB — the 422 must come from the
                # resolutions validation, not from the expected check.
                "expected": {"visits": [visit_id], "payments": [payment["id"]]},
            },
        )

        assert resp.status_code == 422
        assert api_client.get(f"/api/v1/records/{record_id}").status_code == 200

    # ── (е) dry-run emits no SSE (pattern: test_events_emit.py:128-146) ────

    def test_dry_run_204_emits_no_sse_events(
        self, api_client, create_record, sse_subscriber
    ) -> None:
        """Clean record: dry-run → 204 without executing — zero SSE marks."""
        record = create_record(visits=[])  # clean record
        _drain_events(sse_subscriber)  # discard setup noise

        resp = api_client.request(
            "DELETE", f"/api/v1/records/{record['id']}", params={"dry_run": "true"}
        )

        assert resp.status_code == 204
        assert _drain_events(sse_subscriber) == []
        assert api_client.get(f"/api/v1/records/{record['id']}").status_code == 200

    def test_dry_run_409_emits_no_sse_events(
        self, api_client, create_record, sse_subscriber
    ) -> None:
        """Deps record: dry-run 409 preview emits no SSE marks."""
        record = create_record()  # 1 visit → deps
        _drain_events(sse_subscriber)

        resp = api_client.request(
            "DELETE", f"/api/v1/records/{record['id']}", params={"dry_run": "true"}
        )

        assert resp.status_code == 409
        assert _drain_events(sse_subscriber) == []
        assert api_client.get(f"/api/v1/records/{record['id']}").status_code == 200


class TestDependencyItemsIn409Tree:
    """D9б/в (#285): the 409 dependency tree for RECORDS carries ``items`` —
    a one-line human label per dependent row (``{id, label}``), for the
    visits / payments / record_tags nodes, so the DeleteDialog renders
    "what exactly will be deleted" entries instead of bare counts.

    Pinned label formats (plan D9б/в):
      * Visit   → «{service.title}, {price}» (service via ``tariff_id``);
        ``tariff_id IS NULL`` → «Без тарифа, {price}»; tariff whose
        service row is missing → fallback «Без тарифа, {price}».
      * Payment → «{amount}, {method}»; ``method IS NULL`` → «{amount}, —».
      * record_tags → «{tag name}» per link row (id = tag_id).

    Other entities (e.g. Client) keep the bare tree — ``items`` stays
    None (§5: their dialogs are unchanged). Both 409 paths
    (``has_dependencies`` dry-run and ``stale_dependencies`` commit) go
    through ``collect_dependencies`` → items appear in BOTH.
    """

    def test_dry_run_409_visits_payments_items(
        self, api_client, create_record, create_service
    ) -> None:
        """(а) dry-run 409: visits/payments nodes carry id + pinned labels."""
        service = create_service(title="МК Гончарное дело")
        tariff_id = f"tariff-{_uuid.uuid4().hex[:8]}"
        query_db(
            "INSERT INTO tariffs (id, service_id, title, price, is_active, "
            "created_at, updated_at) VALUES "
            f"('{tariff_id}', '{service['id']}', 'Adult', 3500, 1, "
            "datetime('now'), datetime('now'))"
        )
        record = create_record(
            visits=[
                {"name": "Alice", "price": 3500, "status": "waiting", "tariff_id": tariff_id},
                {"name": "Bob", "price": 2500, "status": "waiting"},
            ]
        )
        record_id = record["id"]
        visit_t = next(v for v in record["visits"] if v["tariff_id"] == tariff_id)
        visit_no_t = next(v for v in record["visits"] if v["tariff_id"] is None)
        payment_cash = api_client.post("/api/v1/payments", json={
            "record_id": record_id, "amount": 1000, "method": "cash",
        }).json()
        payment_free = api_client.post("/api/v1/payments", json={
            "record_id": record_id, "amount": 500,
        }).json()

        resp = api_client.request(
            "DELETE", f"/api/v1/records/{record_id}", params={"dry_run": "true"}
        )

        assert resp.status_code == 409, resp.text
        deps = {d["entity"]: d for d in resp.json()["dependencies"]}
        visits_items = {i["id"]: i["label"] for i in deps["visits"]["items"]}
        assert visits_items == {
            visit_t["id"]: f"{service['title']}, 3500",
            visit_no_t["id"]: "Без тарифа, 2500",
        }
        payments_items = {i["id"]: i["label"] for i in deps["payments"]["items"]}
        assert payments_items == {
            payment_cash["id"]: "1000, cash",
            payment_free["id"]: "500, —",
        }

    def test_dry_run_409_visits_items_tariff_without_service_fallback(
        self, api_client, create_record, sample_tariff
    ) -> None:
        """Fallback (D9б): tariff row exists but its service row doesn't.

        Not reachable via the FK matrix (tariffs.service_id NOT NULL with a
        real service) but pinned: the title degrades to «Без тарифа», the
        price stays — «Без тарифа, {price}».
        """
        record = create_record(
            visits=[
                {"name": "Alice", "price": 3500, "status": "waiting", "tariff_id": sample_tariff},
            ]
        )
        visit_id = record["visits"][0]["id"]

        resp = api_client.request(
            "DELETE", f"/api/v1/records/{record['id']}", params={"dry_run": "true"}
        )

        assert resp.status_code == 409
        deps = {d["entity"]: d for d in resp.json()["dependencies"]}
        assert deps["visits"]["items"] == [
            {"id": visit_id, "label": "Без тарифа, 3500"},
        ]

    def test_dry_run_409_items_counts_and_preview_unchanged(
        self, api_client, create_record, create_service
    ) -> None:
        """(д) items are additive: count/cascade_preview stay as before."""
        service = create_service()
        tariff_id = f"tariff-{_uuid.uuid4().hex[:8]}"
        query_db(
            "INSERT INTO tariffs (id, service_id, title, price, is_active, "
            "created_at, updated_at) VALUES "
            f"('{tariff_id}', '{service['id']}', 'Adult', 3500, 1, "
            "datetime('now'), datetime('now'))"
        )
        record = create_record(
            visits=[
                {"name": "Alice", "price": 3500, "status": "waiting", "tariff_id": tariff_id},
                {"name": "Bob", "price": 2500, "status": "waiting"},
            ]
        )
        record_id = record["id"]
        api_client.post("/api/v1/payments", json={
            "record_id": record_id, "amount": 1000, "method": "cash",
        }).json()

        resp = api_client.request(
            "DELETE", f"/api/v1/records/{record_id}", params={"dry_run": "true"}
        )

        assert resp.status_code == 409
        deps = {d["entity"]: d for d in resp.json()["dependencies"]}
        assert deps["visits"]["count"] == 2 == len(deps["visits"]["items"])
        assert deps["visits"]["allowed_actions"] == ["cascade"]
        assert deps["visits"]["cascade_preview"] is None
        assert deps["payments"]["count"] == 1 == len(deps["payments"]["items"])
        assert deps["payments"]["cascade_preview"] is None

    def test_dry_run_409_record_tags_items(
        self, api_client, create_record
    ) -> None:
        """(в) record_tags node (when present) items = tag name labels."""
        record = create_record(visits=[])  # no visits/payments deps
        tag_id = _link_record_tag(api_client, record["id"], tag_name="VIP")
        record_id = record["id"]

        resp = api_client.request(
            "DELETE", f"/api/v1/records/{record_id}", params={"dry_run": "true"}
        )

        assert resp.status_code == 409
        deps = {d["entity"]: d for d in resp.json()["dependencies"]}
        assert deps["record_tags"]["count"] == 1
        assert deps["record_tags"]["items"] == [{"id": tag_id, "label": "VIP"}]

    def test_stale_dependencies_409_carries_items_too(
        self, api_client, create_record
    ) -> None:
        """Both 409 paths serialize items: stale_dependencies tree too."""
        record = create_record(visits=[])  # clean at dry-run time
        record_id = record["id"]
        payment = api_client.post("/api/v1/payments", json={
            "record_id": record_id, "amount": 1000, "method": "card",
        }).json()
        # The race: the payment landed in the undo window.

        resp = api_client.request(
            "DELETE", f"/api/v1/records/{record_id}", json={"expected": {}}
        )

        assert resp.status_code == 409
        body = resp.json()
        assert body["detail"] == "stale_dependencies"
        deps = {d["entity"]: d for d in body["dependencies"]}
        assert deps["payments"]["items"] == [
            {"id": payment["id"], "label": "1000, card"},
        ]

    def test_client_409_tree_has_no_items(self, api_client, create_record) -> None:
        """(г) Other entities: the Client 409 tree stays without items."""
        record = create_record()
        client_id = record["client_id"]

        resp = api_client.delete(f"/api/v1/clients/{client_id}")

        assert resp.status_code == 409
        deps = resp.json()["dependencies"]
        assert deps, "client with a record must have deps"
        for dep in deps:
            assert dep.get("items") is None, dep["entity"]
