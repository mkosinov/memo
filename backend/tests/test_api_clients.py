"""Tests for the Clients CRUD API endpoints."""

import pytest

pytestmark = pytest.mark.api

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
        """GET /api/clients returns a paginated response containing the created client."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]

        response = api_client.get("/api/v1/clients")
        assert response.status_code == 200
        body = response.json()
        assert "items" in body
        assert "total" in body
        ids = [c["id"] for c in body["items"]]
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
        ids = [c["id"] for c in response.json()["items"]]
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

    def test_list_visitors_for_nonexistent_client(self, api_client) -> None:
        """GET /api/clients/{id}/visitors returns empty list for nonexistent client."""
        response = api_client.get("/api/v1/clients/nonexistent-id/visitors")
        assert response.status_code == 200
        assert response.json() == []


# ─── Create Edge Cases ────────────────────────────────────────────────────────


class TestClientCreateEdgeCases:
    """Edge cases for POST /api/v1/clients."""

    def test_create_client_with_empty_body(self, api_client) -> None:
        """POST with empty body creates client with all null fields."""
        resp = api_client.post("/api/v1/clients", json={})
        assert resp.status_code == 201
        body = resp.json()
        assert body["name"] is None
        assert body["phone"] is None
        assert body["email"] is None
        assert body["channel"] is None
        assert body["is_active"] is True

    def test_create_client_with_only_name(self, api_client) -> None:
        """POST with only name creates client."""
        resp = api_client.post("/api/v1/clients", json={"name": "Solo"})
        assert resp.status_code == 201
        body = resp.json()
        assert body["name"] == "Solo"
        assert body["phone"] is None

    def test_create_client_with_only_phone(self, api_client) -> None:
        """POST with only phone creates client."""
        resp = api_client.post("/api/v1/clients", json={"phone": "+79990001111"})
        assert resp.status_code == 201
        body = resp.json()
        assert body["phone"] == "+79990001111"
        assert body["name"] is None

    def test_create_client_all_channels(self, api_client) -> None:
        """POST with each valid channel value succeeds."""
        for channel in ("telegram", "max", "whatsapp"):
            resp = api_client.post(
                "/api/v1/clients",
                json={"name": f"Ch {channel}", "channel": channel},
            )
            assert resp.status_code == 201, f"Channel '{channel}' rejected: {resp.text}"
            assert resp.json()["channel"] == channel

    def test_create_client_invalid_channel_returns_422(self, api_client) -> None:
        """POST with invalid channel returns 422."""
        resp = api_client.post(
            "/api/v1/clients",
            json={"name": "Bad", "channel": "instagram"},
        )
        assert resp.status_code == 422

    def test_create_client_null_channel_explicit(self, api_client) -> None:
        """POST with explicit null channel creates client with null channel."""
        resp = api_client.post(
            "/api/v1/clients",
            json={"name": "Null Ch", "channel": None},
        )
        assert resp.status_code == 201
        assert resp.json()["channel"] is None

    def test_create_client_response_has_all_fields(self, api_client) -> None:
        """POST response contains id, created_at, updated_at, is_active."""
        resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        body = resp.json()
        assert isinstance(body["id"], str)
        assert len(body["id"]) > 0
        assert "created_at" in body
        assert "updated_at" in body
        assert body["is_active"] is True

    def test_create_two_clients_different_ids(self, api_client) -> None:
        """Two created clients have different IDs."""
        r1 = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        r2 = api_client.post(
            "/api/v1/clients",
            json={**CLIENT_PAYLOAD, "phone": "+79999999999"},
        )
        assert r1.json()["id"] != r2.json()["id"]


# ─── PATCH Edge Cases ─────────────────────────────────────────────────────────


class TestPatchClientEdgeCases:
    """Edge cases for PATCH /api/v1/clients/{id}."""

    def test_patch_multiple_fields_at_once(self, api_client) -> None:
        """PATCH updates multiple fields in one request."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]

        resp = api_client.patch(f"/api/v1/clients/{client_id}", json={
            "name": "Multi Update",
            "phone": "+79995556677",
            "channel": "max",
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "Multi Update"
        assert body["phone"] == "+79995556677"
        assert body["channel"] == "max"

    def test_patch_sets_name_to_null(self, api_client) -> None:
        """PATCH with name=null clears the name."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]

        resp = api_client.patch(f"/api/v1/clients/{client_id}", json={"name": None})
        assert resp.status_code == 200
        assert resp.json()["name"] is None

    def test_patch_sets_phone_to_null(self, api_client) -> None:
        """PATCH with phone=null clears the phone."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]

        resp = api_client.patch(f"/api/v1/clients/{client_id}", json={"phone": None})
        assert resp.status_code == 200
        assert resp.json()["phone"] is None

    def test_patch_sets_email_to_null(self, api_client) -> None:
        """PATCH with email=null clears the email."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]

        resp = api_client.patch(f"/api/v1/clients/{client_id}", json={"email": None})
        assert resp.status_code == 200
        assert resp.json()["email"] is None

    def test_patch_sets_channel_to_null(self, api_client) -> None:
        """PATCH with channel=null clears the channel."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]

        resp = api_client.patch(f"/api/v1/clients/{client_id}", json={"channel": None})
        assert resp.status_code == 200
        assert resp.json()["channel"] is None

    def test_patch_invalid_channel_returns_422(self, api_client) -> None:
        """PATCH with invalid channel value returns 422."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]

        resp = api_client.patch(
            f"/api/v1/clients/{client_id}", json={"channel": "instagram"}
        )
        assert resp.status_code == 422

    def test_patch_preserves_other_fields_when_updating_one(
        self, api_client
    ) -> None:
        """PATCH email only does not touch name, phone, channel."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]
        original = create_resp.json()

        resp = api_client.patch(
            f"/api/v1/clients/{client_id}", json={"email": "new@example.com"}
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["email"] == "new@example.com"
        assert body["name"] == original["name"]
        assert body["phone"] == original["phone"]
        assert body["channel"] == original["channel"]

    def test_patch_updates_updated_at_timestamp(self, api_client) -> None:
        """PATCH changes the updated_at timestamp."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]
        original_updated = create_resp.json()["updated_at"]

        resp = api_client.patch(
            f"/api/v1/clients/{client_id}", json={"name": "Timestamp Test"}
        )
        assert resp.status_code == 200
        assert resp.json()["updated_at"] >= original_updated


# ─── PUT Edge Cases ───────────────────────────────────────────────────────────


class TestPutClientEdgeCases:
    """Edge cases for PUT /api/v1/clients/{id}."""

    def test_put_sets_all_nullable_to_null(self, api_client) -> None:
        """PUT with all null fields clears everything."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]

        resp = api_client.put(f"/api/v1/clients/{client_id}", json={
            "name": None,
            "phone": None,
            "email": None,
            "channel": None,
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] is None
        assert body["phone"] is None
        assert body["email"] is None
        assert body["channel"] is None

    def test_put_invalid_channel_returns_422(self, api_client) -> None:
        """PUT with invalid channel returns 422."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]

        resp = api_client.put(f"/api/v1/clients/{client_id}", json={
            **CLIENT_PAYLOAD,
            "channel": "invalid_channel",
        })
        assert resp.status_code == 422

    def test_put_empty_body(self, api_client) -> None:
        """PUT with empty body sets all fields to null."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]

        resp = api_client.put(f"/api/v1/clients/{client_id}", json={})
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] is None
        assert body["phone"] is None


# ─── Search Edge Cases ────────────────────────────────────────────────────────


class TestSearchClientEdgeCases:
    """Edge cases for GET /api/v1/clients/search."""

    def test_search_is_case_insensitive(self, api_client) -> None:
        """Phone search matches regardless of case."""
        api_client.post(
            "/api/v1/clients",
            json={"name": "CaseTest", "phone": "+79998887766"},
        )
        resp = api_client.get(
            "/api/v1/clients/search", params={"phone": "+79998887766"}
        )
        assert resp.status_code == 200
        assert resp.json()["phone"] == "+79998887766"

    def test_search_missing_phone_param_returns_422(self, api_client) -> None:
        """GET /search without phone param returns 422."""
        resp = api_client.get("/api/v1/clients/search")
        assert resp.status_code == 422

    def test_search_short_phone_returns_422(self, api_client) -> None:
        """GET /search with phone < 3 chars returns 422 (min_length=3)."""
        resp = api_client.get("/api/v1/clients/search", params={"phone": "ab"})
        assert resp.status_code == 422


# ─── Response Contract ────────────────────────────────────────────────────────


class TestClientResponseContract:
    """Verify API responses validate against Pydantic schemas."""

    def test_single_client_response_validates(self, api_client) -> None:
        """GET /api/v1/clients/{id} response validates against ClientResponse."""
        from src.schemas.client import ClientResponse

        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]

        resp = api_client.get(f"/api/v1/clients/{client_id}")
        validated = ClientResponse.model_validate(resp.json())
        assert str(validated.id) == client_id

    def test_list_client_items_validate(self, api_client) -> None:
        """Each item in GET /api/v1/clients validates against ClientWithStats."""
        from src.schemas.client import ClientWithStats

        api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)

        resp = api_client.get("/api/v1/clients")
        for item in resp.json()["items"]:
            ClientWithStats.model_validate(item)

    def test_create_response_validates(self, api_client) -> None:
        """POST response validates against ClientResponse."""
        from src.schemas.client import ClientResponse

        resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        validated = ClientResponse.model_validate(resp.json())
        assert validated.name == "John Smith"

    def test_patch_response_validates(self, api_client) -> None:
        """PATCH response validates against ClientResponse."""
        from src.schemas.client import ClientResponse

        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]

        resp = api_client.patch(
            f"/api/v1/clients/{client_id}", json={"name": "Patched"}
        )
        validated = ClientResponse.model_validate(resp.json())
        assert validated.name == "Patched"


# ─── Channel Tolerance (Issue #60) ─────────────────────────────────────────


class TestClientChannelTolerance:
    """Issue #60: GET /api/v1/clients must tolerate any channel value in DB.

    Channel enum has telegram/max/whatsapp, but DB has instagram/vk/website.
    Response schema must accept any string from DB.
    """

    def test_get_clients_with_unknown_channel_returns_200(self, api_client) -> None:
        """Insert client with channel='instagram' via SQL, GET must return 200."""
        import sqlite3
        import uuid as _uuid

        from tests.conftest import _db_file

        client_id = str(_uuid.uuid4())
        # Bypass API validation by inserting directly via SQL
        # (DB column is String(50), so any value is accepted at DB level)
        conn = sqlite3.connect(_db_file.name)
        conn.execute(
            "INSERT INTO clients (id, name, phone, email, channel, "
            "created_at, updated_at, is_active) VALUES "
            "(?, 'Instagram User', '+79990000001', NULL, 'instagram', "
            "datetime('now'), datetime('now'), 1)",
            (client_id,),
        )
        conn.commit()
        conn.close()

        resp = api_client.get("/api/v1/clients")
        assert resp.status_code == 200, f"GET failed: {resp.text}"
        body = resp.json()
        # Find the client with the unknown channel
        matching = [c for c in body["items"] if c["id"] == client_id]
        assert len(matching) == 1
        assert matching[0]["channel"] == "instagram"

    def test_post_client_with_unknown_channel_returns_422(self, api_client) -> None:
        """POST must still REJECT unknown channel — input schema keeps enum."""
        import uuid as _uuid

        resp = api_client.post(
            "/api/v1/clients",
            json={
                "name": "Bad Channel",
                "phone": f"+7999{_uuid.uuid4().hex[:7]}",
                "channel": "instagram",
            },
        )
        assert resp.status_code == 422, (
            f"Expected 422 for unknown channel, got {resp.status_code}: {resp.text}"
        )
