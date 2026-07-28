"""Tests for Task 2: PATCH /api/v1/services/{id} should accept tariffs field.

Semantically, "update only tariffs" is a valid PATCH operation.
These tests verify that PATCH can replace tariffs without changing other fields.
"""

import pytest

pytestmark = pytest.mark.api


class TestServicePatchTariffs:
    """PATCH /api/v1/services/{id} should accept tariffs field."""

    def test_patch_service_tariffs_only(self, api_client) -> None:
        """PATCH with tariffs replaces tariffs, other fields preserved."""
        create = api_client.post("/api/v1/services", json={
            "title": "Test Service", "description": "desc",
            "image_url": "https://example.com/test.jpg",
            "specialty": "живопись", "min_age": 6, "max_age": 99,
            "duration": 90, "record_info": "info",
            "tariffs": [{"title": "Old", "price": 1000}],
        })
        service_id = create.json()["id"]
        assert len(create.json()["tariffs"]) == 1
        assert create.json()["tariffs"][0]["title"] == "Old"

        # PATCH with new tariffs
        response = api_client.patch(f"/api/v1/services/{service_id}", json={
            "tariffs": [
                {"title": "New1", "price": 2000},
                {"title": "New2", "price": 3000},
            ],
        })
        assert response.status_code == 200, f"PATCH failed: {response.text}"
        body = response.json()
        assert body["title"] == "Test Service"  # unchanged
        assert len(body["tariffs"]) == 2
        assert body["tariffs"][0]["title"] == "New1"
        assert body["tariffs"][1]["title"] == "New2"

    def test_patch_service_tariffs_empty_clears(self, api_client) -> None:
        """PATCH with empty tariffs list clears all tariffs."""
        create = api_client.post("/api/v1/services", json={
            "title": "Test Service", "description": "desc",
            "image_url": "https://example.com/test.jpg",
            "specialty": "живопись", "min_age": 6, "max_age": 99,
            "duration": 90, "record_info": "info",
            "tariffs": [{"title": "Old", "price": 1000}],
        })
        service_id = create.json()["id"]
        assert len(create.json()["tariffs"]) == 1

        response = api_client.patch(f"/api/v1/services/{service_id}", json={
            "tariffs": [],
        })
        assert response.status_code == 200
        assert response.json()["tariffs"] == []

    def test_patch_service_without_tariffs_preserves(self, api_client) -> None:
        """PATCH without tariffs field preserves existing tariffs."""
        create = api_client.post("/api/v1/services", json={
            "title": "Test Service", "description": "desc",
            "image_url": "https://example.com/test.jpg",
            "specialty": "живопись", "min_age": 6, "max_age": 99,
            "duration": 90, "record_info": "info",
            "tariffs": [{"title": "Keep", "price": 1500}],
        })
        service_id = create.json()["id"]

        # PATCH duration only, tariffs should be preserved
        response = api_client.patch(f"/api/v1/services/{service_id}", json={
            "duration": 120,
        })
        assert response.status_code == 200
        body = response.json()
        assert body["duration"] == 120
        assert len(body["tariffs"]) == 1
        assert body["tariffs"][0]["title"] == "Keep"
