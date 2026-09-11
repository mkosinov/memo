"""GH #247 §3.5–3.6 + §5: auth API — login / logout / me + session guards.

API-level tests through the shared ``api_client`` (session-scoped
TestClient). The auth endpoints are PUBLIC_ROUTES (spec §3.6), so they work
on the anonymous client; each test gets a **fresh cookie jar** (the shared
client would otherwise leak sessions across tests via ``Set-Cookie``).

Fixture strategy: users are inserted directly into the DB (no user-creation
API exists — ``conftest._user`` pattern) with a ``hash_password`` hash.
Argon2 is deliberately slow, so the two hashes the module needs (admin /
master) are computed once per module.

The in-memory failure counters are cleared around every test (the
``test_auth_service.py`` pattern) — a leftover ``phone:``/``ip:`` count
from an earlier test would 429 an otherwise-valid login.

Covered:
- login: 200 + ``{user, permissions, master?}`` body; ``Set-Cookie
  memo_session`` with ``HttpOnly`` + ``SameSite=lax`` (no ``Secure`` under
  ENV=testing) + ``Max-Age`` = ABSOLUTE_CAP seconds;
- login: wrong password → 401 ``AUTH_INVALID_CREDENTIALS``; 5th failure →
  429 ``AUTH_LOCKED_OUT`` + ``Retry-After``;
- me: with cookie → 200 (admin ``["*"]``; master gets the linked master
  snapshot via master_id join); without cookie → 401 ``AUTH_UNAUTHORIZED``;
- logout: 204, cookie cleared, subsequent me → 401;
- login rotates: the old cookie is dead after a re-login;
- guard smoke test: a throwaway route with
  ``require_permission("payments:write")`` — anonymous 401, admin 200,
  master 403 (proves the T5 dependencies end-to-end before T7).

Spec: docs/specs/2026-09-08-auth-design.md §2.2, §3.5, §3.6, §5
Domain rules: docs/domain-rules/auth.md (Sessions, Roles & Permissions)
"""

from __future__ import annotations

import sqlite3

import pytest

from src.auth.passwords import hash_password
from src.auth.session import ABSOLUTE_CAP
from src.errors import ErrorCode

pytestmark = pytest.mark.api

PASSWORD = "correct-horse-1"


# ─── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _clear_failure_counters():
    """Isolate the module-level in-memory lockout store between tests."""
    from src.auth import service as service_module

    service_module._FAILURE_COUNTERS.clear()
    yield
    service_module._FAILURE_COUNTERS.clear()


@pytest.fixture
def anon_client(api_client):
    """The shared TestClient with a wiped cookie jar (anonymous view).

    Since GH #247 T6 ``api_client`` arrives pre-authenticated as the
    fixture admin; auth behavior demands a known-empty jar.
    """
    api_client.cookies.clear()
    yield api_client
    api_client.cookies.clear()


@pytest.fixture(scope="module")
def _password_hashes():
    """Hash the two shared passwords once (Argon2 is deliberately slow)."""
    return {"password": hash_password(PASSWORD)}


@pytest.fixture
def _admin_user(_password_hashes):
    """Insert an admin user directly (no user API) — returns {id, phone}.

    Phone deliberately differs from the conftest fixture admin
    (+79990000001, GH #247 T6): users.phone is UNIQUE and both rows must
    coexist within one test.
    """
    return _insert_user(
        phone="+79990000011", role="admin",
        password_hash=_password_hashes["password"],
    )


@pytest.fixture
def _master_profile():
    """Insert a master profile row directly — returns its id."""
    import uuid as _uuid

    master_id = str(_uuid.uuid4())
    _query_db(
        "INSERT INTO masters (id, first_name, last_name, color, position, "
        "specialty, sort_order, is_active, created_at, updated_at) "
        "VALUES (:id, 'Ольга', 'Иванова', '#5B8C7A', 'мастер', 'живопись', 0, 1, "
        "datetime('now'), datetime('now'))",
        {"id": master_id},
    )
    return master_id


@pytest.fixture
def _master_user(_password_hashes, _master_profile):
    """Insert a master user linked to the master profile."""
    return _insert_user(
        phone="+79990000002", role="master",
        password_hash=_password_hashes["password"],
        master_id=_master_profile,
    )


def _insert_user(phone: str, role: str, password_hash: str, master_id: str | None = None) -> dict:
    """Direct-SQL user insert (conftest ``_user`` fixture pattern)."""
    import uuid as _uuid

    user_id = str(_uuid.uuid4())
    _query_db(
        "INSERT INTO users (id, phone, password_hash, role, master_id, "
        "email_is_confirmed, phone_is_confirmed, is_active, created_at, updated_at) "
        "VALUES (:id, :phone, :hash, :role, :master_id, 0, 0, 1, "
        "datetime('now'), datetime('now'))",
        {
            "id": user_id, "phone": phone, "hash": password_hash,
            "role": role, "master_id": master_id,
        },
    )
    return {"id": user_id, "phone": phone}


def _query_db(sql: str, params: dict | None = None) -> None:
    """Parameterized write against the shared test DB file."""
    from tests.conftest import _TEST_DB_URL

    db_path = _TEST_DB_URL.replace("sqlite+aiosqlite:///", "")
    conn = sqlite3.connect(db_path)
    conn.execute(sql, params or {})
    conn.commit()
    conn.close()


def _login(api_client, phone: str, password: str = PASSWORD):
    return api_client.post(
        "/api/v1/auth/login", json={"phone": phone, "password": password},
    )


def _cookie_header(resp) -> str:
    """Raw ``Set-Cookie`` header (``resp.headers`` keeps the last one)."""
    return resp.headers.get("set-cookie", "")


def _extract_token(set_cookie: str) -> str | None:
    """``memo_session=<token>; ...`` → ``<token>``."""
    for part in set_cookie.split(";"):
        part = part.strip()
        if part.startswith("memo_session="):
            return part[len("memo_session="):]
    return None


# ─── login ─────────────────────────────────────────────────────────────────────


class TestLogin:
    def test_login_ok_sets_cookie_and_returns_body(self, anon_client, _admin_user) -> None:
        resp = _login(anon_client, _admin_user["phone"])
        assert resp.status_code == 200, f"login failed: {resp.status_code}: {resp.text}"

        body = resp.json()
        assert body["user"]["id"] == _admin_user["id"]
        assert body["user"]["phone"] == _admin_user["phone"]
        assert body["user"]["role"] == "admin"
        assert body["user"]["master_id"] is None
        assert body["permissions"] == ["*"]
        assert body["master"] is None

        cookie = _cookie_header(resp)
        assert "memo_session=" in cookie
        assert "httponly" in cookie.lower()
        assert "samesite=lax" in cookie.lower()
        assert "secure" not in cookie.lower()  # ENV=testing → no Secure flag
        assert f"max-age={int(ABSOLUTE_CAP.total_seconds())}" in cookie.lower()

    def test_login_master_returns_linked_master_snapshot(
        self, anon_client, _master_user, _master_profile,
    ) -> None:
        resp = _login(anon_client, _master_user["phone"])
        assert resp.status_code == 200, resp.text

        body = resp.json()
        assert body["user"]["role"] == "master"
        assert body["user"]["master_id"] == _master_profile
        assert body["master"] == {"first_name": "Ольга", "last_name": "Иванова"}
        assert "records:read" in body["permissions"]
        assert "payments:write" not in body["permissions"]

    def test_login_wrong_password_401_invalid_credentials(self, anon_client, _admin_user) -> None:
        resp = _login(anon_client, _admin_user["phone"], password="wrong-password")
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_INVALID_CREDENTIALS.value

    def test_login_unknown_phone_401_same_code(self, anon_client, _admin_user) -> None:
        resp = _login(anon_client, "+79995555555")
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_INVALID_CREDENTIALS.value

    def test_login_missing_fields_422(self, anon_client) -> None:
        resp = anon_client.post("/api/v1/auth/login", json={"phone": "+79990000001"})
        assert resp.status_code == 422

    def test_login_lockout_429_with_retry_after(self, anon_client, _admin_user) -> None:
        """Lockout ladder: 3 failures → timed 15-min lock (§2.11).

        Failures 1–2 → 401; the 3rd trips ladder rung 1 → 429
        ``AUTH_LOCKED_OUT`` with ``Retry-After``; the 5th failure (and every
        one after) is still 429 — and the header must survive the global
        exception handler (spec §5).
        """
        statuses = []
        fifth = None
        for _ in range(5):
            fifth = _login(anon_client, _admin_user["phone"], password="wrong-password")
            statuses.append(fifth.status_code)

        assert statuses[:2] == [401, 401], f"first two failures must be 401: {statuses}"
        assert all(s == 429 for s in statuses[2:]), statuses

        assert fifth is not None
        assert fifth.json()["detail"]["code"] == ErrorCode.AUTH_LOCKED_OUT.value
        assert "retry-after" in fifth.headers, "global handler must forward Retry-After"
        assert int(fifth.headers["retry-after"]) > 0


# ─── me ────────────────────────────────────────────────────────────────────────


class TestMe:
    def test_me_with_cookie_admin(self, anon_client, _admin_user) -> None:
        _login(anon_client, _admin_user["phone"])
        resp = anon_client.get("/api/v1/auth/me")
        assert resp.status_code == 200, resp.text
        assert resp.json()["user"]["id"] == _admin_user["id"]
        assert resp.json()["permissions"] == ["*"]

    def test_me_without_cookie_401_unauthorized(self, anon_client, _admin_user) -> None:
        resp = anon_client.get("/api/v1/auth/me")
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value

    def test_me_with_garbage_cookie_401(self, anon_client, _admin_user) -> None:
        anon_client.cookies.set("memo_session", "not-a-real-token")
        resp = anon_client.get("/api/v1/auth/me")
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value


# ─── logout ────────────────────────────────────────────────────────────────────


class TestLogout:
    def test_logout_204_clears_cookie_and_revokes_session(
        self, anon_client, _admin_user,
    ) -> None:
        _login(anon_client, _admin_user["phone"])
        resp = anon_client.post("/api/v1/auth/logout")
        assert resp.status_code == 204

        cookie = _cookie_header(resp)
        # Cookie cleared: present with an empty value (Starlette quotes it
        # as "") and a zeroed Max-Age.
        assert "memo_session=" in cookie
        cleared = _extract_token(cookie)
        assert cleared in ('""', "", None)
        assert "max-age=0" in cookie.lower()

        me = anon_client.get("/api/v1/auth/me")
        assert me.status_code == 401

    def test_logout_without_session_204_idempotent(self, anon_client) -> None:
        resp = anon_client.post("/api/v1/auth/logout")
        assert resp.status_code == 204


# ─── session rotation ──────────────────────────────────────────────────────────


class TestSessionRotation:
    def test_relogin_rotates_old_cookie_dead(self, anon_client, _admin_user) -> None:
        first = _login(anon_client, _admin_user["phone"])
        old_token = _extract_token(_cookie_header(first))
        assert old_token

        # Re-login presenting the old cookie → new session, old row deleted
        second = _login(anon_client, _admin_user["phone"])
        assert second.status_code == 200
        new_token = _extract_token(_cookie_header(second))
        assert new_token and new_token != old_token

        # The old token must no longer resolve
        anon_client.cookies.set("memo_session", old_token)
        me = anon_client.get("/api/v1/auth/me")
        assert me.status_code == 401


# ─── guard smoke test (T5 dependencies end-to-end) ────────────────────────────


@pytest.fixture(scope="module")
def guarded_app(app):
    """Mount a throwaway guarded route on the shared app for this module.

    The route lives ONLY in tests — production routers stay clean (T7
    applies the guards broadly). Module-scoped: one mount, reused by the
    three smoke tests.
    """
    from fastapi import APIRouter, Depends

    from src.auth.permissions import require_permission

    smoke = APIRouter()

    @smoke.post("/_guard_smoke", dependencies=[Depends(require_permission("payments:write"))])
    async def _guard_smoke():
        return {"ok": True}

    app.include_router(smoke, prefix="/api/v1")
    return app


class TestRequirePermissionSmoke:
    """``require_permission("payments:write")`` — anonymous 401, admin 200,
    master 403 (admin-only permission, spec §3.5 matrix)."""

    ENDPOINT = "/api/v1/_guard_smoke"

    def test_anonymous_401(self, anon_client, guarded_app, _admin_user) -> None:
        resp = anon_client.post(self.ENDPOINT)
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value

    def test_admin_200(self, anon_client, guarded_app, _admin_user) -> None:
        _login(anon_client, _admin_user["phone"])
        resp = anon_client.post(self.ENDPOINT)
        assert resp.status_code == 200, resp.text

    def test_master_403(self, anon_client, guarded_app, _master_user) -> None:
        _login(anon_client, _master_user["phone"])
        resp = anon_client.post(self.ENDPOINT)
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_FORBIDDEN.value
