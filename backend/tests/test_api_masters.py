"""Tests for the Masters CRUD API endpoints."""

import pytest

pytestmark = pytest.mark.api


class TestMasterListStatusFilter:
    """GET /api/v1/masters?status={active|archived|all} archive filtering (GH #195).

    The default (no ``status`` or ``status=active``) returns only active rows.
    These tests exercise the archive capabilities plus query-param validation:

      - ``?status=archived`` → only is_active=False rows
      - ``?status=all`` → both active and archived rows
      - ``?status=active`` → same as default (only active rows)
      - ``?status=foo`` → 422 from FastAPI enum validation
    """

    def test_list_status_archived_returns_only_archived(
        self, api_client, create_master
    ) -> None:
        """?status=archived hides active masters, surfaces soft-deleted ones."""
        active = create_master()
        archived = create_master()
        api_client.delete(f"/api/v1/masters/{archived['id']}")

        resp = api_client.get("/api/v1/masters?status=archived")
        assert resp.status_code == 200, f"list failed: {resp.text}"
        body = resp.json()
        assert body["total"] == 1, f"expected 1 archived, got {body['total']}"
        assert len(body["items"]) == 1
        ids = [m["id"] for m in body["items"]]
        assert archived["id"] in ids
        assert active["id"] not in ids
        assert body["items"][0]["is_active"] is False

    def test_list_status_all_returns_both_active_and_archived(
        self, api_client, create_master
    ) -> None:
        """?status=all returns every master regardless of is_active."""
        active = create_master()
        archived = create_master()
        api_client.delete(f"/api/v1/masters/{archived['id']}")

        resp = api_client.get("/api/v1/masters?status=all")
        assert resp.status_code == 200, f"list failed: {resp.text}"
        body = resp.json()
        assert body["total"] == 2, f"expected 2 total, got {body['total']}"
        ids = [m["id"] for m in body["items"]]
        assert active["id"] in ids
        assert archived["id"] in ids

    def test_list_status_active_explicit_matches_default(
        self, api_client, create_master
    ) -> None:
        """?status=active behaves the same as the default (no query param)."""
        active = create_master()
        archived = create_master()
        api_client.delete(f"/api/v1/masters/{archived['id']}")

        explicit = api_client.get("/api/v1/masters?status=active").json()
        default = api_client.get("/api/v1/masters").json()
        assert explicit["total"] == 1
        assert default["total"] == 1
        assert explicit["items"][0]["id"] == active["id"]
        assert default["items"][0]["id"] == active["id"]

    def test_list_status_invalid_returns_422(self, api_client) -> None:
        """?status=foo (not a valid ArchiveStatus) → 422 from enum validation."""
        resp = api_client.get("/api/v1/masters?status=foo")
        assert resp.status_code == 422
