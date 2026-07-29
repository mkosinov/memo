"""Tests for the Tags CRUD API endpoints."""

import pytest

pytestmark = pytest.mark.api


class TestTagsCrud:
    """Full CRUD round-trip for /api/v1/tags."""

    def test_list_tags_empty(self, api_client) -> None:
        """GET /api/v1/tags returns empty list when no tags exist."""
        response = api_client.get("/api/v1/tags")
        assert response.status_code == 200
        body = response.json()
        assert body["items"] == []
        assert body["total"] == 0

    def test_create_tag(self, api_client) -> None:
        """POST /api/v1/tags creates a tag and returns 201."""
        response = api_client.post("/api/v1/tags", json={"tag": "VIP"})
        assert response.status_code == 201
        data = response.json()
        assert data["tag"] == "VIP"
        assert "id" in data

    def test_list_tags_after_create(self, api_client) -> None:
        """GET /api/v1/tags returns created tags."""
        api_client.post("/api/v1/tags", json={"tag": "Постоянный"})
        response = api_client.get("/api/v1/tags")
        assert response.status_code == 200
        body = response.json()
        tags = body["items"]
        assert body["total"] >= 1
        assert any(t["tag"] == "Постоянный" for t in tags)

    def test_get_tag_by_id(self, api_client) -> None:
        """GET /api/v1/tags/{id} returns the specific tag."""
        create = api_client.post("/api/v1/tags", json={"tag": "VIP"})
        tag_id = create.json()["id"]

        response = api_client.get(f"/api/v1/tags/{tag_id}")
        assert response.status_code == 200
        body = response.json()
        assert body["id"] == tag_id
        assert body["tag"] == "VIP"

    def test_get_nonexistent_tag_returns_404(self, api_client) -> None:
        """GET /api/v1/tags/{fake_id} returns 404 with TAG_NOT_FOUND."""
        response = api_client.get("/api/v1/tags/nonexistent-id")
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "TAG_NOT_FOUND"

    def test_get_deleted_tag_returns_200(self, api_client) -> None:
        """Soft-deleted tag stays fetchable by id (200) but is excluded from the list."""
        create = api_client.post("/api/v1/tags", json={"tag": "Ephemeral"})
        tag_id = create.json()["id"]
        delete = api_client.delete(f"/api/v1/tags/{tag_id}")
        assert delete.status_code == 204

        # Soft-delete: row remains fetchable by id (TagResponse has no is_active field)
        response = api_client.get(f"/api/v1/tags/{tag_id}")
        assert response.status_code == 200
        assert response.json()["id"] == tag_id

        # ... but is excluded from the list
        body = api_client.get("/api/v1/tags").json()
        assert not any(t["id"] == tag_id for t in body["items"])

    def test_update_tag(self, api_client) -> None:
        """PUT /api/v1/tags/{id} updates a tag."""
        create = api_client.post("/api/v1/tags", json={"tag": "Old"})
        tag_id = create.json()["id"]
        response = api_client.put(f"/api/v1/tags/{tag_id}", json={"tag": "New"})
        assert response.status_code == 200
        assert response.json()["tag"] == "New"

    def test_delete_tag(self, api_client) -> None:
        """DELETE /api/v1/tags/{id} soft-deletes a tag (204)."""
        create = api_client.post("/api/v1/tags", json={"tag": "ToDelete"})
        tag_id = create.json()["id"]
        response = api_client.delete(f"/api/v1/tags/{tag_id}")
        assert response.status_code == 204

    def test_deleted_tag_excluded_from_list(self, api_client) -> None:
        """Soft-deleted tags are excluded from GET /api/v1/tags."""
        create = api_client.post("/api/v1/tags", json={"tag": "Ghost"})
        tag_id = create.json()["id"]
        api_client.delete(f"/api/v1/tags/{tag_id}")
        response = api_client.get("/api/v1/tags")
        body = response.json()
        assert not any(t["id"] == tag_id for t in body["items"])

    def test_update_nonexistent_tag_returns_404(self, api_client) -> None:
        """PUT /api/v1/tags/{fake_id} returns 404."""
        response = api_client.put(
            "/api/v1/tags/nonexistent-id",
            json={"tag": "Updated"},
        )
        assert response.status_code == 404

    def test_delete_nonexistent_tag_returns_404(self, api_client) -> None:
        """DELETE /api/v1/tags/{fake_id} returns 404."""
        response = api_client.delete("/api/v1/tags/nonexistent-id")
        assert response.status_code == 404


class TestTagPatch:
    """Tests for PATCH /api/v1/tags/{id}."""

    def test_patch_tag_not_found_404(self, api_client) -> None:
        """PATCH nonexistent tag returns 404."""
        response = api_client.patch("/api/v1/tags/nonexistent-id", json={"tag": "New"})
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "TAG_NOT_FOUND"
