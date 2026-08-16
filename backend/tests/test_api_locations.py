"""Tests for the Locations CRUD API endpoints."""

import pytest

from tests.conftest import query_db

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


class TestDeleteUnifiedRoute:
    """DELETE /api/v1/locations/{id} — unified dry-run (no body) + execute (with body).

    Spec: docs/specs/2026-08-15-delete-hard-delete-and-dependency-resolution-design.md
      * §2  — Change 1: body presence distinguishes dry-run vs execute.
      * §5  — 409 Conflict response (counters + sums only).
      * §6  — DELETE with resolutions body (executor = Task 10).
      * §14 — acceptance criteria.
    """

    def test_delete_location_with_activities_no_body_returns_409(
        self, api_client, create_activity
    ) -> None:
        """No body + blocking dep (activities) → 409 + dependency tree (spec §5)."""
        activity = create_activity()
        location_id = activity["location_id"]

        resp = api_client.delete(f"/api/v1/locations/{location_id}")

        assert resp.status_code == 409
        body = resp.json()
        assert body["detail"] == "has_dependencies"
        entities = [d["entity"] for d in body["dependencies"]]
        assert "activities" in entities
        activities_dep = next(
            d for d in body["dependencies"] if d["entity"] == "activities"
        )
        assert activities_dep["count"] == 1
        assert activities_dep["allowed_actions"] == []
        assert activities_dep["message"] is not None
        # Row untouched.
        assert api_client.get(f"/api/v1/locations/{location_id}").status_code == 200

    def test_delete_bare_location_no_body_returns_204_and_row_gone(
        self, api_client, create_location
    ) -> None:
        """No body + zero deps → 204 hard delete; row physically gone (spec §2)."""
        location = create_location()

        resp = api_client.delete(f"/api/v1/locations/{location['id']}")

        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/locations/{location['id']}").status_code == 404

    def test_delete_nonexistent_location_no_body_returns_404(self, api_client) -> None:
        """No body + nonexistent id → 404 (service.delete returns False)."""
        resp = api_client.delete("/api/v1/locations/nonexistent-location-id")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "LOCATION_NOT_FOUND"

    def test_delete_nonexistent_location_with_body_returns_404(self, api_client) -> None:
        """With body + nonexistent id → 404 (executor returns False).

        EXPECTED RED until Task 10 (resolve_delete missing → AttributeError today).
        """
        resp = api_client.request(
            "DELETE",
            "/api/v1/locations/nonexistent-location-id",
            json={"location_tags": "cascade"},
        )
        assert resp.status_code == 404

    def test_delete_location_with_tags_with_body_executes_204(
        self, api_client, create_location
    ) -> None:
        """With body ``{}`` + all-auto dep (location_tags) → 204 execute.

        ``location_tags`` is auto-cascade — the empty ``{}`` body opts into
        execute. EXPECTED RED until Task 10 lands ``ArchiveService.resolve_delete``
        (AttributeError → 500 today).
        """
        location = create_location()
        tag_id = api_client.post(
            "/api/v1/tags", json={"tag": f"lt-{location['id'][:8]}"}
        ).json()["id"]
        query_db(
            f"INSERT INTO location_tags (location_id, tag_id) "
            f"VALUES ('{location['id']}', '{tag_id}')"
        )

        resp = api_client.request(
            "DELETE", f"/api/v1/locations/{location['id']}", json={}
        )

        assert resp.status_code == 204
        # Location + tag join physically gone (Task 10 executor).
        assert api_client.get(f"/api/v1/locations/{location['id']}").status_code == 404
        assert (
            query_db(
                f"SELECT * FROM location_tags WHERE location_id='{location['id']}'"
            )
            == []
        )

    def test_delete_location_with_activities_with_body_returns_422_blocking(
        self, api_client, create_activity
    ) -> None:
        """With body + blocking dep (activities) → 422 'archive instead' (spec §6.4)."""
        activity = create_activity()
        location_id = activity["location_id"]

        resp = api_client.request(
            "DELETE", f"/api/v1/locations/{location_id}", json={}
        )

        assert resp.status_code == 422
        # Row untouched.
        assert api_client.get(f"/api/v1/locations/{location_id}").status_code == 200
