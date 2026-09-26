"""Tests for Task 3: UserSettings PATCH should use its own schema.

PATCH = partial update, so it should accept all-optional schema.
This test verifies PATCH works with partial data (semantic correctness).

GH #247 T8 (spec §3.8): PATCH is own-only — no ``user_id`` query param;
the api_client's session user is the addressed user.
"""

import pytest

from tests.conftest import delete_settings_row

pytestmark = pytest.mark.api


@pytest.fixture
def me(api_client) -> str:
    """The api_client session user's id."""
    resp = api_client.get("/api/v1/auth/me")
    assert resp.status_code == 200, resp.text
    return resp.json()["user"]["id"]


class TestUserSettingsPatchArchivedVisibility:
    """PATCH /api/v1/user-settings with the GH #267 visibility toggles."""

    def test_patch_show_archived_masters_false(self, api_client, me) -> None:
        """PATCH show_archived_masters=false flips it; other fields unchanged."""
        delete_settings_row(me)  # §5.5 anomaly pattern
        api_client.post("/api/v1/user-settings", json={"user_id": me})

        response = api_client.patch(
            "/api/v1/user-settings", json={"show_archived_masters": False}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["show_archived_masters"] is False
        assert body["show_archived_locations"] is False  # unchanged

    def test_patch_show_archived_locations_true(self, api_client, me) -> None:
        """PATCH show_archived_locations=true flips it; other fields unchanged."""
        delete_settings_row(me)
        api_client.post("/api/v1/user-settings", json={"user_id": me})

        response = api_client.patch(
            "/api/v1/user-settings", json={"show_archived_locations": True}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["show_archived_locations"] is True
        assert body["show_archived_masters"] is True  # unchanged

    def test_patch_without_toggles_noop(self, api_client, me) -> None:
        """PATCH without the toggle fields leaves both defaults intact."""
        delete_settings_row(me)
        api_client.post("/api/v1/user-settings", json={"user_id": me})

        response = api_client.patch("/api/v1/user-settings", json={"theme": "dark"})
        assert response.status_code == 200
        body = response.json()
        assert body["show_archived_masters"] is True
        assert body["show_archived_locations"] is False
