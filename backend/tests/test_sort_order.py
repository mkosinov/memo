"""Tests for sort_order field on staff and locations (column reordering)."""

import pytest

pytestmark = pytest.mark.api


# ── Masters sort_order ─────────────────────────────────────────────────────────


class TestStaffSortOrder:
    """Verify sort_order field on staff cards (GH #266 — former masters)."""

    def test_staff_response_includes_sort_order(self, api_client) -> None:
        """Staff response includes sort_order field."""
        resp = api_client.post("/api/v1/staff", json={
            "first_name": "Алиса",
            "last_name": "Тест",
        })
        assert resp.status_code == 201
        body = resp.json()
        assert "sort_order" in body
        assert body["sort_order"] == 0  # default

    def test_staff_create_with_sort_order(self, api_client) -> None:
        """Staff can be created with explicit sort_order."""
        resp = api_client.post("/api/v1/staff", json={
            "first_name": "Борис",
            "last_name": "Тест",
            "sort_order": 5,
        })
        assert resp.status_code == 201
        assert resp.json()["sort_order"] == 5

    def test_staff_list_sorted_by_sort_order_then_name(self, api_client) -> None:
        """Staff list is sorted by sort_order ASC, then name ASC."""
        # Create with explicit sort_order to control order
        api_client.post("/api/v1/staff", json={
            "first_name": "Зина", "last_name": "Б", "sort_order": 3,
        })
        api_client.post("/api/v1/staff", json={
            "first_name": "Анна", "last_name": "А", "sort_order": 1,
        })
        api_client.post("/api/v1/staff", json={
            "first_name": "Мария", "last_name": "В", "sort_order": 2,
        })

        resp = api_client.get("/api/v1/staff")
        assert resp.status_code == 200
        staff = resp.json()["items"]
        sort_orders = [m["sort_order"] for m in staff]
        assert sort_orders == sorted(sort_orders)
        # Verify within same sort_order, name is secondary
        assert staff[0]["first_name"] == "Анна"   # sort_order=1
        assert staff[1]["first_name"] == "Мария"   # sort_order=2
        assert staff[2]["first_name"] == "Зина"    # sort_order=3

    def test_staff_update_sort_order(self, api_client) -> None:
        """PUT /api/v1/staff/{id} can update sort_order."""
        create_resp = api_client.post("/api/v1/staff", json={
            "first_name": "Дима",
            "last_name": "Тест",
        })
        staff_id = create_resp.json()["id"]

        resp = api_client.put(f"/api/v1/staff/{staff_id}", json={
            "first_name": "Дима",
            "last_name": "Тест",
            "sort_order": 10,
        })
        assert resp.status_code == 200
        assert resp.json()["sort_order"] == 10


# ── Locations sort_order ──────────────────────────────────────────────────────


class TestLocationSortOrder:
    """Verify sort_order field on locations."""

    def test_location_response_includes_sort_order(self, api_client) -> None:
        """Location response includes sort_order field."""
        resp = api_client.post("/api/v1/locations", json={
            "name": "Тест Локация",
            "capacity": 10,
        })
        assert resp.status_code == 201
        body = resp.json()
        assert "sort_order" in body
        assert body["sort_order"] == 0  # default

    def test_location_create_with_sort_order(self, api_client) -> None:
        """Location can be created with explicit sort_order."""
        resp = api_client.post("/api/v1/locations", json={
            "name": "Локация С",
            "capacity": 15,
            "sort_order": 7,
        })
        assert resp.status_code == 201
        assert resp.json()["sort_order"] == 7

    def test_locations_list_sorted_by_sort_order(self, api_client) -> None:
        """Locations list is sorted by sort_order ASC, then name ASC."""
        api_client.post("/api/v1/locations", json={
            "name": "Гранд",
            "capacity": 12,
            "sort_order": 2,
        })
        api_client.post("/api/v1/locations", json={
            "name": "Альпика",
            "capacity": 10,
            "sort_order": 1,
        })
        api_client.post("/api/v1/locations", json={
            "name": "Поляна",
            "capacity": 8,
            "sort_order": 3,
        })

        resp = api_client.get("/api/v1/locations")
        assert resp.status_code == 200
        locations = resp.json()["items"]
        assert locations[0]["name"] == "Альпика"
        assert locations[1]["name"] == "Гранд"
        assert locations[2]["name"] == "Поляна"


# ── Reorder endpoint ──────────────────────────────────────────────────────────


# GH #266: PUT /masters/reorder is REMOVED (not carried to /staff) —
# covered by TestNoStaffReorder in test_api_staff.py.


class TestLocationsReorder:
    """Tests for PUT /api/v1/locations/reorder endpoint."""

    def test_reorder_updates_sort_order(self, api_client) -> None:
        """Reorder endpoint updates sort_order for each location."""
        l1 = api_client.post("/api/v1/locations", json={
            "name": "Локация1", "capacity": 10,
        }).json()
        l2 = api_client.post("/api/v1/locations", json={
            "name": "Локация2", "capacity": 15,
        }).json()

        resp = api_client.put("/api/v1/locations/reorder", json={
            "ids": [l2["id"], l1["id"]],
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body[0]["id"] == l2["id"]
        assert body[0]["sort_order"] == 0
        assert body[1]["id"] == l1["id"]
        assert body[1]["sort_order"] == 1
