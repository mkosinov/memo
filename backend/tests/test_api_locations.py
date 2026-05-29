"""Tests for the Locations CRUD API endpoints."""

from fastapi.testclient import TestClient

LOCATION_PAYLOAD = {
    "name": "Test Studio",
    "address": "123 Art Street",
    "description": "A cozy studio for painting",
    "capacity": 10,
    "yandex_map_url": "https://yandex.ru/maps/test",
    "review_url": "https://example.com/review",
    "record_info": "Call +7-999-123-45-67",
    "image_url": "https://example.com/studio.jpg",
}


class TestLocationsCrud:
    """Full CRUD round-trip for /api/locations."""

    def test_create_location(self) -> None:
        """POST /api/locations creates a location and returns 201."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.post("/api/v1/locations", json=LOCATION_PAYLOAD)

        assert response.status_code == 201
        body = response.json()
        assert body["name"] == "Test Studio"
        assert body["address"] == "123 Art Street"
        assert body["capacity"] == 10
        assert "id" in body
        assert "created_at" in body
        assert "updated_at" in body
        assert body["is_active"] is True

    def test_list_locations_includes_created(self) -> None:
        """GET /api/locations returns a list containing the created location."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            create_resp = client.post("/api/v1/locations", json=LOCATION_PAYLOAD)
            location_id = create_resp.json()["id"]

            response = client.get("/api/v1/locations")
            assert response.status_code == 200
            locations = response.json()
            assert isinstance(locations, list)
            ids = [loc["id"] for loc in locations]
            assert location_id in ids

    def test_get_location_by_id(self) -> None:
        """GET /api/locations/{id} returns the specific location."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            create_resp = client.post("/api/v1/locations", json=LOCATION_PAYLOAD)
            location_id = create_resp.json()["id"]

            response = client.get(f"/api/v1/locations/{location_id}")
            assert response.status_code == 200
            body = response.json()
            assert body["id"] == location_id
            assert body["name"] == "Test Studio"

    def test_update_location(self) -> None:
        """PUT /api/locations/{id} updates all fields."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            create_resp = client.post("/api/v1/locations", json=LOCATION_PAYLOAD)
            location_id = create_resp.json()["id"]

            update_data = {
                "name": "Updated Studio",
                "address": "456 New Avenue",
                "description": "A bigger studio",
                "capacity": 20,
                "yandex_map_url": "https://yandex.ru/maps/updated",
                "review_url": "https://example.com/new-review",
                "record_info": "Call +7-999-987-65-43",
                "image_url": "https://example.com/new-studio.jpg",
            }
            response = client.put(f"/api/v1/locations/{location_id}", json=update_data)
            assert response.status_code == 200
            body = response.json()
            assert body["name"] == "Updated Studio"
            assert body["address"] == "456 New Avenue"
            assert body["capacity"] == 20

    def test_delete_location_soft_deletes(self) -> None:
        """DELETE /api/locations/{id} soft-deletes and list excludes it."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            create_resp = client.post("/api/v1/locations", json=LOCATION_PAYLOAD)
            location_id = create_resp.json()["id"]

            # Delete
            response = client.delete(f"/api/v1/locations/{location_id}")
            assert response.status_code == 204

            # GET by id should still return it (soft delete, not hard)
            response = client.get(f"/api/v1/locations/{location_id}")
            assert response.status_code == 200
            assert response.json()["is_active"] is False

            # List should NOT include the deleted location
            response = client.get("/api/v1/locations")
            locations = response.json()
            ids = [loc["id"] for loc in locations]
            assert location_id not in ids

    def test_get_nonexistent_location_returns_404(self) -> None:
        """GET /api/locations/{fake_id} returns 404."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.get("/api/v1/locations/nonexistent-id")
        assert response.status_code == 404

    def test_update_nonexistent_location_returns_404(self) -> None:
        """PUT /api/locations/{fake_id} returns 404."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.put(
                "/api/v1/locations/nonexistent-id",
                json=LOCATION_PAYLOAD,
            )
        assert response.status_code == 404

    def test_delete_nonexistent_location_returns_404(self) -> None:
        """DELETE /api/locations/{fake_id} returns 404."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.delete("/api/v1/locations/nonexistent-id")
        assert response.status_code == 404
