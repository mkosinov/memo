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


class TestTariffIdOnUpdateVerbs:
    """GH #357 Task 1: ``TariffUpdate.id`` — parsed by the schema, not yet
    consumed by the service layer (the id-keyed diff is Task 2).

    Until the diff lands, both update verbs keep hard-replace semantics:
    every row is re-inserted with a fresh uuid and a sent ``id`` is
    ignored. These tests pin the interim contract so Task 2 flips it
    deliberately. Duplicate ids in one list are already a 422 (schema
    level — both verbs).
    """

    def _create_service_with_tariff(self, api_client) -> tuple[str, str]:
        create = api_client.post("/api/v1/services", json={
            "title": "Test Service", "description": "desc",
            "image_url": "https://example.com/test.jpg",
            "specialty": "живопись", "min_age": 6, "max_age": 99,
            "duration": 90, "record_info": "info",
            "tariffs": [{"title": "Old", "price": 1000}],
        })
        assert create.status_code == 201, f"Create failed: {create.text}"
        body = create.json()
        return body["id"], body["tariffs"][0]["id"]

    def test_patch_ignores_tariff_id_until_diff_lands(self, api_client) -> None:
        service_id, old_tariff_id = self._create_service_with_tariff(api_client)

        response = api_client.patch(f"/api/v1/services/{service_id}", json={
            "tariffs": [{"id": old_tariff_id, "title": "New", "price": 2000}],
        })
        assert response.status_code == 200, f"PATCH failed: {response.text}"
        [tariff] = response.json()["tariffs"]
        assert tariff["title"] == "New"
        assert tariff["price"] == 2000
        # Hard-replace continues: the row is re-inserted with a fresh uuid —
        # the sent id is not consumed until the #357 diff (Task 2) lands.
        assert tariff["id"] != old_tariff_id

    def test_put_ignores_tariff_id_until_diff_lands(self, api_client) -> None:
        service_id, old_tariff_id = self._create_service_with_tariff(api_client)

        response = api_client.put(f"/api/v1/services/{service_id}", json={
            "title": "Test Service", "description": "desc",
            "image_url": "https://example.com/test.jpg",
            "specialty": "живопись", "min_age": 6, "max_age": 99,
            "duration": 90, "record_info": "info",
            "tariffs": [{"id": old_tariff_id, "title": "New", "price": 2000}],
        })
        assert response.status_code == 200, f"PUT failed: {response.text}"
        [tariff] = response.json()["tariffs"]
        assert tariff["title"] == "New"
        assert tariff["id"] != old_tariff_id

    def test_patch_duplicate_tariff_id_is_422_with_row_index(
        self, api_client
    ) -> None:
        service_id, _ = self._create_service_with_tariff(api_client)

        response = api_client.patch(f"/api/v1/services/{service_id}", json={
            "tariffs": [
                {"id": "t-1", "title": "A", "price": 1000},
                {"id": "t-2", "title": "B", "price": 2000},
                {"id": "t-1", "title": "C", "price": 3000},
            ],
        })
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert detail["code"] == "VALIDATION_ERROR"
        assert "tariffs[2]" in detail["message"]
        assert "t-1" in detail["message"]

    def test_put_duplicate_tariff_id_is_422_with_row_index(
        self, api_client
    ) -> None:
        service_id, _ = self._create_service_with_tariff(api_client)

        response = api_client.put(f"/api/v1/services/{service_id}", json={
            "title": "Test Service", "description": "desc",
            "image_url": "https://example.com/test.jpg",
            "specialty": "живопись", "min_age": 6, "max_age": 99,
            "duration": 90, "record_info": "info",
            "tariffs": [
                {"id": "t-1", "title": "A", "price": 1000},
                {"id": "t-1", "title": "B", "price": 2000},
            ],
        })
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert detail["code"] == "VALIDATION_ERROR"
        assert "tariffs[1]" in detail["message"]
