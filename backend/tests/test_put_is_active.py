"""Tests for Task 1: PUT endpoints should accept and apply is_active field.

PUT = full replacement, so the Update schema must cover is_active.
These tests verify that PUT can deactivate an entity by setting is_active=False.
"""

import pytest

pytestmark = pytest.mark.api


class TestMasterPutIsActive:
    """PUT /api/v1/masters/{id} should accept is_active field."""

    def test_put_master_with_is_active_false(self, api_client) -> None:
        """PUT with is_active=False deactivates the master."""
        create = api_client.post("/api/v1/masters", json={
            "first_name": "Active", "last_name": "Master",
            "color": "#5B8C7A", "position": "мастер", "specialty": "живопись",
        })
        master_id = create.json()["id"]
        assert create.json()["is_active"] is True

        # PUT with is_active=False
        update_data = {
            "first_name": "Active", "last_name": "Master",
            "color": "#5B8C7A", "position": "мастер", "specialty": "живопись",
            "is_active": False,
        }
        response = api_client.put(f"/api/v1/masters/{master_id}", json=update_data)
        assert response.status_code == 200, f"PUT failed: {response.text}"
        assert response.json()["is_active"] is False

    def test_put_master_with_is_active_true(self, api_client) -> None:
        """PUT with is_active=True keeps the master active."""
        create = api_client.post("/api/v1/masters", json={
            "first_name": "Test", "last_name": "Master",
            "color": "#5B8C7A", "position": "мастер", "specialty": "живопись",
        })
        master_id = create.json()["id"]

        update_data = {
            "first_name": "Test", "last_name": "Master",
            "color": "#5B8C7A", "position": "мастер", "specialty": "живопись",
            "is_active": True,
        }
        response = api_client.put(f"/api/v1/masters/{master_id}", json=update_data)
        assert response.status_code == 200
        assert response.json()["is_active"] is True


class TestLocationPutIsActive:
    """PUT /api/v1/locations/{id} should accept is_active field."""

    def test_put_location_with_is_active_false(self, api_client) -> None:
        """PUT with is_active=False deactivates the location."""
        create = api_client.post("/api/v1/locations", json={
            "name": "Test Studio", "address": "Test Address", "capacity": 20,
        })
        location_id = create.json()["id"]
        assert create.json()["is_active"] is True

        update_data = {
            "name": "Test Studio", "address": "Test Address", "capacity": 20,
            "is_active": False,
        }
        response = api_client.put(f"/api/v1/locations/{location_id}", json=update_data)
        assert response.status_code == 200, f"PUT failed: {response.text}"
        assert response.json()["is_active"] is False


class TestMaterialPutIsActive:
    """PUT /api/v1/materials/{id} should accept is_active field."""

    def test_put_material_with_is_active_false(self, api_client) -> None:
        """PUT with is_active=False deactivates the material."""
        create = api_client.post("/api/v1/materials", json={
            "title": "Test Material", "description": "Test description",
        })
        material_id = create.json()["id"]
        assert create.json()["is_active"] is True

        update_data = {
            "title": "Test Material", "description": "Test description",
            "is_active": False,
        }
        response = api_client.put(f"/api/v1/materials/{material_id}", json=update_data)
        assert response.status_code == 200, f"PUT failed: {response.text}"
        assert response.json()["is_active"] is False


class TestServicePutIsActive:
    """PUT /api/v1/services/{id} should accept is_active field."""

    def test_put_service_with_is_active_false(self, api_client) -> None:
        """PUT with is_active=False deactivates the service."""
        create = api_client.post("/api/v1/services", json={
            "title": "Test Service", "description": "Test",
            "image_url": "https://example.com/test.jpg",
            "specialty": "живопись", "min_age": 6, "max_age": 99,
            "duration": 90, "record_info": "info",
        })
        service_id = create.json()["id"]
        assert create.json()["is_active"] is True

        update_data = {
            "title": "Test Service", "description": "Test",
            "image_url": "https://example.com/test.jpg",
            "specialty": "живопись", "min_age": 6, "max_age": 99,
            "duration": 90, "record_info": "info",
            "is_active": False,
        }
        response = api_client.put(f"/api/v1/services/{service_id}", json=update_data)
        assert response.status_code == 200, f"PUT failed: {response.text}"
        assert response.json()["is_active"] is False
