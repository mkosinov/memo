"""Tests for Task 3: UserSettings PATCH should use its own schema.

PATCH = partial update, so it should accept all-optional schema.
This test verifies PATCH works with partial data (semantic correctness).
"""

import pytest

pytestmark = pytest.mark.api


class TestUserSettingsPatchSemantic:
    """PATCH /api/v1/user-settings should accept partial updates."""

    def test_patch_single_field(self, api_client, _user) -> None:
        """PATCH with only theme field works (partial update)."""
        api_client.post("/api/v1/user-settings", json={
            "user_id": _user["id"],
            "theme": "light",
            "language": "ru",
        })

        # PATCH only theme
        response = api_client.patch(
            f"/api/v1/user-settings?user_id={_user['id']}",
            json={"theme": "dark"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["theme"] == "dark"
        assert body["language"] == "ru"  # unchanged

    def test_patch_multiple_fields(self, api_client, _user) -> None:
        """PATCH with multiple fields works."""
        api_client.post("/api/v1/user-settings", json={
            "user_id": _user["id"],
            "theme": "light",
            "language": "ru",
        })

        response = api_client.patch(
            f"/api/v1/user-settings?user_id={_user['id']}",
            json={
                "theme": "dark",
                "language": "en",
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["theme"] == "dark"
        assert body["language"] == "en"

    def test_patch_empty_body(self, api_client, _user) -> None:
        """PATCH with empty body is valid (no-op)."""
        api_client.post("/api/v1/user-settings", json={
            "user_id": _user["id"],
            "theme": "light",
        })

        response = api_client.patch(
            f"/api/v1/user-settings?user_id={_user['id']}",
            json={},
        )
        assert response.status_code == 200
        assert response.json()["theme"] == "light"  # unchanged
