"""GH #593 Task 3 — ``POST /api/v1/auth/call/initiate``: the HTTP contract.

Integration (TestClient + stub provider) coverage of spec §Эндпоинты
(initiate) / §Гейты / US-6:

- validation: the phone must be the CANONICAL ``+7XXXXXXXXXX`` string —
  anything else answers 422 ``PHONE_INVALID`` BEFORE the gates and the
  provider (a typo must not hide behind a 503);
- staff numbers: the silent skip — an indistinguishable 202 with no
  check created, no provider call, no journal row (the SHARED predicate
  of the OTP path: staff accounts and archived client accounts);
- transport fail-closed: ``CALLCHECK_TRANSPORT`` off / unknown / ``dev``
  outside development → 503 ``NOTIFICATION_TRANSPORT_UNAVAILABLE``,
  nothing written;
- provider failure → 503, no row, no journal, and the phone budget is
  NOT consumed (registration happens only on provider success — the
  deliberate deviation from ``otp_service.issue`` ordering);
- gates: 5/phone, 20/IP, 5 distinct phones/IP (15-min window) → 429
  ``AUTH_LOCKED_OUT``; the global ceiling (100 initiate / 15 min per
  process) → fail-closed 503;
- response: ``handle`` (uuid4-hex — in the body, only its hash in the
  DB), ``call.phone`` strictly ``+7…``, ``pretty``, ``expires_at`` =
  the add moment + the window constant;
- the client IP is format-validated before the provider hand-off
  (malformed → ``None``, never passed through);
- Origin-vs-CORS line (the OTP-route posture).

Spec: docs/specs/2026-11-11-auth-callcheck-design.md §Эндпоинты, §Гейты
Domain rules: docs/domain-rules/auth.md «Методы авторизации клиента (#593)»
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from src.auth.callcheck import hash_handle, hash_ip
from src.auth.callcheck_provider import (
    CALLCHECK_WINDOW_SECONDS,
    CallcheckProviderError,
    CallcheckStatus,
    CheckCreated,
)
from src.errors import ErrorCode
from src.util.utc import utc_now
from tests.conftest import insert_user, query_db

pytestmark = pytest.mark.api

PHONE = "+79995552255"
STUB_CALL_PHONE = "+78005553535"
INITIATE_URL = "/api/v1/auth/call/initiate"

HEX_DIGITS = set("0123456789abcdef")


# ─── fixtures / helpers ────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _clear_call_gates():
    """Isolate the module-level in-memory gate state between tests."""
    from src.auth import callcheck_gates as gates

    gates._COUNTERS.clear()
    gates._PHONES_PER_IP.clear()
    gates._GLOBAL = None
    yield
    gates._COUNTERS.clear()
    gates._PHONES_PER_IP.clear()
    gates._GLOBAL = None


class StubCallcheckProvider:
    """Recording stand-in for the provider seam — Task 3's stub (DoD).

    ``create_calls`` captures the (phone, ip) hand-offs so tests can
    assert the provider was never reached; ``fail=True`` turns every
    ``create`` into the normalized provider error.
    """

    def __init__(self, *, fail: bool = False) -> None:
        self.create_calls: list[tuple[str, str | None]] = []
        self._fail = fail

    async def create(self, phone: str, ip: str | None) -> CheckCreated:
        self.create_calls.append((phone, ip))
        if self._fail:
            raise CallcheckProviderError(
                "sms.ru callcheck add failed: HTTP 502"
            )
        return CheckCreated(
            check_id=f"check-{len(self.create_calls):03d}",
            call_phone=STUB_CALL_PHONE,
            window_seconds=CALLCHECK_WINDOW_SECONDS,
        )

    async def status(self, check_id: str) -> CallcheckStatus:
        return CallcheckStatus.WAITING


@pytest.fixture
def stub_provider(monkeypatch: pytest.MonkeyPatch) -> StubCallcheckProvider:
    """A healthy provider stub swapped in at the usecase seam."""
    from src.usecases import callcheck_login

    stub = StubCallcheckProvider()
    monkeypatch.setattr(
        callcheck_login, "get_callcheck_transport", lambda: stub
    )
    return stub


@pytest.fixture
def pinned_origins(monkeypatch: pytest.MonkeyPatch) -> None:
    """A concrete CORS list (the .env.test default is ``*`` — allow-all)."""
    from src.core.config import settings

    monkeypatch.setattr(settings, "CORS_ORIGINS", ["http://localhost:3000"])


def _initiate(client, phone: str = PHONE, origin: str | None = None):
    headers = {"Origin": origin} if origin else {}
    return client.post(INITIATE_URL, json={"phone": phone}, headers=headers)


def _distinct_phone(n: int) -> str:
    """A unique canonical phone for the distinct-phones gate tests."""
    return f"+7999556{n:04d}"


def _call_rows(phone: str = PHONE) -> list[dict]:
    return query_db(f"SELECT * FROM auth_calls WHERE phone = '{phone}'")


def _attempt_rows(phone: str = PHONE) -> list[dict]:
    return query_db(f"SELECT * FROM auth_call_attempts WHERE phone = '{phone}'")


# ─── the 202 contract: shape, hashing, journal, rotation ──────────────────────


class TestInitiateSuccess:
    def test_202_shape_handle_call_window(self, api_client, stub_provider) -> None:
        before = utc_now()
        resp = _initiate(api_client)
        after = utc_now()
        assert resp.status_code == 202, resp.text

        body = resp.json()
        handle = body["handle"]
        # uuid4-hex — the one-time poll key, present ONLY in the body.
        assert len(handle) == 32
        assert set(handle) <= HEX_DIGITS

        call = body["call"]
        # The number the client calls — strictly with the leading ``+``
        # (some operators reject the bare form, especially from abroad).
        assert call["phone"] == STUB_CALL_PHONE
        assert call["phone"].startswith("+7")
        assert call["pretty"] == "+7 800 555-35-35"
        # expires_at = the add moment + the client-side window constant.
        parsed = datetime.fromisoformat(call["expires_at"])
        assert (
            before + timedelta(seconds=CALLCHECK_WINDOW_SECONDS)
            <= parsed
            <= after + timedelta(seconds=CALLCHECK_WINDOW_SECONDS)
        ), f"expires_at must be add moment + {CALLCHECK_WINDOW_SECONDS}s"

    def test_db_stores_only_the_handle_hash(self, api_client, stub_provider) -> None:
        resp = _initiate(api_client)
        assert resp.status_code == 202
        handle = resp.json()["handle"]

        rows = _call_rows()
        assert len(rows) == 1, "exactly one live check row per phone"
        row = rows[0]
        assert row["handle_hash"] != handle, "raw handle never stored"
        assert row["handle_hash"] == hash_handle(handle)
        assert row["status"] == "pending"
        assert row["provider_check_id"] == "check-001"
        assert row["call_phone"] == STUB_CALL_PHONE

    def test_journal_created_row_only_on_success(
        self, api_client, stub_provider
    ) -> None:
        assert _initiate(api_client).status_code == 202

        attempts = _attempt_rows()
        assert len(attempts) == 1
        attempt = attempts[0]
        assert attempt["outcome"] == "created"
        assert attempt["checked_at"] is None
        assert attempt["provider_check_id"] == "check-001"
        # ip_hash is the masked trace — the raw ASGI client address
        # (starlette TestClient default host) never lands in the journal.
        assert attempt["ip_hash"] == hash_ip("testclient")
        assert attempt["ip_hash"] != "testclient"

    def test_reinitiate_replaces_row_and_rotates_handle(
        self, api_client, stub_provider
    ) -> None:
        first = _initiate(api_client).json()["handle"]
        second = _initiate(api_client).json()["handle"]
        assert first != second

        # Last request wins: one live row, the old handle's hash is gone.
        rows = _call_rows()
        assert len(rows) == 1
        assert rows[0]["handle_hash"] == hash_handle(second)
        assert rows[0]["provider_check_id"] == "check-002"

        # The journal is append-only across initiates.
        assert len(_attempt_rows()) == 2

    def test_active_client_account_phone_gets_check(
        self, api_client, stub_provider
    ) -> None:
        """A phone held by an ACTIVE client account is not a staff skip —
        a returning client must be able to log in by call (OTP parity)."""
        insert_user(PHONE, None, role="client")
        assert _initiate(api_client).status_code == 202
        assert len(_call_rows()) == 1


# ─── validation: canonical +7… BEFORE gates and provider ──────────────────────


class TestValidation:
    @pytest.mark.parametrize(
        "bad",
        [
            "89995552255",        # the domestic 8… form — RF-only, rejected
            "9995552255",         # no prefix at all
            "+7999555225",        # 9 digits after +7
            "+799955522555",      # 11 digits after +7
            "+89995552255",       # wrong country prefix
            "+7(999)555-22-55",   # pretty-printed, not canonical
            " +79995552255 ",     # edge whitespace is fine — inner never is
            " ",
            "",
        ],
    )
    def test_non_canonical_phone_422_before_provider(
        self, api_client, stub_provider, bad: str
    ) -> None:
        resp = _initiate(api_client, phone=bad)
        if bad == " +79995552255 ":
            # Edge-whitespace tolerance: trimmed canonical PASSES (the
            # account-phone trim precedent) — not a 422 case.
            assert resp.status_code == 202, resp.text
            return
        assert resp.status_code == 422, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.PHONE_INVALID.value
        assert stub_provider.create_calls == [], "422 fires before the provider"
        assert _call_rows() == []

    def test_extra_body_key_422(self, api_client, stub_provider) -> None:
        resp = api_client.post(INITIATE_URL, json={"phone": PHONE, "x": 1})
        assert resp.status_code == 422
        assert stub_provider.create_calls == []


# ─── the silent staff skip (shared predicate with the OTP path) ───────────────


class TestStaffSkip:
    def test_staff_phone_indistinguishable_202(
        self, api_client, stub_provider
    ) -> None:
        """A staff phone: 202, but no check exists — no provider call, no
        row, no journal, no enumeration oracle (§Эндпоинты)."""
        insert_user(PHONE, "some-hash", role="master")

        resp = _initiate(api_client)
        assert resp.status_code == 202, resp.text
        assert resp.json() == {}, "nothing was created — nothing to surface"
        assert stub_provider.create_calls == []
        assert _call_rows() == []
        assert _attempt_rows() == []

    def test_archived_client_account_same_silence(
        self, api_client, stub_provider
    ) -> None:
        """An archived client account can never log in — the SAME silent
        answer (the shared predicate covers both shapes)."""
        user = insert_user(PHONE, None, role="client")
        query_db(f"UPDATE users SET is_active = 0 WHERE id = '{user['id']}'")

        resp = _initiate(api_client)
        assert resp.status_code == 202, resp.text
        assert resp.json() == {}
        assert stub_provider.create_calls == []
        assert _call_rows() == []

    def test_staff_skip_does_not_touch_gates(
        self, api_client, stub_provider
    ) -> None:
        """The skip precedes the gates — a staff probe must not spend the
        phone budget (nor be rate-limited: silent means silent)."""
        insert_user(PHONE, "some-hash", role="admin")
        for _ in range(7):
            assert _initiate(api_client).status_code == 202
        assert stub_provider.create_calls == []

        # A real initiate from the same IP still has its full budget.
        assert _initiate(api_client, phone=_distinct_phone(1)).status_code == 202


# ─── transport fail-closed (US-6) ─────────────────────────────────────────────


class TestTransportOff:
    def test_no_transport_503_fail_closed(self, api_client, monkeypatch) -> None:
        from src.core.config import settings

        monkeypatch.setattr(settings, "CALLCHECK_TRANSPORT", "")
        resp = _initiate(api_client)
        assert resp.status_code == 503
        assert (
            resp.json()["detail"]["code"]
            == ErrorCode.NOTIFICATION_TRANSPORT_UNAVAILABLE.value
        )
        assert _call_rows() == [], "fail-closed fires before any work"

    def test_unknown_selector_503(self, api_client, monkeypatch) -> None:
        from src.core.config import settings

        monkeypatch.setattr(settings, "CALLCHECK_TRANSPORT", "carrier-pigeon")
        assert _initiate(api_client).status_code == 503

    def test_dev_selector_outside_development_503(
        self, api_client, monkeypatch
    ) -> None:
        from src.core.config import settings

        monkeypatch.setattr(settings, "ENV", "testing")
        monkeypatch.setattr(settings, "CALLCHECK_TRANSPORT", "dev")
        resp = _initiate(api_client)
        assert resp.status_code == 503
        assert (
            resp.json()["detail"]["code"]
            == ErrorCode.NOTIFICATION_TRANSPORT_UNAVAILABLE.value
        )


# ─── provider failure → 503, budget untouched ─────────────────────────────────


class TestProviderFailure:
    def test_provider_error_503_nothing_written_budget_intact(
        self, api_client, monkeypatch
    ) -> None:
        from src.usecases import callcheck_login

        failing = StubCallcheckProvider(fail=True)
        healthy = StubCallcheckProvider()
        monkeypatch.setattr(
            callcheck_login, "get_callcheck_transport", lambda: failing
        )

        resp = _initiate(api_client)
        assert resp.status_code == 503
        assert (
            resp.json()["detail"]["code"]
            == ErrorCode.NOTIFICATION_TRANSPORT_UNAVAILABLE.value
        )
        assert _call_rows() == [], "no check row on a provider failure"
        assert _attempt_rows() == [], "no journal row — the attempt never was"

        # The phone budget is intact: a failure does not consume the
        # limit (the deliberate deviation from otp_service.issue).
        monkeypatch.setattr(
            callcheck_login, "get_callcheck_transport", lambda: healthy
        )
        for _ in range(5):
            assert _initiate(api_client).status_code == 202
        assert _initiate(api_client).status_code == 429, "5/phone as usual"


# ─── gates: 5/phone, 20/IP, 5 distinct/IP → 429 ───────────────────────────────


class TestGates:
    def test_sixth_per_phone_429(self, api_client, stub_provider) -> None:
        for _ in range(5):
            assert _initiate(api_client).status_code == 202
        resp = _initiate(api_client)
        assert resp.status_code == 429
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_LOCKED_OUT.value
        assert "retry-after" in {h.lower() for h in resp.headers}
        # The refused request created nothing.
        assert len(_call_rows()) == 1

    def test_sixth_distinct_phone_per_ip_429(
        self, api_client, stub_provider
    ) -> None:
        for n in range(5):
            assert _initiate(api_client, phone=_distinct_phone(n)).status_code == 202
        resp = _initiate(api_client, phone=_distinct_phone(9))
        assert resp.status_code == 429
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_LOCKED_OUT.value

    def test_ip_wire_21st_initiate_429(self, api_client, stub_provider) -> None:
        """20 initiates from one IP (4 phones × 5 sends) exhaust the IP
        wire; the 21st — on a FRESH 5th phone, so no other wire would
        refuse it — answers 429."""
        for n in range(4):
            for _ in range(5):
                assert (
                    _initiate(api_client, phone=_distinct_phone(n)).status_code
                    == 202
                )
        resp = _initiate(api_client, phone=_distinct_phone(8))
        assert resp.status_code == 429
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_LOCKED_OUT.value

    def test_refused_request_writes_nothing_and_spends_nothing(
        self, api_client, stub_provider
    ) -> None:
        for _ in range(5):
            assert _initiate(api_client).status_code == 202
        assert _initiate(api_client).status_code == 429
        assert len(_attempt_rows()) == 5, "only the five performed sends"

    def test_gate_constant_values(self) -> None:
        """The spec numbers: 5/phone, 20/IP, 5 distinct/IP, 15-min window,
        global ceiling 100 — code-owned constants (пересмотр — кодом)."""
        from src.auth import callcheck_gates as gates

        assert gates.CALL_PHONE_THRESHOLD == 5
        assert gates.CALL_IP_THRESHOLD == 20
        assert gates.CALL_DISTINCT_PHONES_PER_IP == 5
        assert gates.CALL_INITIATE_WINDOW.total_seconds() == 15 * 60
        assert gates.CALL_INITIATE_GLOBAL_CAP == 100


# ─── the global ceiling: 100 initiate / 15 min per process → 503 ─────────────


class TestGlobalCeiling:
    def test_over_ceiling_503_fail_closed(
        self, api_client, stub_provider, monkeypatch
    ) -> None:
        from src.auth import callcheck_gates as gates

        monkeypatch.setattr(gates, "CALL_INITIATE_GLOBAL_CAP", 3)
        for n in range(3):
            assert _initiate(api_client, phone=_distinct_phone(n)).status_code == 202

        # 4th initiate: fresh phone, IP at 3, distinct at 3 — only the
        # GLOBAL wire is tripped → fail-closed 503 (cuts wallet-driven
        # IP rotation; not a per-caller 429).
        resp = _initiate(api_client, phone=_distinct_phone(9))
        assert resp.status_code == 503
        assert (
            resp.json()["detail"]["code"]
            == ErrorCode.NOTIFICATION_TRANSPORT_UNAVAILABLE.value
        )
        assert _call_rows(_distinct_phone(9)) == []

    def test_ceiling_counts_only_provider_successes(
        self, api_client, monkeypatch
    ) -> None:
        from src.auth import callcheck_gates as gates
        from src.usecases import callcheck_login

        monkeypatch.setattr(gates, "CALL_INITIATE_GLOBAL_CAP", 2)
        failing = StubCallcheckProvider(fail=True)
        healthy = StubCallcheckProvider()
        monkeypatch.setattr(
            callcheck_login, "get_callcheck_transport", lambda: failing
        )
        for _ in range(4):  # failures never reach the ceiling counter
            assert _initiate(api_client).status_code == 503

        monkeypatch.setattr(
            callcheck_login, "get_callcheck_transport", lambda: healthy
        )
        assert _initiate(api_client, phone=_distinct_phone(1)).status_code == 202
        assert _initiate(api_client, phone=_distinct_phone(2)).status_code == 202
        assert (
            _initiate(api_client, phone=_distinct_phone(3)).status_code == 503
        ), "the ceiling counts only successful initiates"


# ─── client IP: format-validated before the provider hand-off ─────────────────


class TestIpHandoff:
    async def test_valid_ip_passed_to_provider(self, db_session, monkeypatch) -> None:
        from src.usecases import callcheck_login
        from src.usecases.callcheck_login import initiate_auth_call

        stub = StubCallcheckProvider()
        monkeypatch.setattr(
            callcheck_login, "get_callcheck_transport", lambda: stub
        )

        initiation = await initiate_auth_call(
            db_session, phone=PHONE, client_ip="203.0.113.7"
        )

        assert initiation is not None
        assert stub.create_calls == [(PHONE, "203.0.113.7")]

    async def test_malformed_ip_becomes_none(self, db_session, monkeypatch) -> None:
        """A non-IP string (the TestClient host, a crafted header value)
        is NEVER forwarded — the provider gets ``None`` instead."""
        from src.usecases import callcheck_login
        from src.usecases.callcheck_login import initiate_auth_call

        stub = StubCallcheckProvider()
        monkeypatch.setattr(
            callcheck_login, "get_callcheck_transport", lambda: stub
        )

        initiation = await initiate_auth_call(
            db_session, phone=PHONE, client_ip="testclient"
        )

        assert initiation is not None
        assert stub.create_calls == [(PHONE, None)]

    async def test_ipv6_passed_to_provider(self, db_session, monkeypatch) -> None:
        from src.usecases import callcheck_login
        from src.usecases.callcheck_login import initiate_auth_call

        stub = StubCallcheckProvider()
        monkeypatch.setattr(
            callcheck_login, "get_callcheck_transport", lambda: stub
        )

        await initiate_auth_call(
            db_session, phone=PHONE, client_ip="2001:db8::1"
        )
        assert stub.create_calls == [(PHONE, "2001:db8::1")]


# ─── Origin-vs-CORS line (the OTP-route posture) ──────────────────────────────


class TestOriginLine:
    def test_foreign_origin_403(
        self, api_client, stub_provider, pinned_origins
    ) -> None:
        resp = _initiate(api_client, origin="https://evil.example")
        assert resp.status_code == 403
        assert stub_provider.create_calls == [], "403 fires before any work"

    def test_listed_origin_passes(
        self, api_client, stub_provider, pinned_origins
    ) -> None:
        resp = _initiate(api_client, origin="http://localhost:3000")
        assert resp.status_code == 202

    def test_missing_origin_header_passes(
        self, api_client, stub_provider, pinned_origins
    ) -> None:
        resp = api_client.post(INITIATE_URL, json={"phone": PHONE})
        assert resp.status_code == 202
