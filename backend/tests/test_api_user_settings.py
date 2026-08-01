"""Tests for UserSettings API endpoints."""

import pytest

pytestmark = pytest.mark.api


class TestGetUserSettings:
    """GET /api/v1/user-settings"""

    def test_get_returns_404_when_no_settings(self, api_client, _user) -> None:
        resp = api_client.get(f"/api/v1/user-settings?user_id={_user['id']}")
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.text}"

    def test_get_returns_settings_by_user_id(self, api_client, _user) -> None:
        # Create settings first
        create_resp = api_client.post("/api/v1/user-settings", json={
            "user_id": _user["id"],
            "theme": "dark",
            "language": "en",
            "column_order_masters": ["first_name", "color"],
            "column_order_locations": ["name"],
        })
        assert create_resp.status_code == 201, f"Create failed: {create_resp.text}"

        # Get
        resp = api_client.get(f"/api/v1/user-settings?user_id={_user['id']}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["user_id"] == _user["id"]
        assert body["theme"] == "dark"
        assert body["language"] == "en"
        assert body["column_order_masters"] == ["first_name", "color"]
        assert body["column_order_locations"] == ["name"]
        assert "id" in body
        assert "created_at" in body
        assert "updated_at" in body

    def test_get_returns_404_for_inactive_settings(self, api_client, _user) -> None:
        # Create then soft-delete
        create_resp = api_client.post("/api/v1/user-settings", json={
            "user_id": _user["id"],
            "theme": "light",
        })
        assert create_resp.status_code == 201
        settings_id = create_resp.json()["id"]

        api_client.delete(f"/api/v1/user-settings/{settings_id}")

        # Get should return 404
        resp = api_client.get(f"/api/v1/user-settings?user_id={_user['id']}")
        assert resp.status_code == 404

    def test_get_requires_user_id_param(self, api_client) -> None:
        resp = api_client.get("/api/v1/user-settings")
        assert resp.status_code == 422


class TestCreateUserSettings:
    """POST /api/v1/user-settings"""

    def test_create_with_defaults(self, api_client, _user) -> None:
        resp = api_client.post("/api/v1/user-settings", json={
            "user_id": _user["id"],
        })
        assert resp.status_code == 201, f"Create failed: {resp.text}"
        body = resp.json()
        assert body["user_id"] == _user["id"]
        assert body["theme"] == "light"
        assert body["language"] == "ru"
        assert body["column_order_masters"] == []
        assert body["column_order_locations"] == []
        assert "id" in body
        assert "created_at" in body
        assert "updated_at" in body

    def test_create_with_all_fields(self, api_client, _user) -> None:
        resp = api_client.post("/api/v1/user-settings", json={
            "user_id": _user["id"],
            "theme": "dark",
            "language": "en",
            "column_order_masters": ["color", "position"],
            "column_order_locations": ["name", "capacity"],
        })
        assert resp.status_code == 201, f"Create failed: {resp.text}"
        body = resp.json()
        assert body["theme"] == "dark"
        assert body["language"] == "en"
        assert body["column_order_masters"] == ["color", "position"]
        assert body["column_order_locations"] == ["name", "capacity"]

    def test_create_requires_user_id(self, api_client) -> None:
        resp = api_client.post("/api/v1/user-settings", json={
            "theme": "dark",
        })
        assert resp.status_code == 422

    def test_create_duplicate_user_id_returns_422(self, api_client, _user) -> None:
        api_client.post("/api/v1/user-settings", json={"user_id": _user["id"]})
        resp = api_client.post("/api/v1/user-settings", json={"user_id": _user["id"]})
        # IntegrityError is caught by the global handler → 422
        assert resp.status_code == 422


class TestUpdateUserSettings:
    """PUT /api/v1/user-settings"""

    def test_update_returns_404_when_no_settings(self, api_client, _user) -> None:
        resp = api_client.put(
            f"/api/v1/user-settings?user_id={_user['id']}",
            json={"theme": "dark"},
        )
        assert resp.status_code == 404

    def test_update_theme(self, api_client, _user) -> None:
        api_client.post("/api/v1/user-settings", json={"user_id": _user["id"]})

        resp = api_client.put(
            f"/api/v1/user-settings?user_id={_user['id']}",
            json={"theme": "dark"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["theme"] == "dark"
        assert body["language"] == "ru"  # unchanged

    def test_update_language(self, api_client, _user) -> None:
        api_client.post("/api/v1/user-settings", json={"user_id": _user["id"]})

        resp = api_client.put(
            f"/api/v1/user-settings?user_id={_user['id']}",
            json={"language": "en"},
        )
        assert resp.status_code == 200
        assert resp.json()["language"] == "en"

    def test_update_column_orders(self, api_client, _user) -> None:
        api_client.post("/api/v1/user-settings", json={"user_id": _user["id"]})

        resp = api_client.put(
            f"/api/v1/user-settings?user_id={_user['id']}",
            json={
                "column_order_masters": ["last_name", "first_name"],
                "column_order_locations": ["address"],
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["column_order_masters"] == ["last_name", "first_name"]
        assert body["column_order_locations"] == ["address"]

    def test_update_all_fields(self, api_client, _user) -> None:
        api_client.post("/api/v1/user-settings", json={"user_id": _user["id"]})

        resp = api_client.put(
            f"/api/v1/user-settings?user_id={_user['id']}",
            json={
                "theme": "dark",
                "language": "en",
                "column_order_masters": ["color"],
                "column_order_locations": ["name"],
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["theme"] == "dark"
        assert body["language"] == "en"
        assert body["column_order_masters"] == ["color"]
        assert body["column_order_locations"] == ["name"]

    def test_update_empty_body_noop(self, api_client, _user) -> None:
        api_client.post("/api/v1/user-settings", json={"user_id": _user["id"]})

        resp = api_client.put(
            f"/api/v1/user-settings?user_id={_user['id']}",
            json={},
        )
        assert resp.status_code == 200
        assert resp.json()["theme"] == "light"  # unchanged


class TestPatchSettings:
    """Tests for PATCH /api/v1/user-settings?user_id=..."""

    def test_patch_theme_only(self, api_client, _user) -> None:
        """PATCH updates only theme."""
        api_client.post("/api/v1/user-settings", json={
            "user_id": _user["id"], "theme": "light", "language": "ru",
        })

        response = api_client.patch(
            f"/api/v1/user-settings?user_id={_user['id']}",
            json={"theme": "dark"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["theme"] == "dark"
        assert body["language"] == "ru"  # unchanged

    def test_patch_language_only(self, api_client, _user) -> None:
        """PATCH updates only language."""
        api_client.post("/api/v1/user-settings", json={
            "user_id": _user["id"], "theme": "light", "language": "ru",
        })

        response = api_client.patch(
            f"/api/v1/user-settings?user_id={_user['id']}",
            json={"language": "en"},
        )
        assert response.status_code == 200
        assert response.json()["language"] == "en"
        assert response.json()["theme"] == "light"  # unchanged

    def test_patch_not_found_404(self, api_client, _user) -> None:
        """PATCH for nonexistent user settings returns 404."""
        response = api_client.patch(
            f"/api/v1/user-settings?user_id={_user['id']}",
            json={"theme": "dark"},
        )
        assert response.status_code == 404

    def test_patch_empty_body_noop(self, api_client, _user) -> None:
        """PATCH with empty body makes no changes."""
        api_client.post("/api/v1/user-settings", json={
            "user_id": _user["id"], "theme": "light", "language": "ru",
        })

        response = api_client.patch(
            f"/api/v1/user-settings?user_id={_user['id']}",
            json={},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["theme"] == "light"
        assert body["language"] == "ru"


class TestDeleteUserSettings:
    """DELETE /api/v1/user-settings/{id}"""

    def test_delete_returns_204(self, api_client, _user) -> None:
        create_resp = api_client.post("/api/v1/user-settings", json={"user_id": _user["id"]})
        settings_id = create_resp.json()["id"]

        resp = api_client.delete(f"/api/v1/user-settings/{settings_id}")
        assert resp.status_code == 204

    def test_delete_removes_row(self, api_client, _user) -> None:
        create_resp = api_client.post("/api/v1/user-settings", json={"user_id": _user["id"]})
        settings_id = create_resp.json()["id"]

        api_client.delete(f"/api/v1/user-settings/{settings_id}")

        # Hard-delete: row is physically removed from the database
        from tests.conftest import query_db
        rows = query_db(f"SELECT id FROM user_settings WHERE id='{settings_id}'")
        assert rows == []

    def test_delete_returns_404_for_nonexistent(self, api_client) -> None:
        resp = api_client.delete("/api/v1/user-settings/nonexistent-id")
        assert resp.status_code == 404
