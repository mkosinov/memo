"""GH #262 Task 3: POST /auth/change-password + avatar in the me snapshot.

API-level tests through the shared ``api_client`` (session-scoped
TestClient, ``anon``/``login_as`` conftest pattern from test_api_my.py).
Users/staff cards are inserted directly (``insert_user`` / the staff API),
because no user-creation API exists.

Covered (spec 2026-09-09-user-cabinet-design.md §4 change-password row +
D6; domain-rules/auth.md «Change password (#262)»):
- wrong current password → 401 ``AUTH_INVALID_CREDENTIALS`` WITH a timing
  parity dummy verify (the login DUMMY_HASH pattern, test_auth_service.py);
- new password violating the policy → 422 ``PASSWORD_POLICY``;
- success → 204; the CURRENT session stays alive while ALL other session
  rows of the user are deleted (``token != current``); the lockout-ladder
  fields are untouched (D6: does not feed the ladder);
- no session → 401 ``AUTH_UNAUTHORIZED``;
- /auth/me: ``master.avatar_url`` present (null when no card) and the
  snapshot name/avatar read from the card **regardless of card archive**
  (Display rule, spec §4).
"""

from __future__ import annotations

import pytest

from src.auth.passwords import hash_password
from src.errors import ErrorCode
from tests.conftest import insert_user, query_db

pytestmark = pytest.mark.api

PASSWORD = "correct-horse-1"
ENDPOINT = "/api/v1/auth/change-password"


# ─── helpers ───────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def _hashed_passwords():
    """Hash the shared passwords once per module (Argon2 is slow)."""
    return {
        "old": hash_password(PASSWORD),
        "new": hash_password("fresh-horse-2"),
    }


@pytest.fixture
def anon(app):
    """Unauthenticated TestClient (the test_api_my.py ``anon`` pattern)."""
    from fastapi.testclient import TestClient

    client = TestClient(app)
    yield client
    client.close()


def _make_user_login(login_as, _hashed_passwords, *, role: str = "admin"):
    """Insert a user with the shared old-password hash; log in twice.

    Returns ``(current, other)`` TestClients — two independent sessions
    for the same user (the session-deletion assertion needs both).
    """
    phone = f"+7999{_uuid7()}"
    insert_user(phone, _hashed_passwords["old"], role=role)
    return login_as(phone, PASSWORD), login_as(phone, PASSWORD)


def _uuid7() -> str:
    import uuid as _uuid

    return _uuid.uuid4().hex[:7]


def _call(client, current: str = PASSWORD, new: str = "fresh-horse-2"):
    return client.post(
        ENDPOINT, json={"current_password": current, "new_password": new}
    )


def _token_of(client) -> str | None:
    """The session token of a logged-in TestClient."""
    token = client.cookies.get("memo_session")
    assert token, "client must be logged in"
    return token


# ─── POST /auth/change-password ────────────────────────────────────────────────


class TestChangePassword:
    def test_wrong_current_password_401(self, api_client, login_as, _hashed_passwords) -> None:
        current, _ = _make_user_login(login_as, _hashed_passwords)

        resp = _call(current, current="wrong-old-password")

        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_INVALID_CREDENTIALS.value

    def test_wrong_current_password_runs_dummy_verify_timing_parity(
        self, api_client, login_as, _hashed_passwords, monkeypatch,
    ) -> None:
        """Spec §4: wrong current → 401 with a timing-parity dummy verify.

        Mirrors ``test_unknown_phone_runs_dummy_verify_for_timing_parity``
        (test_auth_service.py): monkeypatch ``verify_password`` and require
        the wrong-current branch to call it against DUMMY_HASH too — the
        wrong-current path must spend the same Argon2 work as the success
        path (no cheap reject).
        """
        from src.auth import service as service_module
        from src.auth.passwords import DUMMY_HASH

        # ``user.password_hash`` is the real hash of PASSWORD; the wrong
        # current password below must fail BOTH the fast real-hash verify
        # and then still hit the DUMMY_HASH verify.
        calls: list[tuple[str, str]] = []

        def fake_verify(password: str, stored_hash: str) -> bool:
            calls.append((password, stored_hash))
            return False  # every verify fails → 401 branch

        current, _ = _make_user_login(login_as, _hashed_passwords)
        # Patch AFTER login (login also routes through verify_password —
        # an always-False fake would break login_as itself).
        monkeypatch.setattr(service_module, "verify_password", fake_verify)
        resp = _call(current, current="whatever-wrong")

        assert resp.status_code == 401
        assert ("whatever-wrong", DUMMY_HASH) in calls

    def test_new_password_policy_violation_422(
        self, api_client, login_as, _hashed_passwords,
    ) -> None:
        current, _ = _make_user_login(login_as, _hashed_passwords)

        resp = _call(current, new="short")

        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == ErrorCode.PASSWORD_POLICY.value

    def test_success_204_current_session_alive_others_deleted(
        self, api_client, login_as, _hashed_passwords,
    ) -> None:
        current, other = _make_user_login(login_as, _hashed_passwords)
        current_token = _token_of(current)
        other_token = _token_of(other)
        user_id = current.get("/api/v1/auth/me").json()["user"]["id"]
        rows_before = query_db(
            f"SELECT token FROM sessions WHERE user_id = '{user_id}'"
        )
        assert {r["token"] for r in rows_before} == {current_token, other_token}

        resp = _call(current)

        assert resp.status_code == 204
        # Current session survives…
        assert current.get("/api/v1/auth/me").status_code == 200
        # …and only its row remains among the two.
        rows_after = query_db(
            f"SELECT token FROM sessions WHERE user_id = '{user_id}'"
        )
        assert [r["token"] for r in rows_after] == [current_token]

    def test_success_lockout_ladder_untouched(
        self, api_client, login_as, _hashed_passwords,
    ) -> None:
        """D6: change-password does not feed the login lockout ladder."""
        current, _ = _make_user_login(login_as, _hashed_passwords)
        user_id = current.get("/api/v1/auth/me").json()["user"]["id"]

        resp = _call(current)

        assert resp.status_code == 204
        row = query_db(
            f"SELECT failed_login_attempts, lock_level, locked_until "
            f"FROM users WHERE id = '{user_id}'"
        )[0]
        assert row["failed_login_attempts"] == 0
        assert row["lock_level"] == 0
        assert row["locked_until"] is None

    def test_wrong_current_does_not_delete_sessions_or_change_hash(
        self, api_client, login_as, _hashed_passwords,
    ) -> None:
        current, other = _make_user_login(login_as, _hashed_passwords)
        other_token = _token_of(other)
        user_id = current.get("/api/v1/auth/me").json()["user"]["id"]
        hash_before = query_db(
            f"SELECT password_hash FROM users WHERE id = '{user_id}'"
        )[0]["password_hash"]

        resp = _call(current, current="wrong-old-password")

        assert resp.status_code == 401
        # Nothing changed: hash intact, the other session still resolves.
        hash_after = query_db(
            f"SELECT password_hash FROM users WHERE id = '{user_id}'"
        )[0]["password_hash"]
        assert hash_after == hash_before
        assert other.get("/api/v1/auth/me").status_code == 200

    def test_new_password_active_after_change(
        self, api_client, login_as, _hashed_passwords, anon,
    ) -> None:
        """The stored hash is replaced: old password stops working."""
        current, _ = _make_user_login(login_as, _hashed_passwords)
        phone = current.get("/api/v1/auth/me").json()["user"]["phone"]

        assert _call(current).status_code == 204

        old = anon.post(
            "/api/v1/auth/login", json={"phone": phone, "password": PASSWORD}
        )
        new = anon.post(
            "/api/v1/auth/login", json={"phone": phone, "password": "fresh-horse-2"}
        )
        assert old.status_code == 401
        assert new.status_code == 200

    def test_no_session_401(self, anon) -> None:
        resp = anon.post(
            ENDPOINT, json={"current_password": PASSWORD, "new_password": "fresh-horse-2"}
        )
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value


# ─── /auth/me snapshot: avatar_url + archive-independent name ──────────────────


class TestMeSnapshotAvatar:
    def test_master_snapshot_includes_avatar_url(
        self, api_client, login_as, _hashed_passwords,
    ) -> None:
        phone = f"+7999{_uuid7()}"
        staff_id = api_client.post(
            "/api/v1/staff",
            json={
                "first_name": "Мария",
                "last_name": "Иванова",
                "avatar_url": "/api/v1/files/avatar/some.jpg",
                "master": {"specialty": "живопись", "color": "#5B8C7A"},
            },
        ).json()["id"]
        insert_user(
            phone, _hashed_passwords["old"], role="master", master_id=staff_id
        )
        client = login_as(phone, PASSWORD)

        master = client.get("/api/v1/auth/me").json()["master"]

        assert master == {
            "first_name": "Мария",
            "last_name": "Иванова",
            "avatar_url": "/api/v1/files/avatar/some.jpg",
        }

    def test_master_snapshot_avatar_null_without_card(
        self, api_client, login_as, _hashed_passwords,
    ) -> None:
        """No card → master is null entirely (existing behavior)."""
        phone = f"+7999{_uuid7()}"
        insert_user(phone, _hashed_passwords["old"], role="admin")
        client = login_as(phone, PASSWORD)

        body = client.get("/api/v1/auth/me").json()

        assert body["user"]["master_id"] is None
        assert body["master"] is None

    def test_snapshot_name_and_avatar_from_archived_card(
        self, api_client, login_as, _hashed_passwords,
    ) -> None:
        """Display rule (spec §4): an archived card still yields name+avatar.

        The current builder outerjoins with ``Staff.is_active == True``,
        blanking the snapshot for archived people — one's own name never
        blanks. The join must read the card regardless of its archive.
        """
        staff_id = api_client.post(
            "/api/v1/staff",
            json={
                "first_name": "Ольга",
                "last_name": "Петрова",
                "avatar_url": "/api/v1/files/avatar/old.png",
                "master": {"specialty": "керамика", "color": "#5B8C7A"},
            },
        ).json()["id"]
        archived = api_client.post(
            f"/api/v1/staff/{staff_id}/archive",
            json={"archive_master": False, "archive_user": False},
        )
        assert archived.status_code == 200, archived.text

        phone = f"+7999{_uuid7()}"
        insert_user(
            phone, _hashed_passwords["old"], role="master", master_id=staff_id
        )
        client = login_as(phone, PASSWORD)

        master = client.get("/api/v1/auth/me").json()["master"]

        assert master == {
            "first_name": "Ольга",
            "last_name": "Петрова",
            "avatar_url": "/api/v1/files/avatar/old.png",
        }
