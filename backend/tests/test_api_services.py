"""Tests for the Services CRUD API endpoints with nested Tariffs and Tags."""

import pytest

pytestmark = pytest.mark.api

SERVICE_PAYLOAD = {
    "title": "Oil Painting for Beginners",
    "description": "Learn the basics of oil painting",
    "image_url": "https://example.com/oil-painting.jpg",
    "specialty": "oil",
    "min_age": 12,
    "max_age": 99,
    "duration": 90,
    "record_info": "Bring your own apron",
    "material_hint": "Масляные краски, холст на подрамнике 40×50 см",
}

TAG_PAYLOAD = {"tag": "beginner"}

TARIFF_PAYLOAD = {
    "title": "Standard",
    "description": "Standard tariff",
    "price": 1500,
}


def _create_tag(api_client) -> str:
    """Create a tag via POST /api/tags and return its ID."""
    response = api_client.post("/api/v1/tags", json=TAG_PAYLOAD)
    assert response.status_code == 201
    return response.json()["id"]


class TestServicesCrud:
    """Full CRUD round-trip for /api/services."""

    def test_create_service(self, api_client) -> None:
        """POST /api/services creates a service and returns 201."""
        response = api_client.post("/api/v1/services", json=SERVICE_PAYLOAD)

        assert response.status_code == 201
        body = response.json()
        assert body["title"] == "Oil Painting for Beginners"
        assert body["description"] == "Learn the basics of oil painting"
        assert body["specialty"] == "oil"
        assert body["min_age"] == 12
        assert body["max_age"] == 99
        assert body["duration"] == 90
        assert "id" in body
        assert "created_at" in body
        assert "updated_at" in body
        assert body["is_active"] is True
        assert body["tariffs"] == []
        assert body["tags"] == []
        assert body["material_hint"] == "Масляные краски, холст на подрамнике 40×50 см"

    def test_create_service_without_material_hint(self, api_client) -> None:
        """POST /api/services omitting material_hint defaults to None."""
        payload = {k: v for k, v in SERVICE_PAYLOAD.items() if k != "material_hint"}
        response = api_client.post("/api/v1/services", json=payload)

        assert response.status_code == 201
        assert response.json()["material_hint"] is None

    def test_create_service_with_tariffs_and_tags(self, api_client) -> None:
        """POST /api/services creates service with nested tariffs and tag links."""
        tag_id = _create_tag(api_client)

        payload = {
            **SERVICE_PAYLOAD,
            "tariffs": [TARIFF_PAYLOAD],
            "tag_ids": [tag_id],
        }
        response = api_client.post("/api/v1/services", json=payload)

        assert response.status_code == 201
        body = response.json()
        assert len(body["tariffs"]) == 1
        assert body["tariffs"][0]["title"] == "Standard"
        assert body["tariffs"][0]["price"] == 1500
        assert len(body["tags"]) == 1
        assert body["tags"][0]["tag"] == "beginner"

    def test_list_services_includes_created(self, api_client) -> None:
        """GET /api/services returns a list containing the created service."""
        create_resp = api_client.post("/api/v1/services", json=SERVICE_PAYLOAD)
        service_id = create_resp.json()["id"]

        response = api_client.get("/api/v1/services")
        assert response.status_code == 200
        services = response.json()
        assert isinstance(services, list)
        ids = [s["id"] for s in services]
        assert service_id in ids

    def test_get_service_by_id(self, api_client) -> None:
        """GET /api/services/{id} returns the specific service with tariffs and tags."""
        tag_id = _create_tag(api_client)
        payload = {
            **SERVICE_PAYLOAD,
            "tariffs": [TARIFF_PAYLOAD],
            "tag_ids": [tag_id],
        }
        create_resp = api_client.post("/api/v1/services", json=payload)
        service_id = create_resp.json()["id"]

        response = api_client.get(f"/api/v1/services/{service_id}")
        assert response.status_code == 200
        body = response.json()
        assert body["id"] == service_id
        assert body["title"] == "Oil Painting for Beginners"
        assert len(body["tariffs"]) == 1
        assert len(body["tags"]) == 1

    def test_update_service(self, api_client) -> None:
        """PUT /api/services/{id} updates all fields, replaces tariffs and tags."""
        tag_id = _create_tag(api_client)
        payload = {
            **SERVICE_PAYLOAD,
            "tariffs": [TARIFF_PAYLOAD],
            "tag_ids": [tag_id],
        }
        create_resp = api_client.post("/api/v1/services", json=payload)
        service_id = create_resp.json()["id"]

        # Create a second tag
        tag2_resp = api_client.post("/api/v1/tags", json={"tag": "advanced"})
        tag2_id = tag2_resp.json()["id"]

        update_data = {
            "title": "Advanced Oil Painting",
            "description": "Master oil painting techniques",
            "image_url": "https://example.com/advanced-oil.jpg",
            "specialty": "oil",
            "min_age": 18,
            "max_age": 99,
            "duration": 120,
            "record_info": "Advanced students only",
            "tariffs": [
                {"title": "Premium", "description": "Premium tariff", "price": 2500}
            ],
            "tag_ids": [tag2_id],
        }
        response = api_client.put(f"/api/v1/services/{service_id}", json=update_data)
        assert response.status_code == 200
        body = response.json()
        assert body["title"] == "Advanced Oil Painting"
        assert body["min_age"] == 18
        assert body["duration"] == 120
        assert len(body["tariffs"]) == 1
        assert body["tariffs"][0]["title"] == "Premium"
        assert body["tariffs"][0]["price"] == 2500
        assert len(body["tags"]) == 1
        assert body["tags"][0]["tag"] == "advanced"

    def test_delete_service_soft_deletes(self, api_client) -> None:
        """DELETE /api/services/{id} soft-deletes and list excludes it."""
        create_resp = api_client.post("/api/v1/services", json=SERVICE_PAYLOAD)
        service_id = create_resp.json()["id"]

        # Delete
        response = api_client.delete(f"/api/v1/services/{service_id}")
        assert response.status_code == 204

        # GET by id should still return it (soft delete)
        response = api_client.get(f"/api/v1/services/{service_id}")
        assert response.status_code == 200
        assert response.json()["is_active"] is False

        # List should NOT include the deleted service
        response = api_client.get("/api/v1/services")
        services = response.json()
        ids = [s["id"] for s in services]
        assert service_id not in ids

    def test_get_nonexistent_service_returns_404(self, api_client) -> None:
        """GET /api/services/{fake_id} returns 404."""
        response = api_client.get("/api/v1/services/nonexistent-id")
        assert response.status_code == 404

    def test_update_nonexistent_service_returns_404(self, api_client) -> None:
        """PUT /api/services/{fake_id} returns 404."""
        response = api_client.put(
            "/api/v1/services/nonexistent-id",
            json=SERVICE_PAYLOAD,
        )
        assert response.status_code == 404

    def test_delete_nonexistent_service_returns_404(self, api_client) -> None:
        """DELETE /api/services/{fake_id} returns 404."""
        response = api_client.delete("/api/v1/services/nonexistent-id")
        assert response.status_code == 404


class TestServiceMaxAgeNullable:
    """Test that max_age is nullable — null means 'no upper age limit'."""

    def test_create_service_without_max_age(self, api_client) -> None:
        """POST /api/services without max_age returns max_age as null."""
        payload = {k: v for k, v in SERVICE_PAYLOAD.items() if k != "max_age"}
        response = api_client.post("/api/v1/services", json=payload)

        assert response.status_code == 201
        body = response.json()
        assert body["max_age"] is None
        assert body["min_age"] == 12

    def test_create_service_with_max_age(self, api_client) -> None:
        """POST /api/services with max_age=12 returns max_age as 12."""
        payload = {**SERVICE_PAYLOAD, "max_age": 12}
        response = api_client.post("/api/v1/services", json=payload)

        assert response.status_code == 201
        body = response.json()
        assert body["max_age"] == 12

    def test_update_service_set_max_age_to_null(self, api_client) -> None:
        """PUT /api/services/{id} can set max_age to null."""
        # Create with max_age
        payload = {**SERVICE_PAYLOAD, "max_age": 12}
        create_resp = api_client.post("/api/v1/services", json=payload)
        service_id = create_resp.json()["id"]
        assert create_resp.json()["max_age"] == 12

        # Update to null
        update_data = {**SERVICE_PAYLOAD, "max_age": None}
        response = api_client.put(f"/api/v1/services/{service_id}", json=update_data)
        assert response.status_code == 200
        assert response.json()["max_age"] is None

    def test_create_service_null_max_age_serializes_correctly(self, api_client) -> None:
        """GET /api/services/{id} returns null max_age in JSON."""
        payload = {k: v for k, v in SERVICE_PAYLOAD.items() if k != "max_age"}
        create_resp = api_client.post("/api/v1/services", json=payload)
        service_id = create_resp.json()["id"]

        response = api_client.get(f"/api/v1/services/{service_id}")
        assert response.status_code == 200
        body = response.json()
        assert body["max_age"] is None
        # min_age still present
        assert body["min_age"] == 12


class TestServicePatch:
    """Tests for PATCH /api/v1/services/{id}."""

    def test_patch_service_not_found_404(self, api_client) -> None:
        """PATCH nonexistent service returns 404."""
        response = api_client.patch("/api/v1/services/nonexistent-id", json={"duration": 120})
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "SERVICE_NOT_FOUND"

    def test_patch_service_tag_ids_replaces(self, api_client) -> None:
        """PATCH with tag_ids replaces all tag links."""
        tag1 = api_client.post("/api/v1/tags", json={"tag": "tag1"}).json()
        tag2 = api_client.post("/api/v1/tags", json={"tag": "tag2"}).json()
        tag3 = api_client.post("/api/v1/tags", json={"tag": "tag3"}).json()

        create = api_client.post("/api/v1/services", json={
            "title": "Service", "description": "desc",
            "image_url": "https://example.com/test.jpg",
            "specialty": "живопись", "min_age": 6, "max_age": 99,
            "duration": 90, "record_info": "info",
            "tag_ids": [tag1["id"], tag2["id"]],
        })
        service_id = create.json()["id"]
        assert len(create.json()["tags"]) == 2

        response = api_client.patch(f"/api/v1/services/{service_id}", json={
            "tag_ids": [tag3["id"]],
        })
        assert response.status_code == 200
        tags = response.json()["tags"]
        assert len(tags) == 1
        assert tags[0]["tag"] == "tag3"

    def test_patch_service_without_tag_ids_preserves(self, api_client) -> None:
        """PATCH without tag_ids preserves existing tag links."""
        tag1 = api_client.post("/api/v1/tags", json={"tag": "preserve"}).json()

        create = api_client.post("/api/v1/services", json={
            "title": "Service", "description": "desc",
            "image_url": "https://example.com/test.jpg",
            "specialty": "живопись", "min_age": 6, "max_age": 99,
            "duration": 90, "record_info": "info",
            "tag_ids": [tag1["id"]],
        })
        service_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/services/{service_id}", json={"duration": 60})
        assert response.status_code == 200
        tags = response.json()["tags"]
        assert len(tags) == 1
        assert tags[0]["tag"] == "preserve"

    def test_patch_service_tag_ids_empty_clears(self, api_client) -> None:
        """PATCH with empty tag_ids clears all tag links."""
        tag1 = api_client.post("/api/v1/tags", json={"tag": "remove"}).json()

        create = api_client.post("/api/v1/services", json={
            "title": "Service", "description": "desc",
            "image_url": "https://example.com/test.jpg",
            "specialty": "живопись", "min_age": 6, "max_age": 99,
            "duration": 90, "record_info": "info",
            "tag_ids": [tag1["id"]],
        })
        service_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/services/{service_id}", json={"tag_ids": []})
        assert response.status_code == 200
        assert response.json()["tags"] == []

    def test_patch_service_max_age_to_null(self, api_client) -> None:
        """PATCH {"max_age": null} sets max_age to null (nullable field)."""
        create = api_client.post("/api/v1/services", json={
            **SERVICE_PAYLOAD, "max_age": 50,
        })
        service_id = create.json()["id"]
        assert create.json()["max_age"] == 50

        response = api_client.patch(
            f"/api/v1/services/{service_id}",
            json={"max_age": None},
        )
        assert response.status_code == 200
        assert response.json()["max_age"] is None

    def test_patch_service_empty_body_noop(self, api_client) -> None:
        """PATCH {} leaves all fields unchanged."""
        create = api_client.post("/api/v1/services", json=SERVICE_PAYLOAD)
        service_id = create.json()["id"]
        original = create.json()

        response = api_client.patch(f"/api/v1/services/{service_id}", json={})
        assert response.status_code == 200
        patched = response.json()

        assert patched["title"] == original["title"]
        assert patched["description"] == original["description"]
        assert patched["max_age"] == original["max_age"]
        assert patched["duration"] == original["duration"]
        assert patched["min_age"] == original["min_age"]

    def test_patch_service_null_title_stripped(self, api_client) -> None:
        """PATCH {"title": null} leaves title unchanged (NOT NULL field, null silently stripped)."""
        create = api_client.post("/api/v1/services", json=SERVICE_PAYLOAD)
        service_id = create.json()["id"]
        original_title = create.json()["title"]

        response = api_client.patch(
            f"/api/v1/services/{service_id}",
            json={"title": None},
        )
        assert response.status_code == 200
        assert response.json()["title"] == original_title
