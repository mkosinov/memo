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
    """Visitor-create extras for /api/visitors (CRUD covered by contract)."""

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

    def test_scoped_client_visitors_route_unchanged(self, api_client) -> None:
        """Regression guard: GET /api/v1/clients/{id}/visitors stays a bare array
        and returns every visitor for that one client (multi-row form).

        Spec D10 deliberately deviates from the generic envelope contract here:
        the scoped per-client visitors route is a bare list, NOT ``{items, ...}``.
        """
        client_id = _create_client(api_client)
        api_client.post(
            "/api/v1/visitors",
            json={"client_id": client_id, "name": "Alice", "age": 28},
        )
        api_client.post(
            "/api/v1/visitors",
            json={"client_id": client_id, "name": "Bob", "age": 35},
        )

        response = api_client.get(f"/api/v1/clients/{client_id}/visitors")
        assert response.status_code == 200
        body = response.json()
        # Bare array — NOT the {items, total, ...} envelope (spec D10)
        assert "items" not in body
        assert isinstance(body, list)
        assert len(body) == 2
        names = {v["name"] for v in body}
        assert "Alice" in names
        assert "Bob" in names
