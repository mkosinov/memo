"""Tests for the Locations CRUD API endpoints."""

import pytest

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
    """Full CRUD round-trip for /api/locations."""

    def test_create_location(self, api_client) -> None:
        """POST /api/locations creates a location and returns 201."""
        response = api_client.post("/api/v1/locations", json=LOCATION_PAYLOAD)

        assert response.status_code == 201
        body = response.json()
        assert body["name"] == "Test Studio"
        assert body["address"] == "123 Art Street"
        assert body["capacity"] == 10
        assert "id" in body
        assert "created_at" in body
        assert "updated_at" in body
        assert body["is_active"] is True
        assert body["location_hint"] == "1 этаж, светлая студия с панорамными окнами"

    def test_create_location_without_location_hint(self, api_client) -> None:
        """POST /api/locations omitting location_hint defaults to None."""
        payload = {k: v for k, v in LOCATION_PAYLOAD.items() if k != "location_hint"}
        response = api_client.post("/api/v1/locations", json=payload)

        assert response.status_code == 201
        assert response.json()["location_hint"] is None

    def test_list_locations_includes_created(self, api_client) -> None:
        """GET /api/locations returns a list containing the created location."""
        create_resp = api_client.post("/api/v1/locations", json=LOCATION_PAYLOAD)
        location_id = create_resp.json()["id"]

        response = api_client.get("/api/v1/locations")
        assert response.status_code == 200
        body = response.json()
        locations = body["items"]
        assert body["total"] >= 1
        ids = [loc["id"] for loc in locations]
        assert location_id in ids

    def test_get_location_by_id(self, api_client) -> None:
        """GET /api/locations/{id} returns the specific location."""
        create_resp = api_client.post("/api/v1/locations", json=LOCATION_PAYLOAD)
        location_id = create_resp.json()["id"]

        response = api_client.get(f"/api/v1/locations/{location_id}")
        assert response.status_code == 200
        body = response.json()
        assert body["id"] == location_id
        assert body["name"] == "Test Studio"

    def test_update_location(self, api_client) -> None:
        """PUT /api/locations/{id} updates all fields."""
        create_resp = api_client.post("/api/v1/locations", json=LOCATION_PAYLOAD)
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
        response = api_client.put(f"/api/v1/locations/{location_id}", json=update_data)
        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "Updated Studio"
        assert body["address"] == "456 New Avenue"
        assert body["capacity"] == 20

    def test_delete_location_soft_deletes(self, api_client) -> None:
        """DELETE /api/locations/{id} soft-deletes and list excludes it."""
        create_resp = api_client.post("/api/v1/locations", json=LOCATION_PAYLOAD)
        location_id = create_resp.json()["id"]

        # Delete
        response = api_client.delete(f"/api/v1/locations/{location_id}")
        assert response.status_code == 204

        # GET by id should still return it (soft delete, not hard)
        response = api_client.get(f"/api/v1/locations/{location_id}")
        assert response.status_code == 200
        assert response.json()["is_active"] is False

        # List should NOT include the deleted location
        response = api_client.get("/api/v1/locations")
        body = response.json()
        ids = [loc["id"] for loc in body["items"]]
        assert location_id not in ids

    def test_get_nonexistent_location_returns_404(self, api_client) -> None:
        """GET /api/locations/{fake_id} returns 404."""
        response = api_client.get("/api/v1/locations/nonexistent-id")
        assert response.status_code == 404

    def test_update_nonexistent_location_returns_404(self, api_client) -> None:
        """PUT /api/locations/{fake_id} returns 404."""
        response = api_client.put(
            "/api/v1/locations/nonexistent-id",
            json=LOCATION_PAYLOAD,
        )
        assert response.status_code == 404

    def test_delete_nonexistent_location_returns_404(self, api_client) -> None:
        """DELETE /api/locations/{fake_id} returns 404."""
        response = api_client.delete("/api/v1/locations/nonexistent-id")
        assert response.status_code == 404


class TestLocationPatch:
    """Tests for PATCH /api/v1/locations/{id}."""

    def test_patch_location_not_found_404(self, api_client) -> None:
        """PATCH nonexistent location returns 404."""
        response = api_client.patch("/api/v1/locations/nonexistent-id", json={"capacity": 10})
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "LOCATION_NOT_FOUND"
