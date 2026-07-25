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
        locations = response.json()
        assert isinstance(locations, list)
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
        locations = response.json()
        ids = [loc["id"] for loc in locations]
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

    def test_patch_location_capacity_only(self, api_client) -> None:
        """PATCH updates only capacity, other fields preserved."""
        create = api_client.post("/api/v1/locations", json={
            "name": "Test Studio", "capacity": 20,
        })
        loc_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/locations/{loc_id}", json={"capacity": 30})
        assert response.status_code == 200
        body = response.json()
        assert body["capacity"] == 30
        assert body["name"] == "Test Studio"  # unchanged

    def test_patch_location_not_found_404(self, api_client) -> None:
        """PATCH nonexistent location returns 404."""
        response = api_client.patch("/api/v1/locations/nonexistent-id", json={"capacity": 10})
        assert response.status_code == 404

    def test_patch_location_empty_body(self, api_client) -> None:
        """PATCH with empty body makes no changes."""
        create = api_client.post("/api/v1/locations", json={
            "name": "Unchanged", "capacity": 15,
        })
        loc_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/locations/{loc_id}", json={})
        assert response.status_code == 200
        assert response.json()["name"] == "Unchanged"
        assert response.json()["capacity"] == 15

    def test_patch_location_null_name_stripped(self, api_client) -> None:
        """PATCH with null for NOT NULL name is stripped."""
        create = api_client.post("/api/v1/locations", json={
            "name": "KeepName", "capacity": 20,
        })
        loc_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/locations/{loc_id}", json={"name": None})
        assert response.status_code == 200
        assert response.json()["name"] == "KeepName"

    def test_patch_location_null_capacity_stripped(self, api_client) -> None:
        """PATCH with null for NOT NULL capacity is stripped."""
        create = api_client.post("/api/v1/locations", json={
            "name": "Studio", "capacity": 20,
        })
        loc_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/locations/{loc_id}", json={"capacity": None})
        assert response.status_code == 200
        assert response.json()["capacity"] == 20

    def test_patch_location_nullable_field_to_null(self, api_client) -> None:
        """PATCH can set nullable address to null."""
        create = api_client.post("/api/v1/locations", json={
            "name": "Studio", "capacity": 20, "address": "123 Main St",
        })
        loc_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/locations/{loc_id}", json={"address": None})
        assert response.status_code == 200
        assert response.json()["address"] is None

    def test_patch_location_multiple_fields(self, api_client) -> None:
        """PATCH updates multiple fields at once."""
        create = api_client.post("/api/v1/locations", json={
            "name": "Old", "capacity": 10, "address": "Old Addr",
        })
        loc_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/locations/{loc_id}", json={
            "name": "New Name", "capacity": 25,
        })
        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "New Name"
        assert body["capacity"] == 25
        assert body["address"] == "Old Addr"  # unchanged
