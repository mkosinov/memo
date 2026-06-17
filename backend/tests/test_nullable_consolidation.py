"""Tests for nullable consolidation — ensuring Pydantic schemas align with SQLite NOT NULL constraints.

Task 4: Verify that:
1. Generic patch filters out null values for NOT NULL fields (Activity)
2. PhotoUpdate requires filename (NOT NULL in DB)
3. PhotoUpdate requires is_public to be non-null (NOT NULL in DB)
4. UserSettings update filters out null values for NOT NULL fields
"""

import pytest


class TestActivityPatchNotNullFiltering:
    """PATCH with null values for NOT NULL fields should silently ignore them."""

    def test_patch_capacity_null_ignored(self, api_client, create_activity):
        """Sending capacity=null in PATCH should NOT crash — null is filtered out."""
        activity = create_activity(capacity=10)
        resp = api_client.patch(
            f"/api/v1/activities/{activity['id']}",
            json={"capacity": None},
        )
        assert resp.status_code == 200
        # Capacity should remain unchanged (10), not become null
        assert resp.json()["capacity"] == 10

    def test_patch_master_id_null_ignored(self, api_client, create_activity):
        """Sending master_id=null in PATCH should NOT crash."""
        activity = create_activity()
        original_master_id = activity["master_id"]
        resp = api_client.patch(
            f"/api/v1/activities/{activity['id']}",
            json={"master_id": None},
        )
        assert resp.status_code == 200
        assert resp.json()["master_id"] == original_master_id

    def test_patch_service_id_null_ignored(self, api_client, create_activity):
        """Sending service_id=null in PATCH should NOT crash."""
        activity = create_activity()
        original_service_id = activity["service_id"]
        resp = api_client.patch(
            f"/api/v1/activities/{activity['id']}",
            json={"service_id": None},
        )
        assert resp.status_code == 200
        assert resp.json()["service_id"] == original_service_id

    def test_patch_location_id_null_ignored(self, api_client, create_activity):
        """Sending location_id=null in PATCH should NOT crash."""
        activity = create_activity()
        original_location_id = activity["location_id"]
        resp = api_client.patch(
            f"/api/v1/activities/{activity['id']}",
            json={"location_id": None},
        )
        assert resp.status_code == 200
        assert resp.json()["location_id"] == original_location_id

    def test_patch_start_null_ignored(self, api_client, create_activity):
        """Sending start=null in PATCH should NOT crash."""
        activity = create_activity()
        original_start = activity["start"]
        resp = api_client.patch(
            f"/api/v1/activities/{activity['id']}",
            json={"start": None},
        )
        assert resp.status_code == 200
        assert resp.json()["start"] == original_start

    def test_patch_duration_null_ignored(self, api_client, create_activity):
        """Sending duration=null in PATCH should NOT crash."""
        activity = create_activity()
        original_duration = activity["duration"]
        resp = api_client.patch(
            f"/api/v1/activities/{activity['id']}",
            json={"duration": None},
        )
        assert resp.status_code == 200
        assert resp.json()["duration"] == original_duration

    def test_patch_nullable_fields_still_work(self, api_client, create_activity):
        """Sending null for truly nullable fields (comment, record_info) should still work."""
        activity = create_activity()
        # First set comment
        api_client.patch(
            f"/api/v1/activities/{activity['id']}",
            json={"comment": "test"},
        )
        # Then clear it with null
        resp = api_client.patch(
            f"/api/v1/activities/{activity['id']}",
            json={"comment": None},
        )
        assert resp.status_code == 200
        assert resp.json()["comment"] is None

    def test_patch_valid_update_still_works(self, api_client, create_activity):
        """Normal PATCH updates should still work correctly."""
        activity = create_activity(capacity=10)
        resp = api_client.patch(
            f"/api/v1/activities/{activity['id']}",
            json={"capacity": 20},
        )
        assert resp.status_code == 200
        assert resp.json()["capacity"] == 20

    def test_patch_mixed_null_and_valid(self, api_client, create_activity):
        """PATCH with mix of null (NOT NULL field) and valid updates."""
        activity = create_activity(capacity=10)
        resp = api_client.patch(
            f"/api/v1/activities/{activity['id']}",
            json={"capacity": 20, "comment": "updated", "master_id": None},
        )
        assert resp.status_code == 200
        assert resp.json()["capacity"] == 20
        assert resp.json()["comment"] == "updated"
        # master_id should be unchanged (null was filtered)
        assert resp.json()["master_id"] == activity["master_id"]


class TestPhotoUpdateSchemaConstraints:
    """PhotoUpdate should enforce NOT NULL constraints from SQLite."""

    def test_photo_update_requires_filename(self, api_client):
        """PhotoUpdate without filename should fail (filename is NOT NULL in DB)."""
        # Create a photo first
        resp = api_client.post(
            "/api/v1/photos",
            json={"filename": "test.jpg", "is_public": False},
        )
        assert resp.status_code == 201
        photo_id = resp.json()["id"]

        # Update without filename — should fail validation
        resp = api_client.put(
            f"/api/v1/photos/{photo_id}",
            json={"is_public": True},
        )
        # Pydantic should reject because filename is required
        assert resp.status_code == 422

    def test_photo_update_filename_cannot_be_null(self, api_client):
        """PhotoUpdate with filename=null should fail validation."""
        resp = api_client.post(
            "/api/v1/photos",
            json={"filename": "test.jpg", "is_public": False},
        )
        assert resp.status_code == 201
        photo_id = resp.json()["id"]

        resp = api_client.put(
            f"/api/v1/photos/{photo_id}",
            json={"filename": None, "is_public": True},
        )
        # Pydantic should reject null filename
        assert resp.status_code == 422

    def test_photo_update_is_public_cannot_be_null(self, api_client):
        """PhotoUpdate with is_public=null should fail validation."""
        resp = api_client.post(
            "/api/v1/photos",
            json={"filename": "test.jpg", "is_public": False},
        )
        assert resp.status_code == 201
        photo_id = resp.json()["id"]

        resp = api_client.put(
            f"/api/v1/photos/{photo_id}",
            json={"filename": "test.jpg", "is_public": None},
        )
        # Pydantic should reject null is_public
        assert resp.status_code == 422

    def test_photo_update_valid(self, api_client):
        """Valid PhotoUpdate should work correctly."""
        resp = api_client.post(
            "/api/v1/photos",
            json={"filename": "test.jpg", "is_public": False},
        )
        assert resp.status_code == 201
        photo_id = resp.json()["id"]

        resp = api_client.put(
            f"/api/v1/photos/{photo_id}",
            json={"filename": "updated.jpg", "is_public": True},
        )
        assert resp.status_code == 200
        assert resp.json()["filename"] == "updated.jpg"
        assert resp.json()["is_public"] is True


class TestUserSettingsNotNullFiltering:
    """UserSettings update should filter nulls for NOT NULL fields."""

    def _create_settings(self, api_client, user_id):
        """Helper: create user settings for an existing user."""
        resp = api_client.post(
            "/api/v1/user-settings",
            json={"user_id": user_id},
        )
        assert resp.status_code == 201, f"create_settings failed: {resp.status_code}: {resp.text}"
        return resp.json()

    def test_update_theme_null_ignored(self, api_client, _user):
        """Sending theme=null should NOT crash — null is filtered out."""
        settings = self._create_settings(api_client, _user["id"])
        resp = api_client.put(
            f"/api/v1/user-settings?user_id={_user['id']}",
            json={"theme": None},
        )
        assert resp.status_code == 200
        # theme should remain "light" (default), not become null
        assert resp.json()["theme"] == "light"

    def test_update_language_null_ignored(self, api_client, _user):
        """Sending language=null should NOT crash — null is filtered out."""
        settings = self._create_settings(api_client, _user["id"])
        resp = api_client.put(
            f"/api/v1/user-settings?user_id={_user['id']}",
            json={"language": None},
        )
        assert resp.status_code == 200
        assert resp.json()["language"] == "ru"

    def test_update_valid_still_works(self, api_client, _user):
        """Normal updates should still work."""
        settings = self._create_settings(api_client, _user["id"])
        resp = api_client.put(
            f"/api/v1/user-settings?user_id={_user['id']}",
            json={"theme": "dark"},
        )
        assert resp.status_code == 200
        assert resp.json()["theme"] == "dark"

    def test_update_column_order_null_ignored(self, api_client, _user):
        """Sending column_order_masters=null should NOT crash."""
        settings = self._create_settings(api_client, _user["id"])
        resp = api_client.put(
            f"/api/v1/user-settings?user_id={_user['id']}",
            json={"column_order_masters": None},
        )
        assert resp.status_code == 200
        # Should remain the default []
        assert resp.json()["column_order_masters"] == []
