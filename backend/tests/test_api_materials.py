"""Tests for the Materials CRUD API endpoints."""

import pytest

pytestmark = pytest.mark.api


class TestMaterialsCrud:
    """Full CRUD round-trip for /api/v1/materials."""

    def test_list_materials_empty(self, api_client) -> None:
        """GET /api/v1/materials returns empty list when no materials exist."""
        response = api_client.get("/api/v1/materials")
        assert response.status_code == 200
        assert response.json() == []

    def test_create_material(self, api_client) -> None:
        """POST /api/v1/materials creates a material and returns 201."""
        response = api_client.post("/api/v1/materials", json={
            "title": "Масляные краски",
            "description": "Краски на основе масла",
        })
        assert response.status_code == 201
        data = response.json()
        assert data["title"] == "Масляные краски"
        assert data["description"] == "Краски на основе масла"
        assert "id" in data
        assert "created_at" in data
        assert "updated_at" in data
        assert data["is_active"] is True

    def test_get_material(self, api_client) -> None:
        """GET /api/v1/materials/{id} returns the specific material."""
        create = api_client.post("/api/v1/materials", json={
            "title": "Гуашь",
            "description": "Водорастворимая краска",
        })
        material_id = create.json()["id"]

        response = api_client.get(f"/api/v1/materials/{material_id}")
        assert response.status_code == 200
        assert response.json()["title"] == "Гуашь"

    def test_update_material(self, api_client) -> None:
        """PUT /api/v1/materials/{id} updates all fields."""
        create = api_client.post("/api/v1/materials", json={
            "title": "Old",
            "description": "Old desc",
        })
        material_id = create.json()["id"]

        response = api_client.put(f"/api/v1/materials/{material_id}", json={
            "title": "New",
            "description": "New desc",
        })
        assert response.status_code == 200
        assert response.json()["title"] == "New"
        assert response.json()["description"] == "New desc"

    def test_delete_material(self, api_client) -> None:
        """DELETE /api/v1/materials/{id} returns 204."""
        create = api_client.post("/api/v1/materials", json={
            "title": "ToDelete",
            "description": "desc",
        })
        material_id = create.json()["id"]

        response = api_client.delete(f"/api/v1/materials/{material_id}")
        assert response.status_code == 204

    def test_delete_material_soft_deletes(self, api_client) -> None:
        """DELETE /api/v1/materials/{id} soft-deletes and list excludes it."""
        create = api_client.post("/api/v1/materials", json={
            "title": "Ghost",
            "description": "desc",
        })
        material_id = create.json()["id"]
        api_client.delete(f"/api/v1/materials/{material_id}")

        # GET by id should still return it (soft delete, not hard)
        response = api_client.get(f"/api/v1/materials/{material_id}")
        assert response.status_code == 200
        assert response.json()["is_active"] is False

        # List should NOT include the deleted material
        response = api_client.get("/api/v1/materials")
        materials = response.json()
        ids = [m["id"] for m in materials]
        assert material_id not in ids

    def test_list_materials_includes_created(self, api_client) -> None:
        """GET /api/v1/materials returns a list containing the created material."""
        create_resp = api_client.post("/api/v1/materials", json={
            "title": "Пастель",
            "description": "Мягкие мелки",
        })
        material_id = create_resp.json()["id"]

        response = api_client.get("/api/v1/materials")
        assert response.status_code == 200
        materials = response.json()
        assert isinstance(materials, list)
        ids = [m["id"] for m in materials]
        assert material_id in ids

    def test_get_nonexistent_material_returns_404(self, api_client) -> None:
        """GET /api/v1/materials/{fake_id} returns 404."""
        response = api_client.get("/api/v1/materials/nonexistent-id")
        assert response.status_code == 404

    def test_update_nonexistent_material_returns_404(self, api_client) -> None:
        """PUT /api/v1/materials/{fake_id} returns 404."""
        response = api_client.put(
            "/api/v1/materials/nonexistent-id",
            json={"title": "X", "description": "Y"},
        )
        assert response.status_code == 404

    def test_delete_nonexistent_material_returns_404(self, api_client) -> None:
        """DELETE /api/v1/materials/{fake_id} returns 404."""
        response = api_client.delete("/api/v1/materials/nonexistent-id")
        assert response.status_code == 404


class TestMaterialPatch:
    """Tests for PATCH /api/v1/materials/{id}."""

    def test_patch_material_not_found_404(self, api_client) -> None:
        """PATCH nonexistent material returns 404."""
        response = api_client.patch("/api/v1/materials/nonexistent-id", json={"title": "New"})
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "MATERIAL_NOT_FOUND"
