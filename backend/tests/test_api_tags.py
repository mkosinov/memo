"""Tests for the Tags CRUD API endpoints."""

import pytest

pytestmark = pytest.mark.api


class TestTagAllEndpoint:
    """GET /api/v1/tags/all — bare array (GH #205 Task 2).

    Minimal smoke: returns a bare JSON array (not an envelope) containing
    created tags. Tags have no ``status`` param (non-archive, hard-delete
    only). Full generic contract lands in Task 4.
    """

    def test_all_returns_bare_array(self, api_client, create_tag) -> None:
        created = create_tag()
        resp = api_client.get("/api/v1/tags/all")
        assert resp.status_code == 200, f"GET /all failed: {resp.text}"
        body = resp.json()
        assert isinstance(body, list), "/all must return a bare array, not an envelope"
        assert any(item["id"] == created["id"] for item in body)
