"""Tests for the Services CRUD API endpoints with nested Tariffs and Tags."""

import uuid

from fastapi.testclient import TestClient

SERVICE_PAYLOAD = {
    "title": "Oil Painting for Beginners",
    "description": "Learn the basics of oil painting",
    "image_url": "https://example.com/oil-painting.jpg",
    "specialty": "oil",
    "min_age": 12,
    "max_age": 99,
    "duration": 90,
    "record_info": "Bring your own apron",
}

TAG_PAYLOAD = {"tag": "beginner"}

TARIFF_PAYLOAD = {
    "title": "Standard",
    "description": "Standard tariff",
    "price": 1500,
}


def _create_tag(client: TestClient) -> str:
    """Create a tag via POST /api/tags and return its ID."""
    response = client.post("/api/v1/tags", json=TAG_PAYLOAD)
    assert response.status_code == 201
    return response.json()["id"]


class TestServicesCrud:
    """Full CRUD round-trip for /api/services."""

    def test_create_service(self) -> None:
        """POST /api/services creates a service and returns 201."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.post("/api/v1/services", json=SERVICE_PAYLOAD)

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

    def test_create_service_with_tariffs_and_tags(self) -> None:
        """POST /api/services creates service with nested tariffs and tag links."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            tag_id = _create_tag(client)

            payload = {
                **SERVICE_PAYLOAD,
                "tariffs": [TARIFF_PAYLOAD],
                "tag_ids": [tag_id],
            }
            response = client.post("/api/v1/services", json=payload)

        assert response.status_code == 201
        body = response.json()
        assert len(body["tariffs"]) == 1
        assert body["tariffs"][0]["title"] == "Standard"
        assert body["tariffs"][0]["price"] == 1500
        assert len(body["tags"]) == 1
        assert body["tags"][0]["tag"] == "beginner"

    def test_list_services_includes_created(self) -> None:
        """GET /api/services returns a list containing the created service."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            create_resp = client.post("/api/v1/services", json=SERVICE_PAYLOAD)
            service_id = create_resp.json()["id"]

            response = client.get("/api/v1/services")
            assert response.status_code == 200
            services = response.json()
            assert isinstance(services, list)
            ids = [s["id"] for s in services]
            assert service_id in ids

    def test_get_service_by_id(self) -> None:
        """GET /api/services/{id} returns the specific service with tariffs and tags."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            tag_id = _create_tag(client)
            payload = {
                **SERVICE_PAYLOAD,
                "tariffs": [TARIFF_PAYLOAD],
                "tag_ids": [tag_id],
            }
            create_resp = client.post("/api/v1/services", json=payload)
            service_id = create_resp.json()["id"]

            response = client.get(f"/api/v1/services/{service_id}")
            assert response.status_code == 200
            body = response.json()
            assert body["id"] == service_id
            assert body["title"] == "Oil Painting for Beginners"
            assert len(body["tariffs"]) == 1
            assert len(body["tags"]) == 1

    def test_update_service(self) -> None:
        """PUT /api/services/{id} updates all fields, replaces tariffs and tags."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            tag_id = _create_tag(client)
            payload = {
                **SERVICE_PAYLOAD,
                "tariffs": [TARIFF_PAYLOAD],
                "tag_ids": [tag_id],
            }
            create_resp = client.post("/api/v1/services", json=payload)
            service_id = create_resp.json()["id"]

            # Create a second tag
            tag2_resp = client.post("/api/v1/tags", json={"tag": "advanced"})
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
            response = client.put(f"/api/v1/services/{service_id}", json=update_data)
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

    def test_delete_service_soft_deletes(self) -> None:
        """DELETE /api/services/{id} soft-deletes and list excludes it."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            create_resp = client.post("/api/v1/services", json=SERVICE_PAYLOAD)
            service_id = create_resp.json()["id"]

            # Delete
            response = client.delete(f"/api/v1/services/{service_id}")
            assert response.status_code == 204

            # GET by id should still return it (soft delete)
            response = client.get(f"/api/v1/services/{service_id}")
            assert response.status_code == 200
            assert response.json()["is_active"] is False

            # List should NOT include the deleted service
            response = client.get("/api/v1/services")
            services = response.json()
            ids = [s["id"] for s in services]
            assert service_id not in ids

    def test_get_nonexistent_service_returns_404(self) -> None:
        """GET /api/services/{fake_id} returns 404."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.get("/api/v1/services/nonexistent-id")
        assert response.status_code == 404

    def test_update_nonexistent_service_returns_404(self) -> None:
        """PUT /api/services/{fake_id} returns 404."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.put(
                "/api/v1/services/nonexistent-id",
                json=SERVICE_PAYLOAD,
            )
        assert response.status_code == 404

    def test_delete_nonexistent_service_returns_404(self) -> None:
        """DELETE /api/services/{fake_id} returns 404."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.delete("/api/v1/services/nonexistent-id")
        assert response.status_code == 404
