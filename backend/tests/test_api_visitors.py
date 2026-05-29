"""Tests for the Visitors CRUD API endpoints."""

from fastapi.testclient import TestClient

CLIENT_PAYLOAD = {
    "name": "Jane Doe",
    "phone": "+79991112233",
    "email": "jane@example.com",
    "channel": "email",
}


def _create_client(test_client: TestClient) -> str:
    """Helper: create a client and return its ID."""
    resp = test_client.post("/api/clients", json=CLIENT_PAYLOAD)
    assert resp.status_code == 201
    return resp.json()["id"]


class TestVisitorsCrud:
    """Full CRUD round-trip for /api/visitors."""

    def test_create_visitor(self) -> None:
        """POST /api/visitors creates a visitor and returns 201."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            client_id = _create_client(client)

            visitor_payload = {
                "client_id": client_id,
                "name": "Alice",
                "age": 28,
            }
            response = client.post("/api/visitors", json=visitor_payload)

        assert response.status_code == 201
        body = response.json()
        assert body["name"] == "Alice"
        assert body["age"] == 28
        assert body["client_id"] == client_id
        assert "id" in body
        assert "created_at" in body
        assert body["is_active"] is True

    def test_list_visitors_for_client(self) -> None:
        """GET /api/clients/{client_id}/visitors returns visitors for that client."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            client_id = _create_client(client)

            # Create two visitors
            visitor1 = {"client_id": client_id, "name": "Alice", "age": 28}
            visitor2 = {"client_id": client_id, "name": "Bob", "age": 35}
            client.post("/api/visitors", json=visitor1)
            client.post("/api/visitors", json=visitor2)

            response = client.get(f"/api/clients/{client_id}/visitors")
            assert response.status_code == 200
            visitors = response.json()
            assert isinstance(visitors, list)
            assert len(visitors) == 2
            names = {v["name"] for v in visitors}
            assert "Alice" in names
            assert "Bob" in names

    def test_get_visitor_by_id(self) -> None:
        """GET /api/visitors/{id} returns the specific visitor."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            client_id = _create_client(client)

            visitor_payload = {"client_id": client_id, "name": "Alice", "age": 28}
            create_resp = client.post("/api/visitors", json=visitor_payload)
            visitor_id = create_resp.json()["id"]

            response = client.get(f"/api/visitors/{visitor_id}")
            assert response.status_code == 200
            body = response.json()
            assert body["id"] == visitor_id
            assert body["name"] == "Alice"
            assert body["client_id"] == client_id

    def test_update_visitor(self) -> None:
        """PUT /api/visitors/{id} updates all fields."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            client_id = _create_client(client)

            visitor_payload = {"client_id": client_id, "name": "Alice", "age": 28}
            create_resp = client.post("/api/visitors", json=visitor_payload)
            visitor_id = create_resp.json()["id"]

            update_data = {"name": "Alice Updated", "age": 29}
            response = client.put(f"/api/visitors/{visitor_id}", json=update_data)
            assert response.status_code == 200
            body = response.json()
            assert body["name"] == "Alice Updated"
            assert body["age"] == 29

    def test_delete_visitor_soft_deletes(self) -> None:
        """DELETE /api/visitors/{id} soft-deletes and list excludes it."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            client_id = _create_client(client)

            visitor_payload = {"client_id": client_id, "name": "Alice", "age": 28}
            create_resp = client.post("/api/visitors", json=visitor_payload)
            visitor_id = create_resp.json()["id"]

            # Delete
            response = client.delete(f"/api/visitors/{visitor_id}")
            assert response.status_code == 204

            # GET by id should still return it (soft delete)
            response = client.get(f"/api/visitors/{visitor_id}")
            assert response.status_code == 200
            assert response.json()["is_active"] is False

            # List for client should NOT include the deleted visitor
            response = client.get(f"/api/clients/{client_id}/visitors")
            visitors = response.json()
            ids = [v["id"] for v in visitors]
            assert visitor_id not in ids

    def test_get_nonexistent_visitor_returns_404(self) -> None:
        """GET /api/visitors/{fake_id} returns 404."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.get("/api/visitors/nonexistent-id")
        assert response.status_code == 404

    def test_update_nonexistent_visitor_returns_404(self) -> None:
        """PUT /api/visitors/{fake_id} returns 404."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.put(
                "/api/visitors/nonexistent-id",
                json={"name": "Alice", "age": 28},
            )
        assert response.status_code == 404

    def test_delete_nonexistent_visitor_returns_404(self) -> None:
        """DELETE /api/visitors/{fake_id} returns 404."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.delete("/api/visitors/nonexistent-id")
        assert response.status_code == 404

    def test_create_visitor_with_null_age(self) -> None:
        """POST /api/visitors accepts null age."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            client_id = _create_client(client)

            visitor_payload = {"client_id": client_id, "name": "Unknown Age", "age": None}
            response = client.post("/api/visitors", json=visitor_payload)

        assert response.status_code == 201
        body = response.json()
        assert body["name"] == "Unknown Age"
        assert body["age"] is None
