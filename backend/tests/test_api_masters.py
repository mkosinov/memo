"""Tests for the Masters CRUD API endpoints."""

import pytest

pytestmark = pytest.mark.api

MASTER_PAYLOAD = {
    "first_name": "Anna",
    "last_name": "Ivanova",
    "color": "#5B8C7A",
    "position": "senior",
    "specialty": "oil",
    "avatar_url": "https://example.com/avatar.jpg",
}


class TestMastersCrud:
    """Full CRUD round-trip for /api/masters."""

    def test_create_master(self, api_client) -> None:
        """POST /api/masters creates a master and returns 201."""
        response = api_client.post("/api/v1/masters", json=MASTER_PAYLOAD)

        assert response.status_code == 201
        body = response.json()
        assert body["first_name"] == "Anna"
        assert body["last_name"] == "Ivanova"
        assert body["color"] == "#5B8C7A"
        assert "id" in body
        assert "created_at" in body
        assert "updated_at" in body
        assert body["is_active"] is True

    def test_list_masters_includes_created(self, api_client) -> None:
        """GET /api/masters returns a list containing the created master."""
        create_resp = api_client.post("/api/v1/masters", json=MASTER_PAYLOAD)
        master_id = create_resp.json()["id"]

        response = api_client.get("/api/v1/masters")
        assert response.status_code == 200
        body = response.json()
        masters = body["items"]
        assert body["total"] >= 1
        assert body["page"] == 1
        assert body["per_page"] == 20
        ids = [m["id"] for m in masters]
        assert master_id in ids

    def test_get_master_by_id(self, api_client) -> None:
        """GET /api/masters/{id} returns the specific master."""
        create_resp = api_client.post("/api/v1/masters", json=MASTER_PAYLOAD)
        master_id = create_resp.json()["id"]

        response = api_client.get(f"/api/v1/masters/{master_id}")
        assert response.status_code == 200
        body = response.json()
        assert body["id"] == master_id
        assert body["first_name"] == "Anna"

    def test_update_master(self, api_client) -> None:
        """PUT /api/masters/{id} updates all fields."""
        create_resp = api_client.post("/api/v1/masters", json=MASTER_PAYLOAD)
        master_id = create_resp.json()["id"]

        update_data = {
            "first_name": "Anna",
            "last_name": "Petrova",
            "color": "#FF5733",
            "position": "lead",
            "specialty": "watercolor",
            "avatar_url": "https://example.com/new-avatar.jpg",
        }
        response = api_client.put(f"/api/v1/masters/{master_id}", json=update_data)
        assert response.status_code == 200
        body = response.json()
        assert body["last_name"] == "Petrova"
        assert body["color"] == "#FF5733"
        assert body["position"] == "lead"
        assert body["specialty"] == "watercolor"

    def test_delete_master_soft_deletes(self, api_client) -> None:
        """DELETE /api/masters/{id} soft-deletes and list excludes it."""
        create_resp = api_client.post("/api/v1/masters", json=MASTER_PAYLOAD)
        master_id = create_resp.json()["id"]

        # Delete
        response = api_client.delete(f"/api/v1/masters/{master_id}")
        assert response.status_code == 204

        # GET by id should still return it (soft delete, not hard)
        response = api_client.get(f"/api/v1/masters/{master_id}")
        assert response.status_code == 200
        assert response.json()["is_active"] is False

        # List should NOT include the deleted master
        response = api_client.get("/api/v1/masters")
        body = response.json()
        ids = [m["id"] for m in body["items"]]
        assert master_id not in ids

    def test_get_nonexistent_master_returns_404(self, api_client) -> None:
        """GET /api/masters/{fake_id} returns 404."""
        response = api_client.get("/api/v1/masters/nonexistent-id")
        assert response.status_code == 404

    def test_update_nonexistent_master_returns_404(self, api_client) -> None:
        """PUT /api/masters/{fake_id} returns 404."""
        response = api_client.put(
            "/api/v1/masters/nonexistent-id",
            json=MASTER_PAYLOAD,
        )
        assert response.status_code == 404

    def test_delete_nonexistent_master_returns_404(self, api_client) -> None:
        """DELETE /api/masters/{fake_id} returns 404."""
        response = api_client.delete("/api/v1/masters/nonexistent-id")
        assert response.status_code == 404


class TestMasterPatch:
    """Tests for PATCH /api/v1/masters/{id}."""

    def test_patch_master_not_found_404(self, api_client) -> None:
        """PATCH nonexistent master returns 404."""
        response = api_client.patch("/api/v1/masters/nonexistent-id", json={"color": "#FF0000"})
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "MASTER_NOT_FOUND"


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
