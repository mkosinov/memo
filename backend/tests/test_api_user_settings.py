"""Tests for UserSettings API endpoints.

GH #247 T8 (spec §3.8): GET/PUT/PATCH are own-only — no ``user_id``
query param; the api_client's session user is the addressed user.

GH #319: GET is get-or-create (missing row → 200 + defaults written to
the DB, ``Cache-Control: no-store``); POST takes the user from the
session — a ``user_id`` in the body is ignored.
"""

import pytest

from src.auth.passwords import hash_password
from src.errors import ErrorCode
from tests.conftest import insert_user

pytestmark = pytest.mark.api


OTHER_PHONE = "+79990000003"
OTHER_PASSWORD = "master12345"


@pytest.fixture
def other_user():
    """A second (master-role) user row — the insert_user pattern from
    test_user_settings_auth.py."""
    return insert_user(OTHER_PHONE, hash_password(OTHER_PASSWORD), "master")


@pytest.fixture
def me(api_client) -> dict:
    """The api_client session user (fixture admin) as {id, phone}."""
    resp = api_client.get("/api/v1/auth/me")
    assert resp.status_code == 200, resp.text
    user = resp.json()["user"]
    return {"id": user["id"], "phone": user["phone"]}


class TestGetUserSettings:
    """GET /api/v1/user-settings — get-or-create (GH #319)"""

    def test_get_creates_defaults_when_missing(self, api_client, me) -> None:
        """GH #319: GET with no row → 200 + model defaults + row in the DB."""
        from tests.conftest import query_db

        resp = api_client.get("/api/v1/user-settings")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        body = resp.json()
        assert body["user_id"] == me["id"]
        assert body["theme"] == "light"
        assert body["language"] == "ru"
        assert body["column_order_staff"] == []
        assert body["column_order_locations"] == []
        assert body["show_archived_masters"] is True
        assert body["show_archived_locations"] is False
        assert "id" in body
        assert "created_at" in body
        assert "updated_at" in body

        # The defaults row is persisted, not synthesized in-memory
        rows = query_db(f"SELECT id FROM user_settings WHERE user_id='{me['id']}'")
        assert len(rows) == 1, "GET must write the defaults row to the DB"

    def test_get_response_is_no_store(self, api_client, me) -> None:
        """GH #319: the get-or-create response must not be cached."""
        resp = api_client.get("/api/v1/user-settings")
        assert resp.status_code == 200
        assert resp.headers.get("Cache-Control") == "no-store"

    def test_get_returns_own_settings(self, api_client, me) -> None:
        # Create settings first
        create_resp = api_client.post("/api/v1/user-settings", json={
            "user_id": me["id"],
            "theme": "dark",
            "language": "en",
            "column_order_staff": ["first_name", "color"],
            "column_order_locations": ["name"],
        })
        assert create_resp.status_code == 201, f"Create failed: {create_resp.text}"

        # Get
        resp = api_client.get("/api/v1/user-settings")
        assert resp.status_code == 200
        body = resp.json()
        assert body["user_id"] == me["id"]
        assert body["theme"] == "dark"
        assert body["language"] == "en"
        assert body["column_order_staff"] == ["first_name", "color"]
        assert body["column_order_locations"] == ["name"]
        assert "id" in body
        assert "created_at" in body
        assert "updated_at" in body

    def test_get_recreates_defaults_after_delete(self, api_client, me) -> None:
        """DELETE = reset to defaults (domain rule): after a hard-delete the
        next GET recreates the defaults row instead of returning 404."""
        create_resp = api_client.post("/api/v1/user-settings", json={
            "user_id": me["id"],
            "theme": "light",
        })
        assert create_resp.status_code == 201
        settings_id = create_resp.json()["id"]

        api_client.delete(f"/api/v1/user-settings/{settings_id}")

        # Get-or-create: defaults come back (a NEW row, not the deleted one)
        resp = api_client.get("/api/v1/user-settings")
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] != settings_id
        assert body["user_id"] == me["id"]
        assert body["theme"] == "light"

    def test_get_ignores_stale_user_id_param(self, api_client, me) -> None:
        """Old clients still send ?user_id= — FastAPI drops the undeclared
        param and own-row semantics win (spec §3.8)."""
        api_client.post("/api/v1/user-settings", json={
            "user_id": me["id"], "theme": "dark",
        })

        resp = api_client.get("/api/v1/user-settings?user_id=some-other-user")
        assert resp.status_code == 200
        assert resp.json()["user_id"] == me["id"]


class TestCreateUserSettings:
    """POST /api/v1/user-settings — user from the session (GH #319)"""

    def test_create_with_defaults(self, api_client, me) -> None:
        resp = api_client.post("/api/v1/user-settings", json={})
        assert resp.status_code == 201, f"Create failed: {resp.text}"
        body = resp.json()
        assert body["user_id"] == me["id"]
        assert body["theme"] == "light"
        assert body["language"] == "ru"
        assert body["column_order_staff"] == []
        assert body["column_order_locations"] == []
        assert "id" in body
        assert "created_at" in body
        assert "updated_at" in body

    def test_create_with_all_fields(self, api_client, me) -> None:
        resp = api_client.post("/api/v1/user-settings", json={
            "user_id": me["id"],
            "theme": "dark",
            "language": "en",
            "column_order_staff": ["color", "position"],
            "column_order_locations": ["name", "capacity"],
        })
        assert resp.status_code == 201
        body = resp.json()
        assert body["user_id"] == me["id"]
        assert body["theme"] == "dark"
        assert body["language"] == "en"
        assert body["column_order_staff"] == ["color", "position"]
        assert body["column_order_locations"] == ["name", "capacity"]

    def test_create_archived_visibility_defaults(self, api_client, me) -> None:
        """GH #267: create without the new toggles → masters ON, locations OFF."""
        resp = api_client.post("/api/v1/user-settings", json={})
        assert resp.status_code == 201, f"Create failed: {resp.text}"
        body = resp.json()
        assert body["show_archived_masters"] is True
        assert body["show_archived_locations"] is False

    def test_create_ignores_foreign_user_id_in_body(self, api_client, me, other_user) -> None:
        """GH #319: ``user_id`` in the body is ignored — the row is created for
        the SESSION user even when the body names another user."""
        resp = api_client.post("/api/v1/user-settings", json={
            "user_id": other_user["id"],
            "theme": "dark",
        })
        assert resp.status_code == 201, f"Create failed: {resp.text}"
        body = resp.json()
        assert body["user_id"] == me["id"], (
            "POST must take the user from the session, not the body"
        )
        assert body["theme"] == "dark"

        from tests.conftest import query_db
        foreign_rows = query_db(
            f"SELECT id FROM user_settings WHERE user_id='{other_user['id']}'"
        )
        assert foreign_rows == [], "No row may be created for the foreign user"

    def test_create_duplicate_user_id_returns_422(self, api_client, me) -> None:
        api_client.post("/api/v1/user-settings", json={"user_id": me["id"]})
        resp = api_client.post("/api/v1/user-settings", json={"user_id": me["id"]})
        # IntegrityError is caught by the global handler → 422
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == ErrorCode.INTEGRITY_VIOLATION.value


class TestUpdateUserSettings:
    """PUT /api/v1/user-settings (own-only — no user_id param)"""

    def test_update_returns_404_when_no_settings(self, api_client, me) -> None:
        resp = api_client.put("/api/v1/user-settings", json={"theme": "dark"})
        assert resp.status_code == 404

    def test_update_theme(self, api_client, me) -> None:
        api_client.post("/api/v1/user-settings", json={"user_id": me["id"]})

        resp = api_client.put("/api/v1/user-settings", json={"theme": "dark"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["theme"] == "dark"
        assert body["language"] == "ru"  # unchanged

    def test_update_language(self, api_client, me) -> None:
        api_client.post("/api/v1/user-settings", json={"user_id": me["id"]})

        resp = api_client.put("/api/v1/user-settings", json={"language": "en"})
        assert resp.status_code == 200
        assert resp.json()["language"] == "en"

    def test_update_column_orders(self, api_client, me) -> None:
        api_client.post("/api/v1/user-settings", json={"user_id": me["id"]})

        resp = api_client.put("/api/v1/user-settings", json={
            "column_order_staff": ["last_name", "first_name"],
            "column_order_locations": ["address"],
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body["column_order_staff"] == ["last_name", "first_name"]
        assert body["column_order_locations"] == ["address"]

    def test_update_all_fields(self, api_client, me) -> None:
        api_client.post("/api/v1/user-settings", json={"user_id": me["id"]})

        resp = api_client.put("/api/v1/user-settings", json={
            "theme": "dark",
            "language": "en",
            "column_order_staff": ["color"],
            "column_order_locations": ["name"],
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body["theme"] == "dark"
        assert body["language"] == "en"
        assert body["column_order_staff"] == ["color"]
        assert body["column_order_locations"] == ["name"]

    def test_update_empty_body_noop(self, api_client, me) -> None:
        api_client.post("/api/v1/user-settings", json={"user_id": me["id"]})

        resp = api_client.put("/api/v1/user-settings", json={})
        assert resp.status_code == 200
        assert resp.json()["theme"] == "light"  # unchanged


class TestPatchSettings:
    """Tests for PATCH /api/v1/user-settings (own-only — no user_id param)"""

    def test_patch_theme_only(self, api_client, me) -> None:
        """PATCH updates only theme."""
        api_client.post("/api/v1/user-settings", json={
            "user_id": me["id"], "theme": "light", "language": "ru",
        })

        response = api_client.patch("/api/v1/user-settings", json={"theme": "dark"})
        assert response.status_code == 200
        body = response.json()
        assert body["theme"] == "dark"
        assert body["language"] == "ru"  # unchanged

    def test_patch_not_found_404(self, api_client, me) -> None:
        """PATCH with no own settings row returns 404."""
        response = api_client.patch("/api/v1/user-settings", json={"theme": "dark"})
        assert response.status_code == 404

    def test_patch_empty_body_noop(self, api_client, me) -> None:
        """PATCH with empty body makes no changes."""
        api_client.post("/api/v1/user-settings", json={
            "user_id": me["id"], "theme": "light", "language": "ru",
        })

        response = api_client.patch("/api/v1/user-settings", json={})
        assert response.status_code == 200
        body = response.json()
        assert body["theme"] == "light"
        assert body["language"] == "ru"


class TestDeleteUserSettings:
    """DELETE /api/v1/user-settings/{id}"""

    def test_delete_returns_204(self, api_client, me) -> None:
        create_resp = api_client.post("/api/v1/user-settings", json={"user_id": me["id"]})
        settings_id = create_resp.json()["id"]

        resp = api_client.delete(f"/api/v1/user-settings/{settings_id}")
        assert resp.status_code == 204

    def test_delete_removes_row(self, api_client, me) -> None:
        create_resp = api_client.post("/api/v1/user-settings", json={"user_id": me["id"]})
        settings_id = create_resp.json()["id"]

        api_client.delete(f"/api/v1/user-settings/{settings_id}")

        # Hard-delete: row is physically removed from the database
        from tests.conftest import query_db
        rows = query_db(f"SELECT id FROM user_settings WHERE id='{settings_id}'")
        assert rows == []

    def test_delete_returns_404_for_nonexistent(self, api_client) -> None:
        resp = api_client.delete("/api/v1/user-settings/nonexistent-id")
        assert resp.status_code == 404
