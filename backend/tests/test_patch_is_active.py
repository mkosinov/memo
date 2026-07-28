"""Regression tests: PATCH {entity} must persist is_active toggle.

Bug: the frontend archive toggles send PATCH with body {"is_active": false}
but the Patch schemas didn't declare is_active, so Pydantic's extra='ignore'
silently dropped it and GenericService.patch() wrote an empty dict to the DB.
"""


class TestPatchIsActive:
    """PATCH {"is_active": false} must flip the flag for all 4 entities."""

    def test_patch_master_is_active_false(self, api_client) -> None:
        create = api_client.post("/api/v1/masters", json={
            "first_name": "Active", "last_name": "Master",
            "color": "#5B8C7A", "position": "мастер", "specialty": "живопись",
        })
        assert create.status_code == 201, create.text
        master_id = create.json()["id"]
        assert create.json()["is_active"] is True

        response = api_client.patch(
            f"/api/v1/masters/{master_id}", json={"is_active": False}
        )
        assert response.status_code == 200, response.text
        assert response.json()["is_active"] is False

        # And a follow-up GET confirms persistence
        get = api_client.get(f"/api/v1/masters/{master_id}")
        assert get.status_code == 200
        assert get.json()["is_active"] is False

    def test_patch_location_is_active_false(self, api_client) -> None:
        create = api_client.post("/api/v1/locations", json={
            "name": "Active Studio", "capacity": 10,
        })
        assert create.status_code == 201, create.text
        loc_id = create.json()["id"]
        assert create.json()["is_active"] is True

        response = api_client.patch(
            f"/api/v1/locations/{loc_id}", json={"is_active": False}
        )
        assert response.status_code == 200, response.text
        assert response.json()["is_active"] is False

        get = api_client.get(f"/api/v1/locations/{loc_id}")
        assert get.status_code == 200
        assert get.json()["is_active"] is False

    def test_patch_material_is_active_false(self, api_client) -> None:
        create = api_client.post("/api/v1/materials", json={
            "title": "Active Material", "description": "desc",
        })
        assert create.status_code == 201, create.text
        material_id = create.json()["id"]
        assert create.json()["is_active"] is True

        response = api_client.patch(
            f"/api/v1/materials/{material_id}", json={"is_active": False}
        )
        assert response.status_code == 200, response.text
        assert response.json()["is_active"] is False

        get = api_client.get(f"/api/v1/materials/{material_id}")
        assert get.status_code == 200
        assert get.json()["is_active"] is False

    def test_patch_service_is_active_false(self, api_client) -> None:
        create = api_client.post("/api/v1/services", json={
            "title": "Active Service", "description": "desc",
            "image_url": "https://example.com/s.jpg",
            "specialty": "живопись", "min_age": 6, "max_age": 99,
            "duration": 90, "record_info": "info",
        })
        assert create.status_code == 201, create.text
        service_id = create.json()["id"]
        assert create.json()["is_active"] is True

        response = api_client.patch(
            f"/api/v1/services/{service_id}", json={"is_active": False}
        )
        assert response.status_code == 200, response.text
        assert response.json()["is_active"] is False

        get = api_client.get(f"/api/v1/services/{service_id}")
        assert get.status_code == 200
        assert get.json()["is_active"] is False

    def test_patch_master_is_active_true_restores(self, api_client) -> None:
        """Toggle off then on again — must round-trip."""
        create = api_client.post("/api/v1/masters", json={
            "first_name": "Toggle", "last_name": "Master",
            "color": "#5B8C7A", "position": "мастер", "specialty": "живопись",
        })
        master_id = create.json()["id"]

        api_client.patch(f"/api/v1/masters/{master_id}", json={"is_active": False})
        response = api_client.patch(
            f"/api/v1/masters/{master_id}", json={"is_active": True}
        )
        assert response.status_code == 200
        assert response.json()["is_active"] is True
