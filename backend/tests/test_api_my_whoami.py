"""#584 (spec §4.1/§6) — ``GET /api/v1/my`` «кто я»: combined guard contract.

The whoami surface resolves BOTH cookies, each «purely» (no audit-actor
staging inside the resolve), composes the role list per spec §4.1
(symmetric audience filters), 401s on an empty list, and stages exactly
ONE audit actor — the primary account (staff-first) carrying the FULL
resolved role list (decision 2026-11-13: the actor format expands
``role`` → ``roles``).

Covered:
- account fields on the response (``id`` / ``phone`` / ``email``; client
  accounts have no email → ``null``) and the exact key set (password /
  lock fields / internal links never appear);
- role composition: staff-only (``[master]`` / ``[admin]`` / admin with
  a master section → both), client-only (``[client]``), both cookies;
- invalid (garbage) cookie: contributes no role but does not force 401
  while the OTHER cookie is valid; empty list (no valid cookie at all,
  anonymous, archived user, cross-presented tokens) → 401;
- the pure resolve (``resolve_authed_pure``) resolves WITHOUT staging
  the audit actor;
- the set_actor spy: exactly one call per request, primary account
  (staff-first), full staff-first-ordered role list.

Spec: docs/specs/2026-11-12-adr015-my-namespace-584-design.md §4.1, §6, §9
Domain rules: docs/domain-rules/auth.md (Sessions, Клиентская аутентификация)
"""

from __future__ import annotations

import secrets

import pytest

from src.auth.permissions import CLIENT_SESSION_COOKIE, SESSION_COOKIE
from src.errors import ErrorCode
from tests.conftest import insert_user, query_db_params

pytestmark = pytest.mark.api

WHOAMI_URL = "/api/v1/my"


# ─── helpers (conftest direct-SQL pattern, cf. test_client_session_api) ────────


def _staff_card(with_section: bool) -> str:
    """Direct-SQL staff card (+ optional masters extension) → staff_id."""
    staff_id = f"staff-{secrets.token_hex(8)}"
    query_db_params(
        "INSERT INTO staff (id, first_name, last_name, sort_order, is_active, "
        "created_at, updated_at) VALUES (:id, 'Кто', 'Я', 0, 1, "
        "datetime('now'), datetime('now'))",
        {"id": staff_id},
    )
    if with_section:
        query_db_params(
            "INSERT INTO masters (staff_id, specialty, color, is_active, "
            "created_at, updated_at) VALUES (:id, 'живопись', '#5B8C7A', 1, "
            "datetime('now'), datetime('now'))",
            {"id": staff_id},
        )
    return staff_id


def _staff_account(
    phone: str,
    role: str,
    *,
    with_card: bool = True,
    with_section: bool = False,
    email: str | None = None,
) -> dict:
    """A staff-role account (passwordless — tests mint session rows directly).

    ``with_card=False`` → a cardless account (pure admin shape); with a
    card the optional masters extension is controlled by ``with_section``.
    """
    staff_id = _staff_card(with_section) if with_card else None
    user = insert_user(phone, None, role=role, master_id=staff_id)
    if email is not None:
        query_db_params(
            "UPDATE users SET email = :email WHERE id = :user",
            {"email": email, "user": user["id"]},
        )
    return user


def _client_account(phone: str) -> dict:
    """A passwordless client-role account (client accounts carry no email)."""
    return insert_user(phone, None, role="client")


def _session_token(user_id: str) -> str:
    """Mint a live session row directly (the #499 fixture pattern)."""
    token = secrets.token_urlsafe(32)
    query_db_params(
        "INSERT INTO sessions (token, user_id, created_at, last_extended_at, "
        "idle_deadline, absolute_deadline) VALUES "
        "(:t, :u, datetime('now'), datetime('now'), "
        "datetime('now', '+6 days'), datetime('now', '+29 days'))",
        {"t": token, "u": user_id},
    )
    return token


def _jar(api_client, staff: str | None = None, client: str | None = None):
    """Fresh jar carrying exactly the given session cookies (None = absent)."""
    api_client.cookies.clear()
    if staff is not None:
        api_client.cookies.set(SESSION_COOKIE, staff)
    if client is not None:
        api_client.cookies.set(CLIENT_SESSION_COOKIE, client)
    return api_client


def _spy_set_actor(monkeypatch) -> list[dict]:
    """Spy on the audit actor staging; returns the captured kwargs list.

    The guard lazy-imports ``set_actor`` from ``src.events.audit`` at
    call time, so patching the module attribute intercepts the call.
    """
    import src.events.audit as audit_module

    calls: list[dict] = []

    def _spy(**kwargs) -> None:
        calls.append(kwargs)

    monkeypatch.setattr(audit_module, "set_actor", _spy)
    return calls


# ─── Response contract: account fields + role composition (spec §4.1) ─────────


class TestWhoamiContract:
    def test_staff_master_with_section(self, api_client) -> None:
        user = _staff_account(
            "+79995550201", "master", with_section=True, email="m@example.com"
        )
        _jar(api_client, staff=_session_token(user["id"]))

        resp = api_client.get(WHOAMI_URL)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert set(body) == {"id", "phone", "email", "roles"}
        assert body["id"] == user["id"]
        assert body["phone"] == user["phone"]
        assert body["email"] == "m@example.com"
        assert body["roles"] == ["master"]

    def test_staff_master_without_section_role_wins(self, api_client) -> None:
        """«роль master, секции нет» — the explicit role still grants master."""
        user = _staff_account("+79995550202", "master", with_section=False)
        _jar(api_client, staff=_session_token(user["id"]))

        body = api_client.get(WHOAMI_URL).json()

        assert body["roles"] == ["master"]

    def test_staff_admin_without_section(self, api_client) -> None:
        user = _staff_account("+79995550203", "admin", with_card=False)
        _jar(api_client, staff=_session_token(user["id"]))

        body = api_client.get(WHOAMI_URL).json()

        assert body["roles"] == ["admin"]
        assert body["email"] is None  # the account carries no email

    def test_staff_admin_with_master_section_lists_both(self, api_client) -> None:
        """Combined admin+master (role admin + masters section) → both roles."""
        user = _staff_account("+79995550204", "admin", with_section=True)
        _jar(api_client, staff=_session_token(user["id"]))

        body = api_client.get(WHOAMI_URL).json()

        assert sorted(body["roles"]) == ["admin", "master"]

    def test_client_only_roles_and_null_email(self, api_client) -> None:
        user = _client_account("+79995550205")
        _jar(api_client, client=_session_token(user["id"]))

        resp = api_client.get(WHOAMI_URL)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["id"] == user["id"]
        assert body["phone"] == user["phone"]
        assert body["email"] is None  # client accounts have no email (§4.1)
        assert body["roles"] == ["client"]

    def test_both_cookies_primary_is_staff(self, api_client) -> None:
        staff = _staff_account("+79995550206", "master", with_section=True)
        client = _client_account("+79995550207")
        _jar(
            api_client,
            staff=_session_token(staff["id"]),
            client=_session_token(client["id"]),
        )

        body = api_client.get(WHOAMI_URL).json()

        assert sorted(body["roles"]) == ["client", "master"]
        assert body["id"] == staff["id"]  # primary account is staff-first
        assert body["phone"] == staff["phone"]


# ─── Invalid cookies / empty list → 401 (spec §4.1, §7 scenario 6) ────────────


class TestWhoamiRejections:
    def test_anonymous_401(self, api_client) -> None:
        _jar(api_client)

        resp = api_client.get(WHOAMI_URL)

        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED

    def test_garbage_staff_cookie_with_valid_client_is_not_401(
        self, api_client
    ) -> None:
        """An invalid cookie contributes no role but does not force 401."""
        user = _client_account("+79995550208")
        _jar(api_client, staff=secrets.token_urlsafe(32),
             client=_session_token(user["id"]))

        resp = api_client.get(WHOAMI_URL)

        assert resp.status_code == 200, resp.text
        assert resp.json()["roles"] == ["client"]

    def test_garbage_both_cookies_401(self, api_client) -> None:
        _jar(
            api_client,
            staff=secrets.token_urlsafe(32),
            client=secrets.token_urlsafe(32),
        )

        assert api_client.get(WHOAMI_URL).status_code == 401

    def test_archived_user_401(self, api_client) -> None:
        user = _staff_account("+79995550209", "master", with_section=True)
        token = _session_token(user["id"])
        query_db_params(
            "UPDATE users SET is_active = 0 WHERE id = :user",
            {"user": user["id"]},
        )
        _jar(api_client, staff=token)

        assert api_client.get(WHOAMI_URL).status_code == 401

    def test_staff_token_in_client_cookie_only_401(self, api_client) -> None:
        """Symmetric audience filter: a staff token presented via the client
        cookie name resolves but contributes NO role → empty list → 401."""
        staff = _staff_account("+79995550210", "master", with_section=True)
        _jar(api_client, client=_session_token(staff["id"]))

        assert api_client.get(WHOAMI_URL).status_code == 401

    def test_client_token_in_staff_cookie_only_401(self, api_client) -> None:
        """Ditto for a client token presented via the staff cookie name."""
        client = _client_account("+79995550211")
        _jar(api_client, staff=_session_token(client["id"]))

        assert api_client.get(WHOAMI_URL).status_code == 401


# ─── Pure resolve: no actor staging inside the resolve (spec §6) ──────────────


class TestPureResolve:
    async def test_resolve_authed_pure_resolves_without_actor(
        self, api_client
    ) -> None:
        from src.auth.permissions import resolve_authed_pure
        from src.events import audit

        token = api_client.cookies.get(SESSION_COOKIE)
        assert token, "api_client must hold a memo_session cookie"

        authed = await resolve_authed_pure(token)

        assert authed is not None
        assert authed.role == "admin"
        assert audit.current_actor() is None  # the pure resolve journals nobody

    async def test_resolve_authed_pure_none_token(self) -> None:
        from src.auth.permissions import resolve_authed_pure

        assert await resolve_authed_pure(None) is None

    async def test_resolve_authed_pure_unknown_token(self) -> None:
        from src.auth.permissions import resolve_authed_pure
        from src.events import audit

        assert await resolve_authed_pure("no-such-token") is None
        assert audit.current_actor() is None


# ─── Audit actor: exactly one call, primary account, full list (spec §6/§9) ───


class TestActorStaging:
    def test_both_cookies_one_actor_call_full_list(
        self, api_client, monkeypatch
    ) -> None:
        staff = _staff_account("+79995550212", "master", with_section=True)
        client = _client_account("+79995550213")
        calls = _spy_set_actor(monkeypatch)
        _jar(
            api_client,
            staff=_session_token(staff["id"]),
            client=_session_token(client["id"]),
        )

        resp = api_client.get(WHOAMI_URL)

        assert resp.status_code == 200
        assert len(calls) == 1  # one record — not one per resolved cookie
        assert calls[0]["user_id"] == staff["id"]  # primary = staff-first
        assert list(calls[0]["roles"]) == ["master", "client"]  # full list

    def test_client_only_actor_is_client_account(
        self, api_client, monkeypatch
    ) -> None:
        client = _client_account("+79995550214")
        calls = _spy_set_actor(monkeypatch)
        _jar(api_client, client=_session_token(client["id"]))

        resp = api_client.get(WHOAMI_URL)

        assert resp.status_code == 200
        assert len(calls) == 1
        assert calls[0]["user_id"] == client["id"]
        assert list(calls[0]["roles"]) == ["client"]

    def test_admin_with_section_actor_roles_staff_first(
        self, api_client, monkeypatch
    ) -> None:
        staff = _staff_account("+79995550215", "admin", with_section=True)
        calls = _spy_set_actor(monkeypatch)
        _jar(api_client, staff=_session_token(staff["id"]))

        assert api_client.get(WHOAMI_URL).status_code == 200
        assert len(calls) == 1
        assert list(calls[0]["roles"]) == ["admin", "master"]

    def test_no_actor_on_401(self, api_client, monkeypatch) -> None:
        calls = _spy_set_actor(monkeypatch)
        _jar(api_client)

        assert api_client.get(WHOAMI_URL).status_code == 401
        assert calls == []
