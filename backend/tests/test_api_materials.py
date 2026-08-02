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


class TestMaterialsCrud:
    """Full CRUD round-trip for /api/v1/materials."""

    def test_list_materials_empty(self, api_client) -> None:
        """GET /api/v1/materials returns empty list when no materials exist."""
        response = api_client.get("/api/v1/materials")
        assert response.status_code == 200
        body = response.json()
        assert body["items"] == []
        assert body["total"] == 0

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
        body = response.json()
        ids = [m["id"] for m in body["items"]]
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
        body = response.json()
        materials = body["items"]
        assert body["total"] >= 1
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
