"""GH #499 §4.2 — OTP endpoints + transport: the HTTP contract (Task 3).

Covers the spec §4.2 / US-4 server-side contract on top of the Task 2
storage layer (``src/auth/otp_service.py`` — issue/verify/absorb/rate
limits are called, not reimplemented):

- ``POST /api/v1/auth/otp/request`` — domain phone validation (422
  ``PHONE_INVALID``), ALWAYS 202 on a valid number, staff phones are
  silently skipped (no code row, no dev_code — no enumeration oracle),
  503 ``NOTIFY_TRANSPORT_UNAVAILABLE`` without a configured transport
  (fail-closed in EVERY environment), ``dev_code`` only under the exact
  ``ENV == "development"`` + dev transport, masked dev log (no raw code);
- ``POST /api/v1/auth/otp/verify`` — atomic code absorption, the client
  account find-or-create flow (§3: active-card exact-phone lookup with
  the first-active stable sort, ``UserSettings`` in the same
  transaction, ``phone_is_confirmed=true``, insert-conflict idempotency),
  the ``memo_client_session`` cookie on success, ONE unified failure
  answer for wrong/expired/unknown codes;
- both endpoints: Origin check against the CORS list when the header is
  present (mismatch → 403), 429 rate limits surfaced through the API.

Spec: docs/specs/2026-10-20-web-client-auth-booking-design.md §3, §4.2
Domain rules: docs/domain-rules/auth.md («Клиентская аутентификация (#499)»,
«Public Access», «CSRF Posture»), docs/domain-rules/clients.md (phone lookup)
"""

from __future__ import annotations

import logging

import pytest

from src.core.config import settings
from src.errors import ErrorCode
from tests.conftest import insert_user, query_db

pytestmark = pytest.mark.api

PHONE = "+79995552233"
OTHER_PHONE = "+79995552299"

REQUEST_URL = "/api/v1/auth/otp/request"
VERIFY_URL = "/api/v1/auth/otp/verify"


# ─── fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _clear_otp_counters():
    """Isolate the module-level in-memory counter stores between tests."""
    from src.auth import service as service_module

    service_module._FAILURE_COUNTERS.clear()
    service_module._OTP_PHONES_PER_IP.clear()
    yield
    service_module._FAILURE_COUNTERS.clear()
    service_module._OTP_PHONES_PER_IP.clear()


@pytest.fixture
def dev_transport(monkeypatch):
    """The dev transport: exact ``ENV == "development"`` + ``OTP_TRANSPORT=dev``.

    Tests run with the settings default ``ENV=development``; the fixture
    pins BOTH knobs explicitly so the precondition is visible and stable.
    """
    monkeypatch.setattr(settings, "ENV", "development")
    monkeypatch.setattr(settings, "OTP_TRANSPORT", "dev")


@pytest.fixture
def pinned_origins(monkeypatch):
    """A concrete CORS list (the .env.test default is ``*`` — allow-all)."""
    monkeypatch.setattr(settings, "CORS_ORIGINS", ["http://localhost:3000"])


def _request_code(client, phone: str = PHONE, origin: str | None = None):
    headers = {"Origin": origin} if origin else {}
    return client.post(REQUEST_URL, json={"phone": phone}, headers=headers)


def _verify_code(client, phone: str = PHONE, code: str = "000000", origin: str | None = None):
    headers = {"Origin": origin} if origin else {}
    return client.post(VERIFY_URL, json={"phone": phone, "code": code}, headers=headers)


def _dev_code(client, phone: str = PHONE) -> str:
    resp = _request_code(client, phone)
    assert resp.status_code == 202, resp.text
    code = resp.json().get("dev_code")
    assert code, f"dev transport must surface dev_code: {resp.text}"
    return code


def _otp_rows(phone: str = PHONE) -> list[dict]:
    return query_db(f"SELECT * FROM otp_codes WHERE phone = '{phone}'")


def _client_rows(phone: str = PHONE) -> list[dict]:
    return query_db(f"SELECT * FROM clients WHERE phone = '{phone}' ORDER BY created_at, id")


def _user_row(phone: str):
    rows = query_db(f"SELECT * FROM users WHERE phone = '{phone}'")
    return rows[0] if rows else None


SET_COOKIE = "set-cookie"


# ─── POST /otp/request — 202-always, silence, validation ───────────────────────


class TestOtpRequest:
    def test_valid_phone_202_code_issued(self, api_client, dev_transport) -> None:
        resp = _request_code(api_client)
        assert resp.status_code == 202, resp.text

        code = resp.json().get("dev_code")
        assert code is not None and len(code) == 6 and code.isdigit()

        rows = _otp_rows()
        assert len(rows) == 1, "exactly one live code row per phone"
        assert rows[0]["code_hash"] != code, "raw code never stored"

    def test_blank_phone_422_domain_code(self, api_client, dev_transport) -> None:
        resp = _request_code(api_client, phone="   ")
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == ErrorCode.PHONE_INVALID.value

    def test_overlong_phone_422_domain_code(self, api_client, dev_transport) -> None:
        resp = _request_code(api_client, phone="9" * 21)
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == ErrorCode.PHONE_INVALID.value

    def test_staff_phone_silently_skipped(
        self,
        api_client,
        dev_transport,
    ) -> None:
        """A staff phone is indistinguishable: 202, but no code is generated,
        sent, or surfaced — no enumeration oracle (§4.2)."""
        insert_user(PHONE, "some-hash", role="master")

        resp = _request_code(api_client)
        assert resp.status_code == 202, resp.text
        assert "dev_code" not in resp.json(), "no code exists to surface"
        assert _otp_rows() == [], "no code row for a staff phone"

    def test_client_account_phone_still_gets_codes(
        self,
        api_client,
        dev_transport,
    ) -> None:
        """A phone held by a CLIENT account is NOT a staff phone — a
        returning client must be able to re-login (§4.2)."""
        insert_user(OTHER_PHONE, None, role="client")
        resp = _request_code(api_client, phone=OTHER_PHONE)
        assert resp.status_code == 202
        assert len(_otp_rows(OTHER_PHONE)) == 1

    def test_no_transport_503_fail_closed(self, api_client, monkeypatch) -> None:
        """Default settings (no transport configured) → 503 in EVERY
        environment; the code is not issued (§4.2 fail-closed)."""
        monkeypatch.setattr(settings, "OTP_TRANSPORT", "")
        resp = _request_code(api_client)
        assert resp.status_code == 503
        assert resp.json()["detail"]["code"] == ErrorCode.NOTIFY_TRANSPORT_UNAVAILABLE.value
        assert _otp_rows() == [], "fail-closed fires before issuing"

    def test_dev_transport_refused_outside_development(
        self,
        api_client,
        monkeypatch,
    ) -> None:
        """``OTP_TRANSPORT=dev`` + ENV != development → still 503 (staging,
        preview, testing — any environment except exactly development)."""
        monkeypatch.setattr(settings, "ENV", "testing")
        monkeypatch.setattr(settings, "OTP_TRANSPORT", "dev")
        resp = _request_code(api_client)
        assert resp.status_code == 503
        assert resp.json()["detail"]["code"] == ErrorCode.NOTIFY_TRANSPORT_UNAVAILABLE.value

    def test_unknown_transport_value_503(self, api_client, monkeypatch) -> None:
        monkeypatch.setattr(settings, "OTP_TRANSPORT", "banana")
        resp = _request_code(api_client)
        assert resp.status_code == 503

    def test_sixth_send_per_phone_429(self, api_client, dev_transport) -> None:
        for _ in range(5):
            assert _request_code(api_client).status_code == 202
        resp = _request_code(api_client)
        assert resp.status_code == 429
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_LOCKED_OUT.value
        assert "retry-after" in {h.lower() for h in resp.headers}


# ─── POST /otp/request — Origin check (§4.2) ───────────────────────────────────


class TestOtpRequestOrigin:
    def test_foreign_origin_403(self, api_client, dev_transport, pinned_origins) -> None:
        resp = _request_code(api_client, origin="https://evil.example")
        assert resp.status_code == 403

    def test_listed_origin_passes(
        self,
        api_client,
        dev_transport,
        pinned_origins,
    ) -> None:
        resp = _request_code(api_client, origin="http://localhost:3000")
        assert resp.status_code == 202

    def test_missing_origin_header_passes(
        self,
        api_client,
        dev_transport,
        pinned_origins,
    ) -> None:
        resp = api_client.post(REQUEST_URL, json={"phone": PHONE})
        assert resp.status_code == 202


# ─── POST /otp/verify — success, absorption, unified failure ──────────────────


class TestOtpVerifySuccess:
    def test_success_sets_client_session_cookie(
        self,
        api_client,
        dev_transport,
    ) -> None:
        code = _dev_code(api_client)
        resp = _verify_code(api_client, code=code)
        assert resp.status_code == 200, resp.text
        assert resp.json()["phone"] == PHONE
        assert "name" in resp.json()

        cookie = resp.headers.get(SET_COOKIE, "")
        assert cookie.startswith("memo_client_session=")
        assert "httponly" in cookie.lower()
        assert "samesite=lax" in cookie.lower()
        assert "path=/" in cookie.lower()
        assert "max-age=2592000" in cookie.lower()  # ABSOLUTE_CAP: 30 days
        assert "secure" not in cookie.lower(), "secure iff production"

        # The jar cookie actually drives the client cabinet.
        assert api_client.get("/api/v1/my/client").status_code == 200

    def test_code_absorbed_one_time(self, api_client, dev_transport) -> None:
        code = _dev_code(api_client)
        assert _verify_code(api_client, code=code).status_code == 200
        assert _otp_rows() == [], "success consumes the code row"

        replay = _verify_code(api_client, code=code)
        assert replay.status_code == 401
        assert replay.json()["detail"]["code"] == ErrorCode.AUTH_INVALID_CREDENTIALS.value

    def test_creates_account_card_settings(
        self,
        api_client,
        dev_transport,
    ) -> None:
        """§3: verify creates user(role=client, phone) + card (exact-phone
        find-or-create) + UserSettings in ONE transaction, and stamps
        phone_is_confirmed=true. The account is passwordless."""
        code = _dev_code(api_client)
        assert _verify_code(api_client, code=code).status_code == 200

        user = _user_row(PHONE)
        assert user is not None
        assert user["role"] == "client"
        assert user["password_hash"] is None
        assert user["phone_is_confirmed"] == 1
        assert user["is_active"] == 1

        cards = _client_rows()
        assert len(cards) == 1, "one card per phone on the create branch"
        assert user["client_id"] == cards[0]["id"]

        settings_rows = query_db(f"SELECT * FROM user_settings WHERE user_id = '{user['id']}'")
        assert len(settings_rows) == 1, "guaranteed child row (#319)"

    def test_reuses_existing_active_card(
        self,
        api_client,
        dev_transport,
    ) -> None:
        """An active card with this exact phone is REUSED (no duplicate)."""
        card_id = "card-reuse-0001"
        query_db(
            f"INSERT INTO clients (id, name, phone, is_active, created_at, updated_at) "
            f"VALUES ('{card_id}', 'Анна Существующая', '{PHONE}', 1, "
            f"datetime('now'), datetime('now'))"
        )
        code = _dev_code(api_client)
        resp = _verify_code(api_client, code=code)
        assert resp.status_code == 200
        assert resp.json()["name"] == "Анна Существующая"

        assert len(_client_rows()) == 1, "no duplicate card"
        user = _user_row(PHONE)
        assert user is not None
        assert user["client_id"] == card_id

    def test_archived_card_not_reused(
        self,
        api_client,
        dev_transport,
    ) -> None:
        """Archived cards are excluded from the lookup — verify creates a
        fresh active card instead (clients.md: active-only lookup)."""
        query_db(
            f"INSERT INTO clients (id, name, phone, is_active, created_at, updated_at) "
            f"VALUES ('card-arch-0001', 'В Архиве', '{PHONE}', 0, "
            f"datetime('now'), datetime('now'))"
        )
        code = _dev_code(api_client)
        assert _verify_code(api_client, code=code).status_code == 200

        user = _user_row(PHONE)
        assert user is not None
        assert user["client_id"] != "card-arch-0001"
        fresh = [c for c in _client_rows() if c["id"] == user["client_id"]]
        assert fresh and fresh[0]["is_active"] == 1

    def test_duplicate_active_cards_first_by_stable_sort(
        self,
        api_client,
        dev_transport,
    ) -> None:
        """Two active cards share the phone → bind to the FIRST active one
        under the stable sort (creation order, id tiebreak)."""
        query_db(
            f"INSERT INTO clients (id, name, phone, is_active, created_at, updated_at) "
            f"VALUES ('card-old-00001', 'Первая', '{PHONE}', 1, "
            f"'2026-01-01 00:00:00', '2026-01-01 00:00:00'), "
            f"('card-new-00001', 'Вторая', '{PHONE}', 1, "
            f"'2026-06-01 00:00:00', '2026-06-01 00:00:00')"
        )
        code = _dev_code(api_client)
        resp = _verify_code(api_client, code=code)
        assert resp.status_code == 200
        assert resp.json()["name"] == "Первая"
        user = _user_row(PHONE)
        assert user is not None
        assert user["client_id"] == "card-old-00001"
        assert len(_client_rows()) == 2, "existing cards are never touched"

    def test_idempotent_verify_single_account(
        self,
        api_client,
        dev_transport,
    ) -> None:
        """Two full login cycles on one phone → ONE account (§3 insert
        conflict idempotency at the observable level), a fresh session
        each time, the card not duplicated."""
        first = _verify_code(api_client, code=_dev_code(api_client))
        assert first.status_code == 200

        second = _verify_code(api_client, code=_dev_code(api_client))
        assert second.status_code == 200

        users = query_db(f"SELECT * FROM users WHERE phone = '{PHONE}'")
        assert len(users) == 1, "re-login reuses the account"
        assert len(_client_rows()) == 1, "card created exactly once"

        # The latest cookie drives the cabinet; the account answers.
        assert api_client.get("/api/v1/my/client").status_code == 200
        sessions = query_db(
            f"SELECT COUNT(*) AS n FROM sessions WHERE user_id = '{users[0]['id']}'"
        )
        assert sessions[0]["n"] == 2, "one session row per login"


class TestOtpVerifyFailure:
    def test_wrong_code_unified_401(self, api_client, dev_transport) -> None:
        code = _dev_code(api_client)
        resp = _verify_code(api_client, code="999998" if code != "999998" else "999997")
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_INVALID_CREDENTIALS.value
        assert len(_otp_rows()) == 1, "a failed guess does not consume the code"

    def test_unknown_phone_same_unified_answer(
        self,
        api_client,
        dev_transport,
    ) -> None:
        """No code row for this phone → the SAME 401 body as a wrong code
        (one answer, no state enumeration)."""
        wrong = _verify_code(api_client, phone=OTHER_PHONE, code="123456")
        assert wrong.status_code == 401

        _dev_code(api_client)  # a real row for PHONE
        real = _verify_code(api_client, code="123456")
        assert real.status_code == 401
        assert wrong.json()["detail"] == real.json()["detail"]

    def test_expired_code_same_unified_answer(
        self,
        api_client,
        dev_transport,
    ) -> None:
        code = _dev_code(api_client)
        query_db(
            f"UPDATE otp_codes SET expires_at = datetime('now', '-1 minute') "
            f"WHERE phone = '{PHONE}'"
        )
        resp = _verify_code(api_client, code=code)
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_INVALID_CREDENTIALS.value
        # The expiry purge itself is the Task 2 service-layer contract
        # (test_auth_otp.py) — at the HTTP level the 401 rolls the
        # request transaction back, and the lingering expired row is
        # inert (it can never verify; the next send rotates it away).

    def test_staff_phone_verify_always_fails(
        self,
        api_client,
        dev_transport,
    ) -> None:
        """No code can exist for a staff phone → verify refuses with the
        unified answer; a client account is NEVER created for it."""
        insert_user(PHONE, "some-hash", role="admin")
        _request_code(api_client)  # silent 202, no row
        resp = _verify_code(api_client, code="123456")
        assert resp.status_code == 401
        user = _user_row(PHONE)
        assert user is not None
        assert user["role"] == "admin", "staff account untouched"

    def test_blank_phone_422_domain_code(self, api_client, dev_transport) -> None:
        resp = _verify_code(api_client, phone="")
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == ErrorCode.PHONE_INVALID.value

    def test_sixth_wrong_attempt_429(self, api_client, dev_transport) -> None:
        _dev_code(api_client)
        for _ in range(5):
            resp = _verify_code(api_client, code="111111")
            assert resp.status_code == 401
        sixth = _verify_code(api_client, code="111111")
        assert sixth.status_code == 429
        assert sixth.json()["detail"]["code"] == ErrorCode.AUTH_LOCKED_OUT.value

    def test_foreign_origin_403(
        self,
        api_client,
        dev_transport,
        pinned_origins,
    ) -> None:
        code = _dev_code(api_client)
        resp = _verify_code(api_client, code=code, origin="https://evil.example")
        assert resp.status_code == 403
        assert len(_otp_rows()) == 1, "403 fires before any code work"


# ─── dev transport log masking (§4.2: no raw code in logs) ─────────────────────


class TestDevTransportLog:
    def test_dev_log_masks_raw_code(
        self,
        api_client,
        dev_transport,
        caplog,
    ) -> None:
        with caplog.at_level(logging.INFO, logger="memo.auth.otp_transport"):
            resp = _request_code(api_client)
        assert resp.status_code == 202
        code = resp.json()["dev_code"]

        logged = caplog.text
        assert PHONE in logged, "masked entry carries the phone"
        assert code not in logged, "the raw code never reaches the log"
