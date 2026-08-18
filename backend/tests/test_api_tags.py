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


class TestTagListSorting:
    """Server-side sorting on GET /api/v1/tags (#205 Task 3).

    sort_by whitelist: tag (only key). sort_order: asc/desc. Unknown → 422.
    Default (sort_by=None): tag ASC, id ASC (spec §4.4 — NEW, was unspecified).
    """

    @staticmethod
    def _ids(resp) -> list[str]:
        assert resp.status_code == 200, f"list failed: {resp.text}"
        return [t["id"] for t in resp.json()["items"]]

    def test_sort_tag_asc_desc(self, api_client, create_tag) -> None:
        """sort_by=tag → [tag]; asc/desc both differ from insertion order."""
        t_z = create_tag(tag="zebra")   # inserted first
        t_a = create_tag(tag="apple")
        t_m = create_tag(tag="moon")

        asc = self._ids(api_client.get("/api/v1/tags?sort_by=tag&sort_order=asc"))
        assert asc.index(t_a["id"]) < asc.index(t_m["id"]) < asc.index(t_z["id"])

        desc = self._ids(api_client.get("/api/v1/tags?sort_by=tag&sort_order=desc"))
        assert desc.index(t_z["id"]) < desc.index(t_m["id"]) < desc.index(t_a["id"])

    def test_sort_invalid_key_422(self, api_client) -> None:
        """sort_by=bogus → 422 from Literal validation."""
        resp = api_client.get("/api/v1/tags?sort_by=bogus")
        assert resp.status_code == 422

    def test_default_order_locked(self, api_client, create_tag) -> None:
        """Default (no sort params): tag ASC, id ASC (NEW per spec §4.4).
        Insertion order differs from tag-ASC so the old unspecified DB
        order (insertion/rowid) would return a different sequence."""
        create_tag(tag="banana")  # inserted first
        create_tag(tag="apple")

        resp = api_client.get("/api/v1/tags")
        assert resp.status_code == 200
        tags = [t["tag"] for t in resp.json()["items"]]
        assert tags == ["apple", "banana"]  # tag ASC, not insertion order
