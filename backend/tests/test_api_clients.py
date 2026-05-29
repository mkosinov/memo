"""Tests for the Clients CRUD API endpoints."""

from fastapi.testclient import TestClient

CLIENT_PAYLOAD = {
    "name": "John Smith",
    "phone": "+79991234567",
    "email": "john@example.com",
    "channel": "phone",
}


class TestClientsCrud:
    """Full CRUD round-trip for /api/clients."""

    def test_create_client(self) -> None:
        """POST /api/clients creates a client and returns 201."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.post("/api/clients", json=CLIENT_PAYLOAD)

        assert response.status_code == 201
        body = response.json()
        assert body["name"] == "John Smith"
        assert body["phone"] == "+79991234567"
        assert body["email"] == "john@example.com"
        assert body["channel"] == "phone"
        assert "id" in body
        assert "created_at" in body
        assert "updated_at" in body
        assert body["is_active"] is True

    def test_list_clients_includes_created(self) -> None:
        """GET /api/clients returns a list containing the created client."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            create_resp = client.post("/api/clients", json=CLIENT_PAYLOAD)
            client_id = create_resp.json()["id"]

            response = client.get("/api/clients")
            assert response.status_code == 200
            clients = response.json()
            assert isinstance(clients, list)
            ids = [c["id"] for c in clients]
            assert client_id in ids

    def test_get_client_by_id(self) -> None:
        """GET /api/clients/{id} returns the specific client."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            create_resp = client.post("/api/clients", json=CLIENT_PAYLOAD)
            client_id = create_resp.json()["id"]

            response = client.get(f"/api/clients/{client_id}")
            assert response.status_code == 200
            body = response.json()
            assert body["id"] == client_id
            assert body["name"] == "John Smith"

    def test_update_client(self) -> None:
        """PUT /api/clients/{id} updates all fields."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            create_resp = client.post("/api/clients", json=CLIENT_PAYLOAD)
            client_id = create_resp.json()["id"]

            update_data = {
                "name": "John Updated",
                "phone": "+79997654321",
                "email": "john.updated@example.com",
                "channel": "telegram",
            }
            response = client.put(f"/api/clients/{client_id}", json=update_data)
            assert response.status_code == 200
            body = response.json()
            assert body["name"] == "John Updated"
            assert body["phone"] == "+79997654321"
            assert body["channel"] == "telegram"

    def test_delete_client_soft_deletes(self) -> None:
        """DELETE /api/clients/{id} soft-deletes and list excludes it."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            create_resp = client.post("/api/clients", json=CLIENT_PAYLOAD)
            client_id = create_resp.json()["id"]

            # Delete
            response = client.delete(f"/api/clients/{client_id}")
            assert response.status_code == 204

            # GET by id should still return it (soft delete)
            response = client.get(f"/api/clients/{client_id}")
            assert response.status_code == 200
            assert response.json()["is_active"] is False

            # List should NOT include the deleted client
            response = client.get("/api/clients")
            clients = response.json()
            ids = [c["id"] for c in clients]
            assert client_id not in ids

    def test_get_nonexistent_client_returns_404(self) -> None:
        """GET /api/clients/{fake_id} returns 404."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.get("/api/clients/nonexistent-id")
        assert response.status_code == 404

    def test_update_nonexistent_client_returns_404(self) -> None:
        """PUT /api/clients/{fake_id} returns 404."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.put(
                "/api/clients/nonexistent-id",
                json=CLIENT_PAYLOAD,
            )
        assert response.status_code == 404

    def test_delete_nonexistent_client_returns_404(self) -> None:
        """DELETE /api/clients/{fake_id} returns 404."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.delete("/api/clients/nonexistent-id")
        assert response.status_code == 404

    def test_list_visitors_for_client(self) -> None:
        """GET /api/clients/{id}/visitors returns visitors for that client."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            # Create a client
            create_resp = client.post("/api/clients", json=CLIENT_PAYLOAD)
            client_id = create_resp.json()["id"]

            # Create a visitor for this client
            visitor_payload = {
                "client_id": client_id,
                "name": "Alice Smith",
                "age": 30,
            }
            client.post("/api/visitors", json=visitor_payload)

            # List visitors for this client
            response = client.get(f"/api/clients/{client_id}/visitors")
            assert response.status_code == 200
            visitors = response.json()
            assert isinstance(visitors, list)
            assert len(visitors) == 1
            assert visitors[0]["name"] == "Alice Smith"
            assert visitors[0]["age"] == 30
