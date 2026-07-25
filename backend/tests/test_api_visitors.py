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
        assert body["is_active"] is True

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

    def test_delete_visitor_soft_deletes(self, api_client) -> None:
        """DELETE /api/visitors/{id} soft-deletes and list excludes it."""
        client_id = _create_client(api_client)

        visitor_payload = {"client_id": client_id, "name": "Alice", "age": 28}
        create_resp = api_client.post("/api/v1/visitors", json=visitor_payload)
        visitor_id = create_resp.json()["id"]

        # Delete
        response = api_client.delete(f"/api/v1/visitors/{visitor_id}")
        assert response.status_code == 204

        # GET by id should still return it (soft delete)
        response = api_client.get(f"/api/v1/visitors/{visitor_id}")
        assert response.status_code == 200
        assert response.json()["is_active"] is False

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

    def test_patch_visitor_name_only(self, api_client) -> None:
        """PATCH updates only name, age preserved."""
        client_id = _create_client(api_client)
        create = api_client.post("/api/v1/visitors", json={
            "client_id": client_id, "name": "Alice", "age": 28,
        })
        visitor_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/visitors/{visitor_id}", json={"name": "Alice Updated"})
        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "Alice Updated"
        assert body["age"] == 28  # unchanged

    def test_patch_visitor_age_only(self, api_client) -> None:
        """PATCH updates only age, name preserved."""
        client_id = _create_client(api_client)
        create = api_client.post("/api/v1/visitors", json={
            "client_id": client_id, "name": "Bob", "age": 30,
        })
        visitor_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/visitors/{visitor_id}", json={"age": 31})
        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "Bob"  # unchanged
        assert body["age"] == 31

    def test_patch_visitor_not_found_404(self, api_client) -> None:
        """PATCH nonexistent visitor returns 404."""
        response = api_client.patch("/api/v1/visitors/nonexistent-id", json={"name": "New"})
        assert response.status_code == 404

    def test_patch_visitor_empty_body(self, api_client) -> None:
        """PATCH with empty body makes no changes."""
        client_id = _create_client(api_client)
        create = api_client.post("/api/v1/visitors", json={
            "client_id": client_id, "name": "Unchanged", "age": 25,
        })
        visitor_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/visitors/{visitor_id}", json={})
        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "Unchanged"
        assert body["age"] == 25

    def test_patch_visitor_null_name_stripped(self, api_client) -> None:
        """PATCH with null for NOT NULL name silently strips."""
        client_id = _create_client(api_client)
        create = api_client.post("/api/v1/visitors", json={
            "client_id": client_id, "name": "KeepName", "age": 25,
        })
        visitor_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/visitors/{visitor_id}", json={"name": None})
        assert response.status_code == 200
        assert response.json()["name"] == "KeepName"

    def test_patch_visitor_age_to_null(self, api_client) -> None:
        """PATCH can set nullable age to null."""
        client_id = _create_client(api_client)
        create = api_client.post("/api/v1/visitors", json={
            "client_id": client_id, "name": "Adult", "age": 25,
        })
        visitor_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/visitors/{visitor_id}", json={"age": None})
        assert response.status_code == 200
        assert response.json()["age"] is None

    def test_patch_visitor_multiple_fields(self, api_client) -> None:
        """PATCH updates multiple fields at once."""
        client_id = _create_client(api_client)
        create = api_client.post("/api/v1/visitors", json={
            "client_id": client_id, "name": "Old", "age": 20,
        })
        visitor_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/visitors/{visitor_id}", json={
            "name": "New Name", "age": 21,
        })
        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "New Name"
        assert body["age"] == 21
