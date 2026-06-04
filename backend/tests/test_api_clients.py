"""Tests for the Clients CRUD API endpoints."""

from fastapi.testclient import TestClient

CLIENT_PAYLOAD = {
    "name": "John Smith",
    "phone": "+79991234567",
    "email": "john@example.com",
    "channel": "telegram",
}


class TestClientsCrud:
    """Full CRUD round-trip for /api/clients."""

    def test_create_client(self) -> None:
        """POST /api/clients creates a client and returns 201."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.post("/api/v1/clients", json=CLIENT_PAYLOAD)

        assert response.status_code == 201
        body = response.json()
        assert body["name"] == "John Smith"
        assert body["phone"] == "+79991234567"
        assert body["email"] == "john@example.com"
        assert body["channel"] == "telegram"
        assert "id" in body
        assert "created_at" in body
        assert "updated_at" in body
        assert body["is_active"] is True

    def test_list_clients_includes_created(self) -> None:
        """GET /api/clients returns a list containing the created client."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            create_resp = client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
            client_id = create_resp.json()["id"]

            response = client.get("/api/v1/clients")
            assert response.status_code == 200
            clients = response.json()
            assert isinstance(clients, list)
            ids = [c["id"] for c in clients]
            assert client_id in ids

    def test_get_client_by_id(self) -> None:
        """GET /api/clients/{id} returns the specific client."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            create_resp = client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
            client_id = create_resp.json()["id"]

            response = client.get(f"/api/v1/clients/{client_id}")
            assert response.status_code == 200
            body = response.json()
            assert body["id"] == client_id
            assert body["name"] == "John Smith"

    def test_update_client(self) -> None:
        """PUT /api/clients/{id} updates all fields."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            create_resp = client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
            client_id = create_resp.json()["id"]

            update_data = {
                "name": "John Updated",
                "phone": "+79997654321",
                "email": "john.updated@example.com",
                "channel": "telegram",
            }
            response = client.put(f"/api/v1/clients/{client_id}", json=update_data)
            assert response.status_code == 200
            body = response.json()
            assert body["name"] == "John Updated"
            assert body["phone"] == "+79997654321"
            assert body["channel"] == "telegram"

    def test_delete_client_soft_deletes(self) -> None:
        """DELETE /api/clients/{id} soft-deletes and list excludes it."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            create_resp = client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
            client_id = create_resp.json()["id"]

            # Delete
            response = client.delete(f"/api/v1/clients/{client_id}")
            assert response.status_code == 204

            # GET by id should still return it (soft delete)
            response = client.get(f"/api/v1/clients/{client_id}")
            assert response.status_code == 200
            assert response.json()["is_active"] is False

            # List should NOT include the deleted client
            response = client.get("/api/v1/clients")
            clients = response.json()
            ids = [c["id"] for c in clients]
            assert client_id not in ids

    def test_get_nonexistent_client_returns_404(self) -> None:
        """GET /api/clients/{fake_id} returns 404."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.get("/api/v1/clients/nonexistent-id")
        assert response.status_code == 404

    def test_update_nonexistent_client_returns_404(self) -> None:
        """PUT /api/clients/{fake_id} returns 404."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.put(
                "/api/v1/clients/nonexistent-id",
                json=CLIENT_PAYLOAD,
            )
        assert response.status_code == 404

    def test_delete_nonexistent_client_returns_404(self) -> None:
        """DELETE /api/clients/{fake_id} returns 404."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.delete("/api/v1/clients/nonexistent-id")
        assert response.status_code == 404

    def test_search_client_by_phone_found(self) -> None:
        """GET /api/v1/clients/search?phone=... returns the matching client."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            # Create a client
            create_resp = client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
            assert create_resp.status_code == 201

            # Search by phone
            response = client.get(
                "/api/v1/clients/search", params={"phone": "+79991234567"}
            )
            assert response.status_code == 200
            body = response.json()
            assert body["phone"] == "+79991234567"
            assert body["name"] == "John Smith"
            assert body["email"] == "john@example.com"
            assert body["channel"] == "telegram"
            assert "id" in body
            assert body["is_active"] is True

    def test_search_client_by_phone_not_found(self) -> None:
        """GET /api/v1/clients/search?phone=... returns 404 for unknown phone."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.get(
                "/api/v1/clients/search", params={"phone": "+00000000000"}
            )
            assert response.status_code == 404

    def test_search_client_by_phone_excludes_inactive(self) -> None:
        """GET /api/v1/clients/search?phone=... returns 404 for soft-deleted client."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            # Create then soft-delete
            create_resp = client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
            client_id = create_resp.json()["id"]
            client.delete(f"/api/v1/clients/{client_id}")

            # Search should not find the deleted client
            response = client.get(
                "/api/v1/clients/search", params={"phone": "+79991234567"}
            )
            assert response.status_code == 404

    def test_list_visitors_for_client(self) -> None:
        """GET /api/clients/{id}/visitors returns visitors for that client."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            # Create a client
            create_resp = client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
            client_id = create_resp.json()["id"]

            # Create a visitor for this client
            visitor_payload = {
                "client_id": client_id,
                "name": "Alice Smith",
                "age": 30,
            }
            client.post("/api/v1/visitors", json=visitor_payload)

            # List visitors for this client
            response = client.get(f"/api/v1/clients/{client_id}/visitors")
            assert response.status_code == 200
            visitors = response.json()
            assert isinstance(visitors, list)
            assert len(visitors) == 1
            assert visitors[0]["name"] == "Alice Smith"
            assert visitors[0]["age"] == 30
