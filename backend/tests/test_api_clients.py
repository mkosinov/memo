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
    """Search-by-phone and scoped client-visitors sub-routes for /api/clients."""

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

    def test_patch_invalid_channel_returns_422(self, api_client) -> None:
        """PATCH with invalid channel value returns 422."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]

        resp = api_client.patch(
            f"/api/v1/clients/{client_id}", json={"channel": "instagram"}
        )
        assert resp.status_code == 422


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


# ─── Phone Search active-only regression (spec §5.5, #195) ────────────────────


class TestPhoneSearchActiveOnlyRegression:
    """Lock spec §5.5: GET /api/v1/clients/search?phone=X must always be
    active-only — archived clients must NEVER surface via phone search.

    This is a regression guard for the #195 archive-status refactor: although
    the list filter gained a `status=all` mode, the phone search endpoint
    is required to keep excluding soft-deleted clients.
    """

    def test_archived_client_phone_search_returns_404(
        self, api_client, create_client
    ) -> None:
        """Archive a client with a known phone → search must 404."""
        client = create_client(phone="+79990009988", name="To Archive")
        api_client.delete(f"/api/v1/clients/{client['id']}")

        resp = api_client.get(
            "/api/v1/clients/search", params={"phone": "+79990009988"}
        )
        assert resp.status_code == 404

    def test_active_client_phone_search_returns_200(
        self, api_client, create_client
    ) -> None:
        """Active client with the same phone number stays searchable."""
        client = create_client(phone="+79990008877", name="Stays Active")

        resp = api_client.get(
            "/api/v1/clients/search", params={"phone": "+79990008877"}
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == client["id"]
        assert body["is_active"] is True

    def test_archived_excluded_even_if_partner_active(
        self, api_client, create_client
    ) -> None:
        """Two clients share a phone; the archived one is never returned."""
        shared = "+79990007766"
        active_client = create_client(phone=shared, name="Active Sharer")
        archived_client = create_client(phone=shared, name="Archived Sharer")
        api_client.delete(f"/api/v1/clients/{archived_client['id']}")

        resp = api_client.get(
            "/api/v1/clients/search", params={"phone": shared}
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == active_client["id"]
        assert body["is_active"] is True


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
