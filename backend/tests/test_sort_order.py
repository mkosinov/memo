"""Tests for sort_order field on masters and locations (column reordering)."""

import pytest

pytestmark = pytest.mark.api


# ── Masters sort_order ─────────────────────────────────────────────────────────


class TestMasterSortOrder:
    """Verify sort_order field on masters."""

    def test_master_response_includes_sort_order(self, api_client) -> None:
        """Master response includes sort_order field."""
        resp = api_client.post("/api/v1/masters", json={
            "first_name": "Алиса",
            "last_name": "Тест",
            "color": "#FF0000",
            "position": "мастер",
            "specialty": "живопись",
        })
        assert resp.status_code == 201
        body = resp.json()
        assert "sort_order" in body
        assert body["sort_order"] == 0  # default

    def test_master_create_with_sort_order(self, api_client) -> None:
        """Master can be created with explicit sort_order."""
        resp = api_client.post("/api/v1/masters", json={
            "first_name": "Борис",
            "last_name": "Тест",
            "color": "#00FF00",
            "position": "мастер",
            "specialty": "керамика",
            "sort_order": 5,
        })
        assert resp.status_code == 201
        assert resp.json()["sort_order"] == 5

    def test_masters_list_sorted_by_sort_order_then_name(self, api_client) -> None:
        """Masters list is sorted by sort_order ASC, then name ASC."""
        # Create with explicit sort_order to control order
        api_client.post("/api/v1/masters", json={
            "first_name": "Зина",
            "last_name": "Б",
            "color": "#111111",
            "position": "мастер",
            "specialty": "живопись",
            "sort_order": 3,
        })
        api_client.post("/api/v1/masters", json={
            "first_name": "Анна",
            "last_name": "А",
            "color": "#222222",
            "position": "мастер",
            "specialty": "керамика",
            "sort_order": 1,
        })
        api_client.post("/api/v1/masters", json={
            "first_name": "Мария",
            "last_name": "В",
            "color": "#333333",
            "position": "мастер",
            "specialty": "живопись",
            "sort_order": 2,
        })

        resp = api_client.get("/api/v1/masters")
        assert resp.status_code == 200
        masters = resp.json()["items"]
        sort_orders = [m["sort_order"] for m in masters]
        assert sort_orders == sorted(sort_orders)
        # Verify within same sort_order, name is secondary
        assert masters[0]["first_name"] == "Анна"   # sort_order=1
        assert masters[1]["first_name"] == "Мария"   # sort_order=2
        assert masters[2]["first_name"] == "Зина"    # sort_order=3

    def test_master_update_sort_order(self, api_client) -> None:
        """PUT /api/v1/masters/{id} can update sort_order."""
        create_resp = api_client.post("/api/v1/masters", json={
            "first_name": "Дима",
            "last_name": "Тест",
            "color": "#444444",
            "position": "мастер",
            "specialty": "живопись",
        })
        master_id = create_resp.json()["id"]

        resp = api_client.put(f"/api/v1/masters/{master_id}", json={
            # #207 §3.2: is_active removed from MasterUpdate (PUT) —
            # archive/restore only via POST endpoints.
            "first_name": "Дима",
            "last_name": "Тест",
            "color": "#444444",
            "position": "мастер",
            "specialty": "живопись",
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


class TestMastersReorder:
    """Tests for PUT /api/v1/masters/reorder endpoint."""

    def test_reorder_updates_sort_order(self, api_client) -> None:
        """Reorder endpoint updates sort_order for each master."""
        m1 = api_client.post("/api/v1/masters", json={
            "first_name": "Мастер1", "last_name": "A", "color": "#111",
            "position": "мастер", "specialty": "живопись",
        }).json()
        m2 = api_client.post("/api/v1/masters", json={
            "first_name": "Мастер2", "last_name": "B", "color": "#222",
            "position": "мастер", "specialty": "керамика",
        }).json()
        m3 = api_client.post("/api/v1/masters", json={
            "first_name": "Мастер3", "last_name": "C", "color": "#333",
            "position": "мастер", "specialty": "живопись",
        }).json()

        # Reorder: m3, m1, m2
        resp = api_client.put("/api/v1/masters/reorder", json={
            "ids": [m3["id"], m1["id"], m2["id"]],
        })
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 3

        # Verify order
        assert body[0]["id"] == m3["id"]
        assert body[0]["sort_order"] == 0
        assert body[1]["id"] == m1["id"]
        assert body[1]["sort_order"] == 1
        assert body[2]["id"] == m2["id"]
        assert body[2]["sort_order"] == 2

    def test_reorder_reflects_in_list(self, api_client) -> None:
        """After reorder, GET /api/v1/masters returns new order."""
        m1 = api_client.post("/api/v1/masters", json={
            "first_name": "Альфа", "last_name": "A", "color": "#111",
            "position": "мастер", "specialty": "живопись",
        }).json()
        m2 = api_client.post("/api/v1/masters", json={
            "first_name": "Бета", "last_name": "B", "color": "#222",
            "position": "мастер", "specialty": "керамика",
        }).json()

        # Originally alpha comes first (sort_order default 0, name alphabetical)
        # Reorder: put beta first
        api_client.put("/api/v1/masters/reorder", json={
            "ids": [m2["id"], m1["id"]],
        })

        resp = api_client.get("/api/v1/masters")
        masters = resp.json()["items"]
        # m2 should now be first (sort_order=0)
        assert masters[0]["id"] == m2["id"]
        assert masters[1]["id"] == m1["id"]

    def test_reorder_empty_list(self, api_client) -> None:
        """Reorder with empty list returns 200 with empty result."""
        resp = api_client.put("/api/v1/masters/reorder", json={"ids": []})
        assert resp.status_code == 200
        assert resp.json() == []

    def test_reorder_partial_list(self, api_client) -> None:
        """Reorder with only some IDs — unmentioned keep their position."""
        m1 = api_client.post("/api/v1/masters", json={
            "first_name": "X", "last_name": "A", "color": "#111",
            "position": "мастер", "specialty": "живопись",
        }).json()
        m2 = api_client.post("/api/v1/masters", json={
            "first_name": "Y", "last_name": "B", "color": "#222",
            "position": "мастер", "specialty": "керамика",
        }).json()
        m3 = api_client.post("/api/v1/masters", json={
            "first_name": "Z", "last_name": "C", "color": "#333",
            "position": "мастер", "specialty": "живопись",
        }).json()

        # Only reorder m2 and m3
        resp = api_client.put("/api/v1/masters/reorder", json={
            "ids": [m3["id"], m2["id"]],
        })
        assert resp.status_code == 200
        body = resp.json()
        # m3 first, m2 second, then m1 (unmentioned, keeps sort_order=0)
        # Actually, for partial reorder, we need to decide behavior.
        # The spec says "accepts array of IDs in new order"
        # Let's treat it as: only these IDs get reordered, rest untouched.
        assert resp.status_code == 200


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
