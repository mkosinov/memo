"""GH #593 Task 4 — ``POST /api/v1/auth/call/status`` + the shared finalizer.

Integration (TestClient + stub provider) coverage of spec §Эндпоинты
(status), §Финализация, §Гейты (debounce), US-5 and US-7:

- handle: invalid/consumed → 404 (check existence is never disclosed);
  before a confirm NO response sets the cookie;
- provider code mapping: waiting (100/400 — the stub's WAITING),
  confirmed (401 → the atomic consume + finalization + cookie AFTER the
  commit), expired (402 or the local window — but the PROVIDER answer
  first: a late call confirms until the purge margin);
- exactly one session per handle: a replay of a consumed handle creates
  no session; PARALLEL polls of one handle yield exactly one 200 with a
  cookie and 404 for the rest (the conditional ``pending → consumed``
  update decides — the debounce is neutralized for the race);
- finalization = the SHARED helper: find-or-create the client account
  (card + passwordless user + settings, ``phone_is_confirmed=true``),
  NO rotation — re-login keeps the old session row alive (owner
  decision 2026-11-11), each method-confirm mints a parallel session;
- debounce: ≤1 provider ``status`` call per phone per 3-s window
  (in-memory, TTL-pruned map);
- provider failure (HTTP ≠ 2xx / timeout / network) → ``waiting``
  without a state change and without a journal row;
- US-7: the RAW handle appears in NO status response body (success or
  failure) and in NO log line; same for the provider key.

Spec: docs/specs/2026-11-11-auth-callcheck-design.md §Эндпоинты,
§Финализация, §Гейты, §Логирование
Domain rules: docs/domain-rules/auth.md «Методы авторизации клиента (#593)»
"""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from src.auth.callcheck import hash_ip
from src.auth.callcheck_provider import (
    CALLCHECK_WINDOW_SECONDS,
    CallcheckProviderError,
    CallcheckStatus,
    CheckCreated,
)
from tests.conftest import insert_user, query_db

pytestmark = pytest.mark.api

PHONE = "+79995552255"
PHONE2 = "+79995552256"
STUB_CALL_PHONE = "+78005553535"
INITIATE_URL = "/api/v1/auth/call/initiate"
STATUS_URL = "/api/v1/auth/call/status"

SET_COOKIE = "set-cookie"


# ─── fixtures / helpers ────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _clear_call_flow_state():
    """Isolate the module-level in-memory gate + debounce state between tests."""
    from src.auth import callcheck_gates as gates

    gates._COUNTERS.clear()
    gates._PHONES_PER_IP.clear()
    gates._GLOBAL = None
    gates._STATUS_DEBOUNCE.clear()
    yield
    gates._COUNTERS.clear()
    gates._PHONES_PER_IP.clear()
    gates._GLOBAL = None
    gates._STATUS_DEBOUNCE.clear()


class StatusStubProvider:
    """Recording stand-in for the provider seam.

    ``status_calls`` captures the check ids polled (the debounce DoD
    counts them); ``result`` is what every ``status`` answers — ``None``
    turns each poll into the normalized provider failure.
    """

    def __init__(self, *, result: CallcheckStatus | None = CallcheckStatus.WAITING) -> None:
        self.status_calls: list[str] = []
        self.create_calls: list[tuple[str, str | None]] = []
        self.result = result

    async def create(self, phone: str, ip: str | None) -> CheckCreated:
        self.create_calls.append((phone, ip))
        return CheckCreated(
            check_id=f"check-{len(self.create_calls):03d}",
            call_phone=STUB_CALL_PHONE,
            window_seconds=CALLCHECK_WINDOW_SECONDS,
        )

    async def status(self, check_id: str) -> CallcheckStatus:
        self.status_calls.append(check_id)
        if self.result is None:
            raise CallcheckProviderError("sms.ru callcheck status failed: HTTP 502")
        return self.result


@pytest.fixture
def stub_provider(monkeypatch: pytest.MonkeyPatch) -> StatusStubProvider:
    from src.usecases import callcheck_login

    stub = StatusStubProvider()
    monkeypatch.setattr(callcheck_login, "get_callcheck_transport", lambda: stub)
    return stub


@pytest.fixture
def pinned_origins(monkeypatch: pytest.MonkeyPatch) -> None:
    """A concrete CORS list (the .env.test default is ``*`` — allow-all)."""
    from src.core.config import settings

    monkeypatch.setattr(settings, "CORS_ORIGINS", ["http://localhost:3000"])


def _initiate(client, phone: str = PHONE):
    return client.post(INITIATE_URL, json={"phone": phone})


def _poll(client, handle: str, origin: str | None = None):
    headers = {"Origin": origin} if origin else {}
    return client.post(STATUS_URL, json={"handle": handle}, headers=headers)


def _initiated_handle(client, phone: str = PHONE) -> str:
    resp = _initiate(client, phone)
    assert resp.status_code == 202, resp.text
    handle = resp.json()["handle"]
    assert handle, f"a real initiate must surface a handle: {resp.text}"
    return handle


def _rewind_debounce(phone: str = PHONE) -> None:
    """Age the debounce entry out — the next poll may hit the provider.

    Production polls come every ~4 s (> the 3-s window), so only tests
    that chain two provider-meaningful polls inside 3 s need this.
    """
    from src.auth import callcheck_gates as gates

    last = gates._STATUS_DEBOUNCE.get(phone)
    if last is not None:
        gates._STATUS_DEBOUNCE[phone] = last - timedelta(seconds=3)


def _call_rows(phone: str = PHONE) -> list[dict]:
    return query_db(f"SELECT * FROM auth_calls WHERE phone = '{phone}'")


def _attempt_rows(phone: str = PHONE) -> list[dict]:
    return query_db(
        f"SELECT * FROM auth_call_attempts WHERE phone = '{phone}' ORDER BY created_at, id"
    )


def _user_row(phone: str = PHONE) -> dict | None:
    rows = query_db(f"SELECT * FROM users WHERE phone = '{phone}'")
    return rows[0] if rows else None


def _session_count(user_id: str) -> int:
    rows = query_db(f"SELECT COUNT(*) AS n FROM sessions WHERE user_id = '{user_id}'")
    return int(rows[0]["n"])


# ─── the waiting contract: shape, handle resolution, no cookie ────────────────


class TestStatusWaiting:
    def test_waiting_shape_no_cookie(self, api_client, stub_provider) -> None:
        handle = _initiated_handle(api_client)

        resp = _poll(api_client, handle)

        assert resp.status_code == 200, resp.text
        assert resp.json() == {"status": "waiting"}
        assert SET_COOKIE not in resp.headers, "no session before a confirm"
        assert _call_rows()[0]["status"] == "pending"
        # The journal carries only the initiate row — waiting writes nothing.
        assert [a["outcome"] for a in _attempt_rows()] == ["created"]

    def test_invalid_handle_404(self, api_client, stub_provider) -> None:
        for bad in ("deadbeef" * 4, "not-a-handle", "0"):
            resp = _poll(api_client, bad)
            assert resp.status_code == 404, bad
        assert stub_provider.status_calls == [], "404 fires before the provider"

    def test_empty_handle_422(self, api_client, stub_provider) -> None:
        resp = _poll(api_client, "")
        assert resp.status_code == 422

    def test_extra_body_key_422(self, api_client, stub_provider) -> None:
        resp = api_client.post(STATUS_URL, json={"handle": "deadbeef" * 4, "x": 1})
        assert resp.status_code == 422

    def test_replaced_handle_404(self, api_client, stub_provider) -> None:
        """A re-initiate replaces the row — the OLD handle must be dead
        (last request wins, the Task 2 rotation semantics)."""
        first = _initiated_handle(api_client)
        second = _initiated_handle(api_client)

        assert _poll(api_client, first).status_code == 404
        assert _poll(api_client, second).status_code == 200


# ─── confirmed: the atomic consume + the SHARED finalizer ─────────────────────


class TestStatusConfirmed:
    def test_confirmed_finalizes_and_sets_cookie_after_commit(
        self, api_client, stub_provider
    ) -> None:
        handle = _initiated_handle(api_client)
        stub_provider.result = CallcheckStatus.CONFIRMED

        resp = _poll(api_client, handle)

        assert resp.status_code == 200, resp.text
        assert resp.json() == {"status": "confirmed"}

        cookie = resp.headers.get(SET_COOKIE, "")
        assert cookie.startswith("memo_client_session=")
        assert "httponly" in cookie.lower()
        assert "samesite=lax" in cookie.lower()
        assert "path=/" in cookie.lower()
        assert "max-age=2592000" in cookie.lower()  # ABSOLUTE_CAP: 30 days
        assert "secure" not in cookie.lower(), "secure iff production"

        # The jar cookie actually drives the client cabinet.
        assert api_client.get("/api/v1/my/client").status_code == 200

        # §Финализация: find-or-create — card + passwordless user +
        # settings, phone_is_confirmed stamped.
        user = _user_row()
        assert user is not None
        assert user["role"] == "client"
        assert user["password_hash"] is None
        assert user["phone_is_confirmed"] == 1
        cards = query_db(f"SELECT * FROM clients WHERE phone = '{PHONE}'")
        assert len(cards) == 1
        assert user["client_id"] == cards[0]["id"]
        settings_rows = query_db(f"SELECT * FROM user_settings WHERE user_id = '{user['id']}'")
        assert len(settings_rows) == 1, "guaranteed child row (#319)"

        # The handle is consumed atomically with the finalization.
        assert _call_rows()[0]["status"] == "consumed"
        attempts = _attempt_rows()
        assert [a["outcome"] for a in attempts] == ["created", "confirmed"]
        assert attempts[1]["checked_at"] is not None
        assert attempts[1]["ip_hash"] == hash_ip("testclient")
        assert _session_count(user["id"]) == 1

    def test_replay_consumed_handle_404_no_second_session(self, api_client, stub_provider) -> None:
        handle = _initiated_handle(api_client)
        stub_provider.result = CallcheckStatus.CONFIRMED
        assert _poll(api_client, handle).status_code == 200

        replay = _poll(api_client, handle)

        assert replay.status_code == 404
        assert SET_COOKIE not in replay.headers
        assert _session_count(_user_row()["id"]) == 1, "replay mints no session"
        # No duplicate journal row either.
        assert [a["outcome"] for a in _attempt_rows()] == ["created", "confirmed"]

    def test_existing_client_account_reused(self, api_client, stub_provider) -> None:
        """A returning client: the finalizer REUSES the account (no second
        user row), stamps phone_is_confirmed, mints a fresh session."""
        insert_user(PHONE, None, role="client")
        handle = _initiated_handle(api_client)
        stub_provider.result = CallcheckStatus.CONFIRMED

        assert _poll(api_client, handle).status_code == 200

        users = query_db(f"SELECT * FROM users WHERE phone = '{PHONE}'")
        assert len(users) == 1, "the existing account is reused"
        assert users[0]["phone_is_confirmed"] == 1
        assert _session_count(users[0]["id"]) == 1

    def test_relogin_keeps_parallel_sessions_no_rotation(self, api_client, stub_provider) -> None:
        """Owner decision 2026-11-11: client sessions are NOT rotated — a
        second login (a fresh initiate + confirm) leaves the FIRST session
        row alive; both cookies resolve."""
        first_handle = _initiated_handle(api_client)
        stub_provider.result = CallcheckStatus.CONFIRMED
        first = _poll(api_client, first_handle)
        assert first.status_code == 200
        first_token = api_client.cookies.get("memo_client_session")
        assert first_token

        stub_provider.result = CallcheckStatus.WAITING
        second_handle = _initiated_handle(api_client)
        stub_provider.result = CallcheckStatus.CONFIRMED
        _rewind_debounce()  # production polls come ~4 s apart
        second = _poll(api_client, second_handle)
        assert second.status_code == 200
        assert second.json() == {"status": "confirmed"}

        users = query_db(f"SELECT * FROM users WHERE phone = '{PHONE}'")
        assert len(users) == 1, "one account across logins"
        assert _session_count(users[0]["id"]) == 2, "parallel sessions live"

        # The OLD cookie still resolves — nothing was revoked.
        old_session = api_client.get(
            "/api/v1/my/client",
            headers={"Cookie": f"memo_client_session={first_token}"},
        )
        assert old_session.status_code == 200, "no rotation: the first session lives"

    async def test_parallel_polls_exactly_one_session(
        self, app, api_client, stub_provider, monkeypatch
    ) -> None:
        """The DoD race: parallel polls of ONE handle → exactly one 200 with
        a session, 404 for the losers, one session row total. The debounce
        is neutralized (0 s) so both polls reach the conditional consume —
        exactly-once is the UPDATE's job, not the debounce's."""
        from src.auth import callcheck_gates as gates

        monkeypatch.setattr(gates, "CALL_STATUS_DEBOUNCE", timedelta(0))
        handle = _initiated_handle(api_client)
        stub_provider.result = CallcheckStatus.CONFIRMED

        clients = [TestClient(app) for _ in range(4)]
        responses = await asyncio.gather(
            *[asyncio.to_thread(c.post, STATUS_URL, json={"handle": handle}) for c in clients]
        )

        codes = sorted(r.status_code for r in responses)
        assert codes == [200, 404, 404, 404], [r.status_code for r in responses]
        winners = [r for r in responses if r.status_code == 200]
        assert len(winners) == 1

        user = _user_row()
        assert user is not None and user["role"] == "client"
        assert _session_count(user["id"]) == 1, "exactly one session per handle"
        assert _call_rows()[0]["status"] == "consumed"
        confirmed = [a for a in _attempt_rows() if a["outcome"] == "confirmed"]
        assert len(confirmed) == 1, "exactly one confirmed journal row"


# ─── expired: provider 402, the local window, and the provider priority ───────


class TestStatusExpired:
    def test_provider_402_expires(self, api_client, stub_provider) -> None:
        handle = _initiated_handle(api_client)
        stub_provider.result = CallcheckStatus.EXPIRED

        resp = _poll(api_client, handle)

        assert resp.status_code == 200, resp.text
        assert resp.json() == {"status": "expired"}
        assert SET_COOKIE not in resp.headers
        assert _call_rows()[0]["status"] == "expired"
        attempts = _attempt_rows()
        assert [a["outcome"] for a in attempts] == ["created", "expired"]
        assert attempts[1]["checked_at"] is not None

    def test_local_window_over_provider_waiting_expires(self, api_client, stub_provider) -> None:
        """US-5: the window is over (but the row is inside the purge
        margin) and the provider still says waiting → ``expired``."""
        handle = _initiated_handle(api_client)
        query_db(
            f"UPDATE auth_calls SET created_at = datetime('now', '-330 seconds') "
            f"WHERE phone = '{PHONE}'"
        )
        assert stub_provider.result == CallcheckStatus.WAITING

        resp = _poll(api_client, handle)

        assert resp.json() == {"status": "expired"}
        assert SET_COOKIE not in resp.headers
        assert _call_rows()[0]["status"] == "expired"
        assert [a["outcome"] for a in _attempt_rows()] == ["created", "expired"]

    def test_late_call_confirms_past_window_until_margin(self, api_client, stub_provider) -> None:
        """US-5 provider priority: the call landed past the window edge but
        inside the purge margin — the provider says confirmed and WINS
        over the local expiry (the window tail is not cut)."""
        handle = _initiated_handle(api_client)
        query_db(
            f"UPDATE auth_calls SET created_at = datetime('now', '-310 seconds') "
            f"WHERE phone = '{PHONE}'"
        )
        stub_provider.result = CallcheckStatus.CONFIRMED

        resp = _poll(api_client, handle)

        assert resp.status_code == 200, resp.text
        assert resp.json() == {"status": "confirmed"}
        assert SET_COOKIE in resp.headers
        assert _session_count(_user_row()["id"]) == 1

    def test_expired_row_answers_expired_without_duplicate_journal(
        self, api_client, stub_provider
    ) -> None:
        """A re-poll of an already-expired check stays ``expired`` — the
        flip is guarded, the journal row is not duplicated."""
        handle = _initiated_handle(api_client)
        stub_provider.result = CallcheckStatus.EXPIRED
        assert _poll(api_client, handle).json() == {"status": "expired"}

        resp = _poll(api_client, handle)

        assert resp.json() == {"status": "expired"}
        assert [a["outcome"] for a in _attempt_rows()] == ["created", "expired"]

    def test_late_call_confirms_even_after_local_expired_flip(
        self, api_client, stub_provider
    ) -> None:
        """Provider priority, pinned: a check the window already closed
        (``expired`` answered once on a waiting provider) is STILL
        confirmed by a late provider answer inside the purge margin —
        the consume guard is ``status != consumed``, so the window tail
        is never cut; the journal keeps the full terminal trace."""
        handle = _initiated_handle(api_client)
        query_db(
            f"UPDATE auth_calls SET created_at = datetime('now', '-330 seconds') "
            f"WHERE phone = '{PHONE}'"
        )
        assert _poll(api_client, handle).json() == {"status": "expired"}

        _rewind_debounce()
        stub_provider.result = CallcheckStatus.CONFIRMED
        resp = _poll(api_client, handle)

        assert resp.status_code == 200, resp.text
        assert resp.json() == {"status": "confirmed"}
        assert SET_COOKIE in resp.headers
        assert [a["outcome"] for a in _attempt_rows()] == [
            "created",
            "expired",
            "confirmed",
        ]

    def test_purged_row_404(self, api_client, stub_provider) -> None:
        """Past window + margin the row is purged on touch — the handle is
        gone, the poll answers 404 (the purge delete rides the rolled-
        back request transaction — the lingering row is inert, the
        ``otp/verify`` expired-code precedent; the purge itself is the
        Task 2 store contract)."""
        handle = _initiated_handle(api_client)
        query_db(
            f"UPDATE auth_calls SET created_at = datetime('now', '-10 minutes') "
            f"WHERE phone = '{PHONE}'"
        )

        assert _poll(api_client, handle).status_code == 404
        assert _poll(api_client, handle).status_code == 404, "the handle stays dead"


# ─── debounce: ≤1 provider call per phone per 3-s window ──────────────────────


class TestStatusDebounce:
    def test_rapid_polls_single_provider_call(self, api_client, stub_provider) -> None:
        handle = _initiated_handle(api_client)

        for _ in range(3):
            resp = _poll(api_client, handle)
            assert resp.json() == {"status": "waiting"}

        assert len(stub_provider.status_calls) == 1, (
            "a fast poll series hits the provider at most once per 3-s window"
        )

    def test_debounce_expires(self, api_client, stub_provider) -> None:
        handle = _initiated_handle(api_client)
        assert _poll(api_client, handle).status_code == 200
        _rewind_debounce()
        assert _poll(api_client, handle).status_code == 200

        assert len(stub_provider.status_calls) == 2, "the window elapsed — a new call"

    def test_debounce_is_per_phone(self, api_client, stub_provider) -> None:
        handle1 = _initiated_handle(api_client, PHONE)
        handle2 = _initiated_handle(api_client, PHONE2)

        assert _poll(api_client, handle1).status_code == 200
        assert _poll(api_client, handle2).status_code == 200

        assert len(stub_provider.status_calls) == 2, "phones debounce apart"

    def test_zero_window_allows_all(self, api_client, stub_provider, monkeypatch) -> None:
        from src.auth import callcheck_gates as gates

        monkeypatch.setattr(gates, "CALL_STATUS_DEBOUNCE", timedelta(0))
        handle = _initiated_handle(api_client)

        for _ in range(3):
            assert _poll(api_client, handle).status_code == 200

        assert len(stub_provider.status_calls) == 3


# ─── provider failure → waiting, no state change, no journal ──────────────────


class TestStatusProviderFailure:
    def test_provider_error_waiting_no_flip_no_journal(self, api_client, stub_provider) -> None:
        handle = _initiated_handle(api_client)
        stub_provider.result = None  # every poll raises the normalized error

        resp = _poll(api_client, handle)

        assert resp.status_code == 200, "a provider hiccup is not the client's problem"
        assert resp.json() == {"status": "waiting"}
        assert SET_COOKIE not in resp.headers
        assert _call_rows()[0]["status"] == "pending", "no state change"
        assert [a["outcome"] for a in _attempt_rows()] == ["created"], "no journal row"

    def test_recovery_confirms_after_failure(self, api_client, stub_provider) -> None:
        handle = _initiated_handle(api_client)
        stub_provider.result = None
        assert _poll(api_client, handle).json() == {"status": "waiting"}

        stub_provider.result = CallcheckStatus.CONFIRMED
        _rewind_debounce()
        resp = _poll(api_client, handle)

        assert resp.json() == {"status": "confirmed"}
        assert SET_COOKIE in resp.headers


# ─── Origin-vs-CORS line (the OTP-route posture) ──────────────────────────────


class TestStatusOriginLine:
    def test_foreign_origin_403(self, api_client, stub_provider, pinned_origins) -> None:
        handle = _initiated_handle(api_client)

        resp = _poll(api_client, handle, origin="https://evil.example")

        assert resp.status_code == 403
        assert stub_provider.status_calls == [], "403 fires before any work"

    def test_listed_origin_passes(self, api_client, stub_provider, pinned_origins) -> None:
        handle = _initiated_handle(api_client)
        assert _poll(api_client, handle, origin="http://localhost:3000").status_code == 200

    def test_missing_origin_header_passes(self, api_client, stub_provider) -> None:
        handle = _initiated_handle(api_client)
        assert _poll(api_client, handle).status_code == 200


# ─── US-7: nothing leaks — no raw handle, no provider key ─────────────────────


class TestStatusSecrets:
    def test_handle_absent_from_bodies_and_logs(self, api_client, stub_provider, caplog) -> None:
        """US-7: the RAW handle appears neither in any status response
        body (waiting / confirmed / 404 / failure) nor in the logs; the
        provider key never enters this flow at all."""
        handle = _initiated_handle(api_client)

        with caplog.at_level(logging.INFO):
            stub_provider.result = None
            failure = _poll(api_client, handle)
            _rewind_debounce()
            stub_provider.result = CallcheckStatus.CONFIRMED
            confirmed = _poll(api_client, handle)
            missing = _poll(api_client, "deadbeef" * 4)

        assert failure.status_code == 200
        assert confirmed.status_code == 200
        assert missing.status_code == 404

        for body in (failure.text, confirmed.text, missing.text):
            assert handle not in body
        assert handle not in caplog.text, "the raw handle never reaches the log"
