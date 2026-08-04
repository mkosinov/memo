"""Tests for the Materials CRUD API endpoints."""

import pytest

pytestmark = pytest.mark.api


def _create_material(api_client, title="Test Material", description="desc"):
    """Create a material via POST /api/v1/materials and return its JSON.

    Mirrors the ``_create_tag`` helper in ``test_api_services.py``.
    """
    resp = api_client.post(
        "/api/v1/materials", json={"title": title, "description": description}
    )
    assert resp.status_code == 201, f"create material failed: {resp.status_code}: {resp.text}"
    return resp.json()


class TestMaterialListStatusFilter:
    """GET /api/v1/materials?status={active|archived|all} archive filtering (GH #195).

    The default (no ``status`` or ``status=active``) returns only active rows.
    These tests exercise the archive capabilities plus query-param validation:

      - ``?status=archived`` → only is_active=False rows
      - ``?status=all`` → both active and archived rows
      - ``?status=active`` → same as default (only active rows)
      - ``?status=foo`` → 422 from FastAPI enum validation
    """

    def test_list_status_archived_returns_only_archived(self, api_client) -> None:
        """?status=archived hides active materials, surfaces soft-deleted ones."""
        active = _create_material(api_client, title="Active Mat")
        archived = _create_material(api_client, title="Archived Mat")
        api_client.delete(f"/api/v1/materials/{archived['id']}")

        resp = api_client.get("/api/v1/materials?status=archived")
        assert resp.status_code == 200, f"list failed: {resp.text}"
        body = resp.json()
        assert body["total"] == 1, f"expected 1 archived, got {body['total']}"
        assert len(body["items"]) == 1
        ids = [m["id"] for m in body["items"]]
        assert archived["id"] in ids
        assert active["id"] not in ids
        assert body["items"][0]["is_active"] is False

    def test_list_status_all_returns_both_active_and_archived(self, api_client) -> None:
        """?status=all returns every material regardless of is_active."""
        active = _create_material(api_client, title="Active All")
        archived = _create_material(api_client, title="Archived All")
        api_client.delete(f"/api/v1/materials/{archived['id']}")

        resp = api_client.get("/api/v1/materials?status=all")
        assert resp.status_code == 200, f"list failed: {resp.text}"
        body = resp.json()
        assert body["total"] == 2, f"expected 2 total, got {body['total']}"
        ids = [m["id"] for m in body["items"]]
        assert active["id"] in ids
        assert archived["id"] in ids

    def test_list_status_active_explicit_matches_default(self, api_client) -> None:
        """?status=active behaves the same as the default (no query param)."""
        active = _create_material(api_client, title="Active Explicit")
        archived = _create_material(api_client, title="Archived Explicit")
        api_client.delete(f"/api/v1/materials/{archived['id']}")

        explicit = api_client.get("/api/v1/materials?status=active").json()
        default = api_client.get("/api/v1/materials").json()
        assert explicit["total"] == 1
        assert default["total"] == 1
        assert explicit["items"][0]["id"] == active["id"]
        assert default["items"][0]["id"] == active["id"]

    def test_list_status_invalid_returns_422(self, api_client) -> None:
        """?status=foo (not a valid ArchiveStatus) → 422 from enum validation."""
        resp = api_client.get("/api/v1/materials?status=foo")
        assert resp.status_code == 422
