"""Tests for the Visitors CRUD API endpoints."""

import pytest

pytestmark = pytest.mark.api

CLIENT_PAYLOAD = {
    "name": "Jane Doe",
    "phone": "+79991112233",
    "email": "jane@example.com",
    "channel": "telegram",
}


def _create_client(api_client) -> str:
    """Helper: create a client and return its ID."""
    resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
    assert resp.status_code == 201
    return resp.json()["id"]


class TestVisitorsCrud:
    """Full CRUD round-trip for /api/visitors."""

    def test_create_visitor(self, api_client) -> None:
        """POST /api/visitors creates a visitor and returns 201."""
        client_id = _create_client(api_client)

        visitor_payload = {
            "client_id": client_id,
            "name": "Alice",
            "age": 28,
        }
        response = api_client.post("/api/v1/visitors", json=visitor_payload)

        assert response.status_code == 201
        body = response.json()
        assert body["name"] == "Alice"
        assert body["age"] == 28
        assert body["client_id"] == client_id
        assert "id" in body
        assert "created_at" in body

    def test_list_visitors_for_client(self, api_client) -> None:
        """GET /api/clients/{client_id}/visitors returns visitors for that client."""
        client_id = _create_client(api_client)

        # Create two visitors
        visitor1 = {"client_id": client_id, "name": "Alice", "age": 28}
        visitor2 = {"client_id": client_id, "name": "Bob", "age": 35}
        api_client.post("/api/v1/visitors", json=visitor1)
        api_client.post("/api/v1/visitors", json=visitor2)

        response = api_client.get(f"/api/v1/clients/{client_id}/visitors")
        assert response.status_code == 200
        visitors = response.json()
        assert isinstance(visitors, list)
        assert len(visitors) == 2
        names = {v["name"] for v in visitors}
        assert "Alice" in names
        assert "Bob" in names

    def test_get_visitor_by_id(self, api_client) -> None:
        """GET /api/visitors/{id} returns the specific visitor."""
        client_id = _create_client(api_client)

        visitor_payload = {"client_id": client_id, "name": "Alice", "age": 28}
        create_resp = api_client.post("/api/v1/visitors", json=visitor_payload)
        visitor_id = create_resp.json()["id"]

        response = api_client.get(f"/api/v1/visitors/{visitor_id}")
        assert response.status_code == 200
        body = response.json()
        assert body["id"] == visitor_id
        assert body["name"] == "Alice"
        assert body["client_id"] == client_id

    def test_update_visitor(self, api_client) -> None:
        """PUT /api/visitors/{id} updates all fields."""
        client_id = _create_client(api_client)

        visitor_payload = {"client_id": client_id, "name": "Alice", "age": 28}
        create_resp = api_client.post("/api/v1/visitors", json=visitor_payload)
        visitor_id = create_resp.json()["id"]

        update_data = {"name": "Alice Updated", "age": 29}
        response = api_client.put(f"/api/v1/visitors/{visitor_id}", json=update_data)
        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "Alice Updated"
        assert body["age"] == 29

    def test_delete_visitor_hard_deletes(self, api_client) -> None:
        """DELETE /api/v1/visitors/{id} hard-deletes; GET by id returns 404 and list excludes it."""
        client_id = _create_client(api_client)

        visitor_payload = {"client_id": client_id, "name": "Alice", "age": 28}
        create_resp = api_client.post("/api/v1/visitors", json=visitor_payload)
        visitor_id = create_resp.json()["id"]

        # Delete
        response = api_client.delete(f"/api/v1/visitors/{visitor_id}")
        assert response.status_code == 204

        # Hard-delete: GET by id returns 404
        response = api_client.get(f"/api/v1/visitors/{visitor_id}")
        assert response.status_code == 404

        # List for client should NOT include the deleted visitor
        response = api_client.get(f"/api/v1/clients/{client_id}/visitors")
        visitors = response.json()
        ids = [v["id"] for v in visitors]
        assert visitor_id not in ids

    def test_get_nonexistent_visitor_returns_404(self, api_client) -> None:
        """GET /api/visitors/{fake_id} returns 404."""
        response = api_client.get("/api/v1/visitors/nonexistent-id")
        assert response.status_code == 404

    def test_update_nonexistent_visitor_returns_404(self, api_client) -> None:
        """PUT /api/visitors/{fake_id} returns 404."""
        response = api_client.put(
            "/api/v1/visitors/nonexistent-id",
            json={"name": "Alice", "age": 28},
        )
        assert response.status_code == 404

    def test_delete_nonexistent_visitor_returns_404(self, api_client) -> None:
        """DELETE /api/visitors/{fake_id} returns 404."""
        response = api_client.delete("/api/v1/visitors/nonexistent-id")
        assert response.status_code == 404

    def test_create_visitor_with_null_age(self, api_client) -> None:
        """POST /api/visitors accepts null age."""
        client_id = _create_client(api_client)

        visitor_payload = {"client_id": client_id, "name": "Unknown Age", "age": None}
        response = api_client.post("/api/v1/visitors", json=visitor_payload)

        assert response.status_code == 201
        body = response.json()
        assert body["name"] == "Unknown Age"
        assert body["age"] is None


class TestVisitorPatch:
    """Tests for PATCH /api/v1/visitors/{id}."""

    def test_patch_visitor_not_found_404(self, api_client) -> None:
        """PATCH nonexistent visitor returns 404."""
        response = api_client.patch("/api/v1/visitors/nonexistent-id", json={"name": "New"})
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "VISITOR_NOT_FOUND"

    def test_patch_visitor_client_id_immutable(self, api_client) -> None:
        """PATCH cannot reassign a visitor to a different client — client_id is locked in at creation."""
        client_id = _create_client(api_client)
        create = api_client.post("/api/v1/visitors", json={
            "client_id": client_id, "name": "Alice", "age": 28,
        })
        visitor_id = create.json()["id"]

        # Attempt to patch client_id to a different value
        other_client_id = api_client.post("/api/v1/clients", json={
            "name": "Other", "phone": "+79998887766",
        }).json()["id"]

        response = api_client.patch(
            f"/api/v1/visitors/{visitor_id}",
            json={"client_id": other_client_id},
        )
        # Record actual behavior — do NOT change it
        if response.status_code == 200:
            # Silent ignore: client_id remains unchanged
            assert response.json()["client_id"] == client_id
        else:
            # Rejected: 422 validation error
            assert response.status_code == 422


class TestVisitorList:
    """Tests for GET /api/v1/visitors — paginated bare list (#183)."""

    def _create_visitors(self, api_client, count: int) -> list[str]:
        """Helper: create `count` visitors under one client, return their ids."""
        client_id = _create_client(api_client)
        ids = []
        for i in range(count):
            resp = api_client.post(
                "/api/v1/visitors",
                json={"client_id": client_id, "name": f"Visitor {i}", "age": 20 + i},
            )
            assert resp.status_code == 201
            ids.append(resp.json()["id"])
        return ids

    def test_list_visitors_envelope_shape(self, api_client) -> None:
        """GET /api/v1/visitors returns the pagination envelope with defaults."""
        response = api_client.get("/api/v1/visitors")
        assert response.status_code == 200
        body = response.json()
        assert body["page"] == 1
        assert body["per_page"] == 20
        assert isinstance(body["items"], list)
        assert isinstance(body["total"], int)

    def test_list_visitors_total(self, api_client) -> None:
        """total reflects the number of created visitors."""
        ids = self._create_visitors(api_client, 3)
        response = api_client.get("/api/v1/visitors")
        body = response.json()
        assert body["total"] >= 3
        returned_ids = {v["id"] for v in body["items"]}
        assert set(ids) <= returned_ids

    def test_list_visitors_page2_disjoint_from_page1(self, api_client) -> None:
        """page=2 slice is disjoint from page 1 (set disjointness of ids)."""
        self._create_visitors(api_client, 4)
        page1 = api_client.get("/api/v1/visitors", params={"page": 1, "per_page": 2}).json()
        page2 = api_client.get("/api/v1/visitors", params={"page": 2, "per_page": 2}).json()
        assert page1["total"] == page2["total"]
        ids_p1 = {v["id"] for v in page1["items"]}
        ids_p2 = {v["id"] for v in page2["items"]}
        assert len(ids_p1) == 2
        assert len(ids_p2) == 2
        assert ids_p1.isdisjoint(ids_p2)

    def test_list_visitors_per_page_respected(self, api_client) -> None:
        """per_page=2 returns exactly 2 items."""
        self._create_visitors(api_client, 3)
        body = api_client.get("/api/v1/visitors", params={"per_page": 2}).json()
        assert body["per_page"] == 2
        assert len(body["items"]) == 2

    def test_list_visitors_out_of_range_page_empty(self, api_client) -> None:
        """Out-of-range page returns empty items with correct total."""
        self._create_visitors(api_client, 2)
        body = api_client.get("/api/v1/visitors", params={"page": 99}).json()
        assert body["items"] == []
        assert body["total"] >= 2

    def test_list_visitors_invalid_params_422(self, api_client) -> None:
        """per_page=101, per_page=0, page=0 → explicit 422, no silent clamping."""
        assert api_client.get("/api/v1/visitors", params={"per_page": 101}).status_code == 422
        assert api_client.get("/api/v1/visitors", params={"per_page": 0}).status_code == 422
        assert api_client.get("/api/v1/visitors", params={"page": 0}).status_code == 422

    def test_scoped_client_visitors_route_unchanged(self, api_client) -> None:
        """Regression guard: GET /api/v1/clients/{id}/visitors stays a bare array."""
        client_id = _create_client(api_client)
        api_client.post("/api/v1/visitors", json={"client_id": client_id, "name": "Alice", "age": 28})

        response = api_client.get(f"/api/v1/clients/{client_id}/visitors")
        assert response.status_code == 200
        visitors = response.json()
        assert isinstance(visitors, list)  # NOT the {items, total, ...} envelope
        assert any(v["name"] == "Alice" for v in visitors)
