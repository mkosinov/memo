"""Tests for the Records + Visits CRUD API endpoints."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from tests.conftest import query_db

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

        # Delete (with-body execute — record has visits as deps, GH #139)
        response = api_client.request(
            "DELETE",
            f"/api/v1/records/{record_id}",
            json={"resolutions": {"visits": "cascade", "payments": "cascade"}},
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
        anon = create_record(activity_id=a["id"], client_id=None, visits=[], anonym_visits=2)
        other = create_record()  # decoy: default service title must NOT match
        ids = self._ids(api_client.get("/api/v1/records", params={"q": "летени"}))
        assert anon["id"] in ids and other["id"] not in ids  # LEFT OUTER join keeps NULL-client rows findable

    def test_search_null_client_absent_on_client_name_query(
        self, api_client, create_client, create_record
    ):
        cl = create_client(name="Серафима")
        named = create_record(client_id=cl["id"])
        anon = create_record(client_id=None, visits=[], anonym_visits=1)
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
        anon = create_record(client_id=None, visits=[], anonym_visits=1)
        asc = self._ids(api_client.get("/api/v1/records", params={"sort_by": "client", "sort_order": "asc"}))
        assert asc.index(anon["id"]) < asc.index(named["id"])  # NULLS FIRST on asc (mirrors ''-first comparator)

    def test_sort_client_name_anonymous_last_on_desc(self, api_client, create_client, create_record):
        named = create_record(client_id=create_client(name="Анна")["id"])
        anon = create_record(client_id=None, visits=[], anonym_visits=1)
        desc = self._ids(api_client.get("/api/v1/records", params={"sort_by": "client", "sort_order": "desc"}))
        assert desc.index(named["id"]) < desc.index(anon["id"])  # NULLS LAST on desc

    def test_sort_guests_counts_live_visits_not_anonym_seats(self, api_client, create_record):
        # BLOCKER-guard test: anonym-visits record must sort by live visits count (seats - anonym_visits)
        anon = create_record(visits=[], anonym_visits=3)   # seats=3, live visits=0
        two = create_record(visits=[
            {"name": "А", "price": 1000, "status": "waiting"},
            {"name": "Б", "price": 1000, "status": "waiting"},
        ])  # seats=2, live visits=2
        asc = self._ids(api_client.get("/api/v1/records", params={"sort_by": "guests", "sort_order": "asc"}))
        assert asc.index(anon["id"]) < asc.index(two["id"])  # 0 < 2; raw-seats sort would invert

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


class TestDeleteUnifiedRoute:
    """DELETE /api/v1/records/{id} — unified dry-run (no body) + execute (with body).

    Mirrors the masters/clients deletion suites. Record deps (Addendum 13):
      * visits   → cascade, auto=False (user choice)
      * payments → cascade, auto=False (user choice)
      * record_tags → cascade, auto=True (join rows)

    No blocking deps (allowed_actions never empty for Record); no undo flow.
    Record with zero deps → instant 204 (Materials-like path).
    Execution stays in RecordService.delete (the @transactional cascade
    visits → payments → record_tags → record) — NOT through CASCADE_HANDLERS.
    """

    def test_delete_bare_record_no_deps_returns_204_and_row_gone(
        self, api_client, create_activity, create_client
    ) -> None:
        """No body + zero deps (record with no visits/payments/tags) → 204."""
        activity = create_activity()
        client = create_client()
        record = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "client_id": client["id"],
            "visits": [],
        }).json()

        resp = api_client.delete(f"/api/v1/records/{record['id']}")

        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/records/{record['id']}").status_code == 404

    def test_delete_nonexistent_record_no_body_returns_404(self, api_client) -> None:
        """No body + nonexistent id → 404."""
        resp = api_client.delete("/api/v1/records/nonexistent-record-id")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "RECORD_NOT_FOUND"

    def test_delete_nonexistent_record_with_body_returns_404(self, api_client) -> None:
        """With body + nonexistent id → 404 (resolve_delete returns False)."""
        resp = api_client.request(
            "DELETE",
            "/api/v1/records/nonexistent-record-id",
            json={"resolutions": {"visits": "cascade", "payments": "cascade"}},
        )
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "RECORD_NOT_FOUND"

    def test_delete_record_with_deps_no_body_returns_409(
        self, api_client, create_record
    ) -> None:
        """No body + deps (visits + payments + record_tags) → 409 + tree."""
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
        # Row untouched (dry-run modifies nothing).
        assert api_client.get(f"/api/v1/records/{record_id}").status_code == 200

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

        # No-body dry-run → 409 (deps present).
        resp = api_client.delete(f"/api/v1/records/{record_id}")
        assert resp.status_code == 409

        # With-body execute → 204.
        resp = api_client.request(
            "DELETE",
            f"/api/v1/records/{record_id}",
            json={"resolutions": {"visits": "cascade", "payments": "cascade"}},
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
        # Add a payment so both non-auto deps are present.
        api_client.post("/api/v1/payments", json={
            "record_id": record_id, "amount": 500, "method": "cash",
        })

        resp = api_client.request(
            "DELETE",
            f"/api/v1/records/{record_id}",
            json={"resolutions": {"visits": "nullify", "payments": "cascade"}},
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
        # Add a payment so payments is a required non-auto dep.
        api_client.post("/api/v1/payments", json={
            "record_id": record_id, "amount": 500, "method": "cash",
        })

        resp = api_client.request(
            "DELETE",
            f"/api/v1/records/{record_id}",
            json={"resolutions": {"visits": "cascade"}},  # no payments resolution
        )

        assert resp.status_code == 422
        assert api_client.get(f"/api/v1/records/{record_id}").status_code == 200
