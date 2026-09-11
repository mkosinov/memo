"""User-settings own-only scoping — GH #247 T8 (spec §3.8, breaking).

The ``?user_id=`` query parameter is removed from GET/PUT/PATCH — the
session user is the only addressable user. A stale ``?user_id=`` sent by
an old client is ignored (FastAPI drops undeclared query params). DELETE
``/{settings_id}`` resolves the row's ``user_id`` and rejects non-owned
rows with 403 ``AUTH_FORBIDDEN``.

The ``api_client`` fixture is the session admin; a second real user is
created via ``insert_user`` + ``login_as`` for ownership tests.
"""

import pytest

from src.auth.passwords import hash_password
from src.errors import ErrorCode
from tests.conftest import insert_user

pytestmark = pytest.mark.api

OTHER_PHONE = "+79990000002"
OTHER_PASSWORD = "master12345"


@pytest.fixture
def other_user():
    """A second (master-role) user row, insertable before login."""
    return insert_user(OTHER_PHONE, hash_password(OTHER_PASSWORD), "master")


def _me_id(api_client) -> str:
    """Session user id via /api/v1/auth/me."""
    resp = api_client.get("/api/v1/auth/me")
    assert resp.status_code == 200, resp.text
    return resp.json()["user"]["id"]


def _create_own_settings(api_client, **fields) -> dict:
    """POST settings for the api_client session user."""
    payload = {"user_id": _me_id(api_client), **fields}
    resp = api_client.post("/api/v1/user-settings", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestGetOwnOnly:
    """GET /api/v1/user-settings — no user_id param, session user only."""

    def test_get_without_param_returns_404_when_own_row_absent(self, api_client) -> None:
        resp = api_client.get("/api/v1/user-settings")
        assert resp.status_code == 404, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.SETTINGS_NOT_FOUND.value

    def test_get_without_param_returns_own_row(self, api_client) -> None:
        created = _create_own_settings(api_client, theme="dark")

        resp = api_client.get("/api/v1/user-settings")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["user_id"] == created["user_id"]
        assert body["theme"] == "dark"

    def test_stale_user_id_param_is_ignored_get(self, api_client, other_user) -> None:
        """Old client sends ?user_id=<other> — own-row semantics win."""
        created = _create_own_settings(api_client, theme="light")

        resp = api_client.get(f"/api/v1/user-settings?user_id={other_user['id']}")
        assert resp.status_code == 200, resp.text
        assert resp.json()["user_id"] == created["user_id"]  # own row, not other's

    def test_stale_param_does_not_leak_foreign_row(self, api_client, other_user) -> None:
        """?user_id=<other> with other's row present but own absent → 404."""
        from tests.conftest import query_db

        query_db(
            f"INSERT INTO user_settings (id, user_id, theme, language, "
            f"column_order_staff, column_order_locations, created_at, updated_at) "
            f"VALUES ('stale-{other_user['id'][:8]}', '{other_user['id']}', "
            f"'dark', 'ru', '[]', '[]', datetime('now'), datetime('now'))"
        )

        resp = api_client.get(f"/api/v1/user-settings?user_id={other_user['id']}")
        assert resp.status_code == 404, resp.text  # own row absent → 404


class TestPutPatchOwnOnly:
    """PUT/PATCH /api/v1/user-settings — no user_id param, session user only."""

    def test_put_without_param_404_when_own_row_absent(self, api_client) -> None:
        resp = api_client.put("/api/v1/user-settings", json={"theme": "dark"})
        assert resp.status_code == 404, resp.text

    def test_put_without_param_updates_own_row(self, api_client) -> None:
        _create_own_settings(api_client, theme="light")

        resp = api_client.put("/api/v1/user-settings", json={"theme": "dark"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["theme"] == "dark"

    def test_stale_user_id_param_is_ignored_put(self, api_client, other_user) -> None:
        """PUT ?user_id=<other> still targets the session user's own row."""
        created = _create_own_settings(api_client, theme="light")

        resp = api_client.put(
            f"/api/v1/user-settings?user_id={other_user['id']}",
            json={"theme": "dark"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["user_id"] == created["user_id"]
        assert body["theme"] == "dark"

    def test_patch_without_param_404_when_own_row_absent(self, api_client) -> None:
        resp = api_client.patch("/api/v1/user-settings", json={"theme": "dark"})
        assert resp.status_code == 404, resp.text

    def test_patch_without_param_updates_own_row(self, api_client) -> None:
        _create_own_settings(api_client, language="ru")

        resp = api_client.patch("/api/v1/user-settings", json={"language": "en"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["language"] == "en"


class TestDeleteOwnership:
    """DELETE /api/v1/user-settings/{settings_id} — row-level ownership."""

    def test_delete_foreign_row_returns_403(self, api_client, other_user) -> None:
        """Session user deleting another user's settings row → 403."""
        from tests.conftest import query_db

        settings_id = f"st-{other_user['id'][:8]}"
        query_db(
            f"INSERT INTO user_settings (id, user_id, theme, language, "
            f"column_order_staff, column_order_locations, created_at, updated_at) "
            f"VALUES ('{settings_id}', '{other_user['id']}', "
            f"'dark', 'ru', '[]', '[]', datetime('now'), datetime('now'))"
        )

        resp = api_client.delete(f"/api/v1/user-settings/{settings_id}")
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_FORBIDDEN.value
        # row untouched
        rows = query_db(f"SELECT id FROM user_settings WHERE id='{settings_id}'")
        assert len(rows) == 1

    def test_delete_own_row_returns_204(self, api_client, other_user, login_as) -> None:
        """A user deleting their own settings row → 204, row removed."""
        other = login_as(OTHER_PHONE, OTHER_PASSWORD)
        created = other.post("/api/v1/user-settings", json={"user_id": other_user["id"]})
        assert created.status_code == 201, created.text

        resp = other.delete(f"/api/v1/user-settings/{created.json()['id']}")
        assert resp.status_code == 204, resp.text

        from tests.conftest import query_db
        rows = query_db(f"SELECT id FROM user_settings WHERE id='{created.json()['id']}'")
        assert rows == []

    def test_delete_nonexistent_returns_404(self, api_client) -> None:
        resp = api_client.delete("/api/v1/user-settings/nonexistent-id")
        assert resp.status_code == 404, resp.text
