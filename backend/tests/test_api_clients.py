"""Tests for the Clients CRUD API endpoints."""

CLIENT_PAYLOAD = {
    "name": "John Smith",
    "phone": "+79991234567",
    "email": "john@example.com",
    "channel": "telegram",
}


class TestClientsCrud:
    """Full CRUD round-trip for /api/clients."""

    def test_create_client(self, api_client) -> None:
        """POST /api/clients creates a client and returns 201."""
        response = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)

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

    def test_list_clients_includes_created(self, api_client) -> None:
        """GET /api/clients returns a list containing the created client."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]

        response = api_client.get("/api/v1/clients")
        assert response.status_code == 200
        clients = response.json()
        assert isinstance(clients, list)
        ids = [c["id"] for c in clients]
        assert client_id in ids

    def test_get_client_by_id(self, api_client) -> None:
        """GET /api/clients/{id} returns the specific client."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]

        response = api_client.get(f"/api/v1/clients/{client_id}")
        assert response.status_code == 200
        body = response.json()
        assert body["id"] == client_id
        assert body["name"] == "John Smith"

    def test_update_client(self, api_client) -> None:
        """PUT /api/clients/{id} updates all fields."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]

        update_data = {
            "name": "John Updated",
            "phone": "+79997654321",
            "email": "john.updated@example.com",
            "channel": "telegram",
        }
        response = api_client.put(f"/api/v1/clients/{client_id}", json=update_data)
        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "John Updated"
        assert body["phone"] == "+79997654321"
        assert body["channel"] == "telegram"

    def test_delete_client_soft_deletes(self, api_client) -> None:
        """DELETE /api/clients/{id} soft-deletes and list excludes it."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]

        # Delete
        response = api_client.delete(f"/api/v1/clients/{client_id}")
        assert response.status_code == 204

        # GET by id should still return it (soft delete)
        response = api_client.get(f"/api/v1/clients/{client_id}")
        assert response.status_code == 200
        assert response.json()["is_active"] is False

        # List should NOT include the deleted client
        response = api_client.get("/api/v1/clients")
        clients = response.json()
        ids = [c["id"] for c in clients]
        assert client_id not in ids

    def test_get_nonexistent_client_returns_404(self, api_client) -> None:
        """GET /api/clients/{fake_id} returns 404."""
        response = api_client.get("/api/v1/clients/nonexistent-id")
        assert response.status_code == 404

    def test_update_nonexistent_client_returns_404(self, api_client) -> None:
        """PUT /api/clients/{fake_id} returns 404."""
        response = api_client.put(
            "/api/v1/clients/nonexistent-id",
            json=CLIENT_PAYLOAD,
        )
        assert response.status_code == 404

    def test_delete_nonexistent_client_returns_404(self, api_client) -> None:
        """DELETE /api/clients/{fake_id} returns 404."""
        response = api_client.delete("/api/v1/clients/nonexistent-id")
        assert response.status_code == 404

    def test_search_client_by_phone_found(self, api_client) -> None:
        """GET /api/v1/clients/search?phone=... returns the matching client."""
        # Create a client
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        assert create_resp.status_code == 201

        # Search by phone
        response = api_client.get(
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

    def test_search_client_by_phone_not_found(self, api_client) -> None:
        """GET /api/v1/clients/search?phone=... returns 404 for unknown phone."""
        response = api_client.get(
            "/api/v1/clients/search", params={"phone": "+00000000000"}
        )
        assert response.status_code == 404

    def test_search_client_by_phone_excludes_inactive(self, api_client) -> None:
        """GET /api/v1/clients/search?phone=... returns 404 for soft-deleted client."""
        # Create then soft-delete
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]
        api_client.delete(f"/api/v1/clients/{client_id}")

        # Search should not find the deleted client
        response = api_client.get(
            "/api/v1/clients/search", params={"phone": "+79991234567"}
        )
        assert response.status_code == 404

    def test_patch_client_updates_name(self, api_client) -> None:
        """PATCH /api/v1/clients/{id} partially updates a client."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]
        original_phone = create_resp.json()["phone"]

        response = api_client.patch(f"/api/v1/clients/{client_id}", json={"name": "Updated Name"})
        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "Updated Name"
        assert body["phone"] == original_phone  # unchanged

    def test_patch_client_not_found(self, api_client) -> None:
        """PATCH /api/v1/clients/{fake_id} returns 404."""
        response = api_client.patch("/api/v1/clients/nonexistent", json={"name": "Test"})
        assert response.status_code == 404

    def test_patch_client_updates_channel(self, api_client) -> None:
        """PATCH /api/v1/clients/{id} can update channel field."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]

        response = api_client.patch(f"/api/v1/clients/{client_id}", json={"channel": "whatsapp"})
        assert response.status_code == 200
        assert response.json()["channel"] == "whatsapp"

    def test_patch_client_empty_body(self, api_client) -> None:
        """PATCH /api/v1/clients/{id} with empty body returns unchanged client."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]

        response = api_client.patch(f"/api/v1/clients/{client_id}", json={})
        assert response.status_code == 200
        body = response.json()
        assert body["name"] == CLIENT_PAYLOAD["name"]
        assert body["phone"] == CLIENT_PAYLOAD["phone"]

    def test_list_visitors_for_client(self, api_client) -> None:
        """GET /api/clients/{id}/visitors returns visitors for that client."""
        # Create a client
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]

        # Create a visitor for this client
        visitor_payload = {
            "client_id": client_id,
            "name": "Alice Smith",
            "age": 30,
        }
        api_client.post("/api/v1/visitors", json=visitor_payload)

        # List visitors for this client
        response = api_client.get(f"/api/v1/clients/{client_id}/visitors")
        assert response.status_code == 200
        visitors = response.json()
        assert isinstance(visitors, list)
        assert len(visitors) == 1
        assert visitors[0]["name"] == "Alice Smith"
        assert visitors[0]["age"] == 30
