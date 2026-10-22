"""GH #499 (spec §4.3) — client session: resolver, /my/client, shared logout.

The client session rides the SAME ``sessions`` rows as the staff one —
only the cookie NAME differs (``memo_client_session``) and a separate
resolve dependency (``require_client_session``). Until the OTP ``verify``
endpoint lands (#499 Task 3) tests mint the session row directly (the
``conftest`` direct-SQL pattern) and set the cookie on the jar.

Covered:
- ``GET /api/v1/my/client`` → ``{phone, name}`` under a client session;
  ``name`` from the linked client card via ``users.client_id``, ``null``
  when the account has no card;
- cross-presentation 401: the client resolver reads ONLY
  ``memo_client_session`` (a staff ``memo_session`` jar is invisible) and
  requires ``role=client`` (a staff token copied into the client cookie
  name is still 401); conversely the staff surface (``/auth/me``) does
  not read ``memo_client_session``;
- garbage cookie / archived user → 401 (shared resolve core);
- spec §3 invariant: archiving the CLIENT CARD keeps the account link
  (``users.client_id``) and the cabinet working — the owner is the
  account, the card is data;
- the shared ``POST /api/v1/auth/logout`` revokes whichever session kind
  is presented (client / staff / both), stays idempotent with no cookie,
  and a client-only logout never touches the staff session row.

Spec: docs/specs/2026-10-20-web-client-auth-booking-design.md §3, §4.3
Domain rules: docs/domain-rules/auth.md («Клиентская аутентификация (#499)», Sessions)
"""

from __future__ import annotations

import secrets

import pytest

from src.errors import ErrorCode
from tests.conftest import insert_user, query_db, query_db_params

pytestmark = pytest.mark.api

CLIENT_PHONE = "+79995550101"
CLIENT_NAME = "Анна Тестовая"

MY_CLIENT_URL = "/api/v1/my/client"


# ─── helpers (conftest direct-SQL pattern) ─────────────────────────────────────


def _insert_client_card(name: str | None, phone: str, is_active: int = 1) -> str:
    """Direct-SQL client-card row → id (the ``_master_profile`` pattern)."""
    card_id = secrets.token_hex(16)
    query_db_params(
        "INSERT INTO clients (id, name, phone, is_active, created_at, updated_at) "
        "VALUES (:id, :name, :phone, :active, datetime('now'), datetime('now'))",
        {"id": card_id, "name": name, "phone": phone, "active": is_active},
    )
    return card_id


def _client_account(phone: str, card_id: str | None = None) -> dict:
    """Passwordless client-role user (conftest ``insert_user`` → settings row
    guaranteed per #319), then link the client card via ``users.client_id``."""
    user = insert_user(phone, None, role="client")
    if card_id is not None:
        query_db_params(
            "UPDATE users SET client_id = :card WHERE id = :user",
            {"card": card_id, "user": user["id"]},
        )
    return user


def _client_session(user_id: str) -> str:
    """Mint a live session row directly (the OTP verify endpoint that will
    issue client sessions is #499 Task 3 — the row shape is identical)."""
    token = secrets.token_urlsafe(32)
    query_db_params(
        "INSERT INTO sessions (token, user_id, created_at, last_extended_at, "
        "idle_deadline, absolute_deadline) VALUES "
        "(:t, :u, datetime('now'), datetime('now'), "
        "datetime('now', '+6 days'), datetime('now', '+29 days'))",
        {"t": token, "u": user_id},
    )
    return token


def _jar_with_client_cookie(api_client, token: str):
    """Fresh jar carrying ONLY ``memo_client_session=<token>``."""
    api_client.cookies.clear()
    api_client.cookies.set("memo_client_session", token)
    return api_client


# ─── fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture
def client_account() -> dict:
    """A canonical client: account + linked card with a known name."""
    card_id = _insert_client_card(CLIENT_NAME, CLIENT_PHONE)
    return _client_account(CLIENT_PHONE, card_id)


@pytest.fixture
def client_token(client_account) -> str:
    return _client_session(client_account["id"])


@pytest.fixture
def client_jar(api_client, client_token):
    """The shared TestClient with the client session cookie (admin jar wiped)."""
    return _jar_with_client_cookie(api_client, client_token)


# ─── GET /api/v1/my/client ─────────────────────────────────────────────────────


class TestMyClient:
    def test_returns_phone_and_name(self, client_jar, client_account) -> None:
        resp = client_jar.get(MY_CLIENT_URL)
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"phone": client_account["phone"], "name": CLIENT_NAME}

    def test_without_card_name_null(self, api_client) -> None:
        user = _client_account("+79995550102")
        _jar_with_client_cookie(api_client, _client_session(user["id"]))
        resp = api_client.get(MY_CLIENT_URL)
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"phone": user["phone"], "name": None}

    def test_no_cookie_401(self, api_client) -> None:
        api_client.cookies.clear()
        resp = api_client.get(MY_CLIENT_URL)
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value

    def test_garbage_cookie_401(self, api_client) -> None:
        _jar_with_client_cookie(api_client, "not-a-real-token")
        resp = api_client.get(MY_CLIENT_URL)
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value

    def test_archived_user_401(self, api_client, client_account) -> None:
        """The shared resolve core refuses archived accounts (users.is_active)."""
        query_db_params(
            "UPDATE users SET is_active = 0 WHERE id = :u", {"u": client_account["id"]},
        )
        _jar_with_client_cookie(api_client, _client_session(client_account["id"]))
        resp = api_client.get(MY_CLIENT_URL)
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value


# ─── cross-presentation (spec §3: resolvers never cross) ───────────────────────


class TestCrossPresentation:
    def test_staff_session_jar_not_read_401(self, api_client) -> None:
        """api_client holds a LIVE staff ``memo_session`` — the client
        resolver must not see it (cookie-name separation)."""
        resp = api_client.get(MY_CLIENT_URL)  # admin jar, no client cookie
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value

    def test_staff_token_in_client_cookie_401(self, api_client) -> None:
        """A staff session token COPIED into the client cookie name resolves
        (same table) but fails the ``role=client`` barrier → 401."""
        staff_token = api_client.cookies.get("memo_session")
        assert staff_token, "api_client fixture must arrive logged in"
        _jar_with_client_cookie(api_client, staff_token)
        resp = api_client.get(MY_CLIENT_URL)
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value

    def test_client_cookie_invisible_to_staff_surface_401(
        self, api_client, client_token,
    ) -> None:
        """A client session presented to a staff endpoint (``/auth/me`` reads
        only ``memo_session``) is invisible → 401."""
        _jar_with_client_cookie(api_client, client_token)
        resp = api_client.get("/api/v1/auth/me")
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value


# ─── spec §3 invariant: card archive keeps the link and the access ─────────────


class TestClientCardArchiveInvariant:
    def test_archive_card_keeps_link_and_cabinet(
        self, api_client, client_account, client_token,
    ) -> None:
        """Archiving the client card is NOT an account event: the
        ``users.client_id`` link survives (no cascade, no unlink) and the
        cabinet keeps answering ``{phone, name}`` from the archived card."""
        query_db_params(
            "UPDATE clients SET is_active = 0 WHERE phone = :p", {"p": CLIENT_PHONE},
        )

        resp = _jar_with_client_cookie(api_client, client_token).get(MY_CLIENT_URL)
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"phone": CLIENT_PHONE, "name": CLIENT_NAME}

        rows = query_db(
            f"SELECT client_id FROM users WHERE id = '{client_account['id']}'"
        )
        assert rows[0]["client_id"] is not None, "archive must not unlink the card"


# ─── shared logout: any session kind, idempotent ───────────────────────────────


class TestLogoutBothKinds:
    def test_client_logout_revokes_row_and_clears_cookie(
        self, client_jar, client_token,
    ) -> None:
        resp = client_jar.post("/api/v1/auth/logout")
        assert resp.status_code == 204

        # Cookie cleared client-side (empty value + zeroed Max-Age).
        cookies = "; ".join(resp.headers.get_list("set-cookie")).lower()
        assert "memo_client_session=" in cookies
        assert "max-age=0" in cookies

        rows = query_db(
            f"SELECT COUNT(*) AS n FROM sessions WHERE token = '{client_token}'"
        )
        assert rows[0]["n"] == 0, "logout must delete the client session row"

        me = client_jar.get(MY_CLIENT_URL)
        assert me.status_code == 401

    def test_client_logout_never_touches_staff_session(self, api_client, client_token):
        """A client-cookie-only logout must not hunt down other sessions.

        Spec §4.2: whichever cookie is PRESENTED, that session is revoked
        — with both cookies in one request both die (see the test below);
        a request carrying only ``memo_client_session`` (the cabinet app)
        leaves an unrelated staff row alone. Contrast with a full
        ``revoke_user_sessions`` sweep — logout is per-token.
        """
        staff_token = api_client.cookies.get("memo_session")
        assert staff_token
        _jar_with_client_cookie(api_client, client_token)

        resp = api_client.post("/api/v1/auth/logout")
        assert resp.status_code == 204

        staff_rows = query_db(
            f"SELECT COUNT(*) AS n FROM sessions WHERE token = '{staff_token}'"
        )
        assert staff_rows[0]["n"] == 1, "staff session must survive a client logout"

        # Re-present the still-live staff token — the row, not the jar,
        # governs validity.
        api_client.cookies.clear()
        api_client.cookies.set("memo_session", staff_token)
        assert api_client.get("/api/v1/auth/me").status_code == 200

    def test_both_cookies_revokes_both(self, api_client, client_token) -> None:
        """#499 spec §4.2: whichever cookie is presented, that session is
        revoked — both presented → both rows die."""
        staff_token = api_client.cookies.get("memo_session")
        assert staff_token
        api_client.cookies.set("memo_client_session", client_token)

        resp = api_client.post("/api/v1/auth/logout")
        assert resp.status_code == 204

        rows = query_db("SELECT COUNT(*) AS n FROM sessions")
        assert rows[0]["n"] == 0, "both session rows must be revoked"

        api_client.cookies.clear()
        api_client.cookies.set("memo_client_session", client_token)
        assert api_client.get(MY_CLIENT_URL).status_code == 401
        api_client.cookies.clear()
        api_client.cookies.set("memo_session", staff_token)
        assert api_client.get("/api/v1/auth/me").status_code == 401

    def test_logout_without_cookies_204_idempotent(self, api_client) -> None:
        api_client.cookies.clear()
        assert api_client.post("/api/v1/auth/logout").status_code == 204
