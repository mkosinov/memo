"""Tests for the Locations CRUD API endpoints."""

import pytest

pytestmark = pytest.mark.api

LOCATION_PAYLOAD = {
    "name": "Test Studio",
    "address": "123 Art Street",
    "description": "A cozy studio for painting",
    "capacity": 10,
    "yandex_map_url": "https://yandex.ru/maps/test",
    "review_url": "https://example.com/review",
    "record_info": "Call +7-999-123-45-67",
    "image_url": "https://example.com/studio.jpg",
    "location_hint": "1 этаж, светлая студия с панорамными окнами",
}


class TestLocationsCrud:
    """Create-edge-case extras for /api/locations (CRUD covered by contract)."""

    def test_create_location_without_location_hint(self, api_client) -> None:
        """POST /api/locations omitting location_hint defaults to None."""
        payload = {k: v for k, v in LOCATION_PAYLOAD.items() if k != "location_hint"}
        response = api_client.post("/api/v1/locations", json=payload)

        assert response.status_code == 201
        assert response.json()["location_hint"] is None


class TestLocationListStatusFilter:
    """GET /api/v1/locations?status={active|archived|all} archive filtering (GH #195).

    The default (no ``status`` or ``status=active``) returns only active rows.
    These tests exercise the archive capabilities plus query-param validation:

      - ``?status=archived`` → only is_active=False rows
      - ``?status=all`` → both active and archived rows
      - ``?status=active`` → same as default (only active rows)
      - ``?status=foo`` → 422 from FastAPI enum validation
    """

    def test_list_status_archived_returns_only_archived(
        self, api_client, create_location
    ) -> None:
        """?status=archived hides active locations, surfaces soft-deleted ones."""
        active = create_location()
        archived = create_location()
        api_client.delete(f"/api/v1/locations/{archived['id']}")

        resp = api_client.get("/api/v1/locations?status=archived")
        assert resp.status_code == 200, f"list failed: {resp.text}"
        body = resp.json()
        assert body["total"] == 1, f"expected 1 archived, got {body['total']}"
        assert len(body["items"]) == 1
        ids = [loc["id"] for loc in body["items"]]
        assert archived["id"] in ids
        assert active["id"] not in ids
        assert body["items"][0]["is_active"] is False

    def test_list_status_all_returns_both_active_and_archived(
        self, api_client, create_location
    ) -> None:
        """?status=all returns every location regardless of is_active."""
        active = create_location()
        archived = create_location()
        api_client.delete(f"/api/v1/locations/{archived['id']}")

        resp = api_client.get("/api/v1/locations?status=all")
        assert resp.status_code == 200, f"list failed: {resp.text}"
        body = resp.json()
        assert body["total"] == 2, f"expected 2 total, got {body['total']}"
        ids = [loc["id"] for loc in body["items"]]
        assert active["id"] in ids
        assert archived["id"] in ids

    def test_list_status_active_explicit_matches_default(
        self, api_client, create_location
    ) -> None:
        """?status=active behaves the same as the default (no query param)."""
        active = create_location()
        archived = create_location()
        api_client.delete(f"/api/v1/locations/{archived['id']}")

        explicit = api_client.get("/api/v1/locations?status=active").json()
        default = api_client.get("/api/v1/locations").json()
        assert explicit["total"] == 1
        assert default["total"] == 1
        assert explicit["items"][0]["id"] == active["id"]
        assert default["items"][0]["id"] == active["id"]

    def test_list_status_invalid_returns_422(self, api_client) -> None:
        """?status=foo (not a valid ArchiveStatus) → 422 from enum validation."""
        resp = api_client.get("/api/v1/locations?status=foo")
        assert resp.status_code == 422
