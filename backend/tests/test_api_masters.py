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
        masters = response.json()
        assert isinstance(masters, list)
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
        masters = response.json()
        ids = [m["id"] for m in masters]
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
