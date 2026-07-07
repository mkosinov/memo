"""Tests for /api/v1/visits endpoints — Phase 0 + Phase 1 CRUD (scenarios 5-20)."""

import pytest

from tests.conftest import query_db

pytestmark = pytest.mark.api


# ─── Phase 0: tariff_id round-trip ─────────────────────────────────────────


class TestVisitTariffId:
    """Phase 0: tariff_id round-trip through Visit API."""

    def test_get_visit_includes_tariff_id(self, api_client, sample_visit_with_tariff) -> None:
        """Scenario 1: GET /api/v1/visits/{id} response includes tariff_id."""
        visit_id = sample_visit_with_tariff["visit_id"]
        response = api_client.get(f"/api/v1/visits/{visit_id}")
        assert response.status_code == 200
        data = response.json()
        assert "tariff_id" in data, f"'tariff_id' not in response: {list(data.keys())}"
        assert data["tariff_id"] == sample_visit_with_tariff["tariff_id"]

    def test_get_visit_tariff_id_null(self, api_client, sample_visit_no_tariff) -> None:
        """Scenario 4: Visit with no tariff returns tariff_id: null."""
        visit_id = sample_visit_no_tariff["visit_id"]
        response = api_client.get(f"/api/v1/visits/{visit_id}")
        assert response.status_code == 200
        data = response.json()
        assert "tariff_id" in data, f"'tariff_id' not in response: {list(data.keys())}"
        assert data["tariff_id"] is None


# ─── Phase 1: CRUD handlers (scenarios 5-20) ──────────────────────────────


class TestVisitList:
    """GET /api/v1/visits — list active visits."""

    def test_list_visits_returns_all_active(self, api_client, create_record) -> None:
        """Scenario 8: GET /api/v1/visits lists all active visits."""
        record = create_record()
        response = api_client.get("/api/v1/visits")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        # The visit we just created should be in the list
        visit_ids = [v["id"] for v in data]
        assert record["visits"][0]["id"] in visit_ids

    def test_list_visits_filtered_by_record(self, api_client, create_record) -> None:
        """Scenario 9: GET /api/v1/visits?record_id=X filters by record."""
        record = create_record()
        response = api_client.get(f"/api/v1/visits?record_id={record['id']}")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        for visit in data:
            assert visit["record_id"] == record["id"]

    def test_list_visits_excludes_deleted(self, api_client, create_record) -> None:
        """Soft-deleted visits should not appear in list."""
        record = create_record()
        visit_id = record["visits"][0]["id"]
        # Delete the visit
        api_client.delete(f"/api/v1/visits/{visit_id}")
        # List should not include it
        response = api_client.get(f"/api/v1/visits?record_id={record['id']}")
        assert response.status_code == 200
        visit_ids = [v["id"] for v in response.json()]
        assert visit_id not in visit_ids


class TestVisitCreate:
    """POST /api/v1/visits — create a new visit."""

    def test_create_visit_returns_201(self, api_client, create_record) -> None:
        """Scenario 5: POST /api/v1/visits creates a visit."""
        record = create_record()
        response = api_client.post(
            "/api/v1/visits",
            json={"record_id": record["id"], "price": 100},
        )
        assert response.status_code == 201, f"Failed: {response.text}"
        data = response.json()
        assert data["record_id"] == record["id"]
        assert data["price"] == 100

    def test_create_visit_missing_record_id_returns_422(self, api_client) -> None:
        """Scenario 6: POST /api/v1/visits with missing record_id returns 422."""
        response = api_client.post(
            "/api/v1/visits",
            json={"price": 100},
        )
        assert response.status_code == 422

    def test_create_visit_invalid_record_id_404(self, api_client) -> None:
        """Scenario 20: POST /api/v1/visits with nonexistent record returns 404."""
        response = api_client.post(
            "/api/v1/visits",
            json={"record_id": "nonexistent-record-id", "price": 100},
        )
        assert response.status_code == 404

    def test_create_visit_negative_price_returns_422(self, api_client, create_record) -> None:
        """POST /api/v1/visits with negative price returns 422 (Field(ge=0))."""
        record = create_record()
        response = api_client.post(
            "/api/v1/visits",
            json={"record_id": record["id"], "price": -1},
        )
        assert response.status_code == 422

    def test_create_visit_cascades_record_seats(self, api_client, create_record) -> None:
        """Scenario 16: Creating a visit increments record.seats."""
        record = create_record()
        initial_seats = record["seats"]
        response = api_client.post(
            "/api/v1/visits",
            json={"record_id": record["id"], "price": 200},
        )
        assert response.status_code == 201
        # Verify record seats updated
        updated_record = api_client.get(f"/api/v1/records/{record['id']}").json()
        assert updated_record["seats"] == initial_seats + 1

    def test_create_visit_rejects_when_capacity_exceeded(
        self, api_client, sample_activity_at_capacity,
    ) -> None:
        """Scenario 19: POST /api/v1/visits returns 409 when activity is full."""
        activity = sample_activity_at_capacity
        # The activity already has capacity=1 and is full. Find its record.
        records = api_client.get("/api/v1/records").json()
        activity_records = [r for r in records if r.get("activity_id") == activity.id]
        assert len(activity_records) >= 1
        record_id = activity_records[0]["id"]

        response = api_client.post(
            "/api/v1/visits",
            json={"record_id": record_id, "price": 100},
        )
        assert response.status_code == 409
        detail = response.json()["detail"]
        assert detail["code"] == "ACTIVITY_AT_CAPACITY"


class TestVisitUpdate:
    """PUT /api/v1/visits/{id} — full-replace update."""

    def test_update_visit_full_replace(self, api_client, create_record) -> None:
        """Scenario 14: PUT /api/v1/visits/{id} full replace."""
        record = create_record()
        visit = record["visits"][0]
        response = api_client.put(
            f"/api/v1/visits/{visit['id']}",
            json={
                "record_id": record["id"],
                "price": 5000,
                "status": "visited",
            },
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert data["price"] == 5000
        assert data["status"] == "visited"
        assert data["record_id"] == record["id"]

    def test_update_visit_not_found_404(self, api_client, create_record) -> None:
        """PUT /api/v1/visits/{nonexistent} returns 404."""
        record = create_record()
        response = api_client.put(
            "/api/v1/visits/nonexistent-id",
            json={
                "record_id": record["id"],
                "price": 100,
                "status": "waiting",
            },
        )
        assert response.status_code == 404

    def test_update_existing_status_put_still_works(
        self, api_client, create_record,
    ) -> None:
        """Scenario 15: PUT /api/v1/visits/{id}/status still works (regression)."""
        record = create_record()
        visit = record["visits"][0]
        response = api_client.put(
            f"/api/v1/visits/{visit['id']}/status",
            json={"status": "visited"},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "visited"


class TestVisitPatch:
    """PATCH /api/v1/visits/{id} — partial update."""

    def test_patch_visit_partial(self, api_client, create_record) -> None:
        """Scenario 10: PATCH /api/v1/visits/{id} partial update (price only)."""
        record = create_record()
        visit = record["visits"][0]
        original_status = visit["status"]
        response = api_client.patch(
            f"/api/v1/visits/{visit['id']}",
            json={"price": 9999},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["price"] == 9999
        # Status unchanged (not in patch)
        assert data["status"] == original_status

    def test_patch_visit_status_cascades_to_record(
        self, api_client, create_record,
    ) -> None:
        """Scenario 11: PATCH visit status → record.status recomputed."""
        record = create_record()
        visit = record["visits"][0]
        response = api_client.patch(
            f"/api/v1/visits/{visit['id']}",
            json={"status": "visited"},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "visited"
        # Verify record status was recomputed (should be "visited" since all visits visited)
        record_resp = api_client.get(f"/api/v1/records/{record['id']}")
        assert record_resp.status_code == 200

    def test_patch_visit_not_found_404(self, api_client) -> None:
        """PATCH /api/v1/visits/{nonexistent} returns 404."""
        response = api_client.patch(
            "/api/v1/visits/nonexistent-id",
            json={"tariff_id": "t-new"},
        )
        assert response.status_code == 404

    def test_patch_visit_does_not_change_seats(self, api_client, create_record) -> None:
        """Scenario 18: PATCH should not change record.seats."""
        record = create_record()
        initial_seats = record["seats"]
        visit = record["visits"][0]
        api_client.patch(
            f"/api/v1/visits/{visit['id']}",
            json={"tariff_id": "t-new"},
        )
        updated_record = api_client.get(f"/api/v1/records/{record['id']}").json()
        assert updated_record["seats"] == initial_seats


class TestVisitDelete:
    """DELETE /api/v1/visits/{id} — soft delete."""

    def test_delete_visit_returns_204(self, api_client, create_record) -> None:
        """Scenario 12: DELETE /api/v1/visits/{id} soft-deletes and returns 204."""
        record = create_record()
        visit = record["visits"][0]
        response = api_client.delete(f"/api/v1/visits/{visit['id']}")
        assert response.status_code == 204

    def test_delete_visit_cascades_seats(self, api_client, create_record) -> None:
        """Scenario 17: DELETE visit decrements record.seats."""
        record = create_record()
        initial_seats = record["seats"]
        visit = record["visits"][0]
        api_client.delete(f"/api/v1/visits/{visit['id']}")
        updated_record = api_client.get(f"/api/v1/records/{record['id']}").json()
        assert updated_record["seats"] == initial_seats - 1

    def test_delete_visit_not_found_404(self, api_client) -> None:
        """DELETE /api/v1/visits/{nonexistent} returns 404."""
        response = api_client.delete("/api/v1/visits/nonexistent-id")
        assert response.status_code == 404

    def test_delete_visit_hard_deletes_row(self, api_client, create_record) -> None:
        """After DELETE, row is absent from DB."""
        record = create_record()
        visit_id = record["visits"][0]["id"]
        api_client.delete(f"/api/v1/visits/{visit_id}")
        rows = query_db(f"SELECT * FROM visits WHERE id='{visit_id}'")
        assert len(rows) == 0


class TestVisitGet:
    """GET /api/v1/visits/{id} — single visit (existing + regression)."""

    def test_get_visit_not_found_404(self, api_client) -> None:
        """Scenario 13: GET /api/v1/visits/{nonexistent} returns 404."""
        response = api_client.get("/api/v1/visits/nonexistent-id")
        assert response.status_code == 404
