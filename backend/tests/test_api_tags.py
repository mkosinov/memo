"""Tests for the Tags CRUD API endpoints."""

import pytest

pytestmark = pytest.mark.api


class TestTagsCrud:
    """Full CRUD round-trip for /api/v1/tags."""

    def test_list_tags_empty(self, api_client) -> None:
        """GET /api/v1/tags returns empty list when no tags exist."""
        response = api_client.get("/api/v1/tags")
        assert response.status_code == 200
        assert response.json() == []

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
        tags = response.json()
        assert len(tags) >= 1
        assert any(t["tag"] == "Постоянный" for t in tags)

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
        tags = response.json()
        assert not any(t["id"] == tag_id for t in tags)

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

    def test_patch_tag_partial_update(self, api_client) -> None:
        """PATCH updates only the sent field."""
        create = api_client.post("/api/v1/tags", json={"tag": "Old"})
        tag_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/tags/{tag_id}", json={"tag": "New"})
        assert response.status_code == 200
        assert response.json()["tag"] == "New"

    def test_patch_tag_not_found_404(self, api_client) -> None:
        """PATCH nonexistent tag returns 404."""
        response = api_client.patch("/api/v1/tags/nonexistent-id", json={"tag": "New"})
        assert response.status_code == 404

    def test_patch_tag_empty_body(self, api_client) -> None:
        """PATCH with empty body makes no changes."""
        create = api_client.post("/api/v1/tags", json={"tag": "Unchanged"})
        tag_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/tags/{tag_id}", json={})
        assert response.status_code == 200
        assert response.json()["tag"] == "Unchanged"

    def test_patch_tag_null_stripped(self, api_client) -> None:
        """PATCH with null for NOT NULL field is silently stripped."""
        create = api_client.post("/api/v1/tags", json={"tag": "KeepMe"})
        tag_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/tags/{tag_id}", json={"tag": None})
        assert response.status_code == 200
        assert response.json()["tag"] == "KeepMe"
