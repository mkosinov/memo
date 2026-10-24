"""GH #499 §4.1: OTP storage layer — TTL, rotation, consumption, limits.

Service-level tests of the Task 2 storage layer (the HTTP endpoints are
Task 3). Covers the §4.1 / US-4 server-side contract:
- issue: exactly one hashed row per phone (HMAC-SHA-256 keyed with the
  env-sourced ``OTP_PEPPER``, never flat SHA-256, raw code never stored),
  5-minute TTL;
- rotation: a new send replaces the previous code (one row per phone);
- verify: constant-time compare, atomic one-time consumption on success,
  expired rows purged on phone access;
- limits — one 15-minute window in the existing in-memory counter store:
  5 sends/phone, 20/IP shared by sends and verify failures, max 5
  distinct phones/IP, 5 failed inputs/phone; code rotation does NOT
  reset the attempt budget (§4.1);
- settings: the pepper fails fast in production, dev constant otherwise
  (``SECRET_KEY`` pattern).

Spec: docs/specs/2026-10-20-web-client-auth-booking-design.md §4.1
Domain rules: docs/domain-rules/auth.md «Клиентская аутентификация (#499)»
"""

import hashlib
import hmac
from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import select, update

from src.auth.otp import OTP_TTL, OtpCode
from src.core.config import Settings, settings
from src.errors import ErrorCode
from src.util.utc import utc_now

pytestmark = pytest.mark.integration

PHONE = "+79995551122"
IP = "203.0.113.7"


# ─── Fixtures ──────────────────────────────────────────────────────────────────


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
def otp_service():
    from src.auth.otp_service import OtpService

    return OtpService()


def _expected_hash(code: str) -> str:
    """The §4.1 formula: HMAC-SHA-256 with the configured pepper."""
    return hmac.new(
        settings.OTP_PEPPER.encode("utf-8"),
        code.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _wrong_code(code: str) -> str:
    """A 6-digit code guaranteed different from ``code``."""
    return "999999" if code != "999999" else "999998"


async def _fetch_rows(db_session) -> list:
    result = await db_session.execute(select(OtpCode).where(OtpCode.phone == PHONE))
    return list(result.scalars().all())


# ─── Issue: hashing + TTL ──────────────────────────────────────────────────────


class TestOtpIssue:
    async def test_issue_writes_one_hashed_row_with_5min_ttl(
        self, db_session, otp_service,
    ) -> None:
        before = utc_now()
        code = await otp_service.issue(db_session, PHONE, IP)
        after = utc_now()

        assert len(code) == 6
        assert code.isdigit()

        rows = await _fetch_rows(db_session)
        assert len(rows) == 1
        row = rows[0]
        # The raw code is never stored, and the hash is keyed HMAC, not a
        # flat SHA-256 of the tiny 6-digit space (§4.1).
        assert row.code_hash != code
        assert row.code_hash != hashlib.sha256(code.encode("utf-8")).hexdigest()
        assert hmac.compare_digest(row.code_hash, _expected_hash(code))
        assert before <= row.created_at <= after
        assert row.expires_at - row.created_at == OTP_TTL
        assert timedelta(minutes=5) == OTP_TTL

    async def test_issue_rotates_previous_code(
        self, db_session, otp_service,
    ) -> None:
        code1 = await otp_service.issue(db_session, PHONE, IP)
        code2 = await otp_service.issue(db_session, PHONE, IP)

        rows = await _fetch_rows(db_session)
        assert len(rows) == 1  # one live code per phone — replace, not append
        assert hmac.compare_digest(rows[0].code_hash, _expected_hash(code2))

        if code1 != code2:  # 1-in-10^6 collision makes them indistinguishable
            assert await otp_service.verify(db_session, PHONE, code1, IP) is False
        assert await otp_service.verify(db_session, PHONE, code2, IP) is True


# ─── Verify: consumption, expiry purge ─────────────────────────────────────────


class TestOtpVerify:
    async def test_verify_success_consumes_code_once(
        self, db_session, otp_service,
    ) -> None:
        code = await otp_service.issue(db_session, PHONE, IP)

        assert await otp_service.verify(db_session, PHONE, code, IP) is True
        assert await _fetch_rows(db_session) == []  # atomically absorbed

        # One-time: the same code cannot be replayed.
        assert await otp_service.verify(db_session, PHONE, code, IP) is False

    async def test_verify_wrong_code_fails_and_keeps_row(
        self, db_session, otp_service,
    ) -> None:
        code = await otp_service.issue(db_session, PHONE, IP)
        stored_hash = (await _fetch_rows(db_session))[0].code_hash

        assert await otp_service.verify(db_session, PHONE, _wrong_code(code), IP) is False

        rows = await _fetch_rows(db_session)
        assert len(rows) == 1
        assert rows[0].code_hash == stored_hash  # a failed guess does not consume

    async def test_verify_unknown_phone_fails(self, db_session, otp_service) -> None:
        assert await otp_service.verify(db_session, PHONE, "123456", IP) is False

    async def test_verify_expired_code_fails_and_purges_row(
        self, db_session, otp_service,
    ) -> None:
        code = await otp_service.issue(db_session, PHONE, IP)
        await db_session.execute(
            update(OtpCode)
            .where(OtpCode.phone == PHONE)
            .values(expires_at=utc_now() - timedelta(seconds=1))
        )

        assert await otp_service.verify(db_session, PHONE, code, IP) is False
        assert await _fetch_rows(db_session) == []  # expired rows purged on access


# ─── Attempt limits (5 failed inputs / 15 min / phone) ─────────────────────────


class TestOtpAttemptLimits:
    async def test_sixth_attempt_locked_out_after_five_failures(
        self, db_session, otp_service,
    ) -> None:
        code = await otp_service.issue(db_session, PHONE, IP)
        wrong = _wrong_code(code)

        for _ in range(5):
            assert await otp_service.verify(db_session, PHONE, wrong, IP) is False

        with pytest.raises(HTTPException) as exc_info:
            await otp_service.verify(db_session, PHONE, code, IP)  # even the CORRECT code
        assert exc_info.value.status_code == 429
        assert exc_info.value.detail["code"] == ErrorCode.AUTH_LOCKED_OUT.value
        assert "Retry-After" in (exc_info.value.headers or {})

    async def test_rotation_does_not_reset_attempt_budget(
        self, db_session, otp_service,
    ) -> None:
        code = await otp_service.issue(db_session, PHONE, IP)
        wrong = _wrong_code(code)

        for _ in range(3):
            assert await otp_service.verify(db_session, PHONE, wrong, IP) is False

        fresh_code = await otp_service.issue(db_session, PHONE, IP)  # rotation

        for _ in range(2):
            assert await otp_service.verify(db_session, PHONE, wrong, IP) is False

        # 5 failures counted across the rotation — the 6th attempt is locked.
        with pytest.raises(HTTPException) as exc_info:
            await otp_service.verify(db_session, PHONE, fresh_code, IP)
        assert exc_info.value.status_code == 429

    async def test_verify_failures_count_into_shared_ip_counter(
        self, db_session, otp_service,
    ) -> None:
        from src.auth import service as service_module

        code = await otp_service.issue(db_session, PHONE, IP)
        # 19 events already on the shared IP window — one more verify
        # failure must trip the 20/IP wire (§4.1).
        service_module._FAILURE_COUNTERS[f"otp:ip:{IP}"] = (19, utc_now())

        with pytest.raises(HTTPException) as exc_info:
            await otp_service.verify(db_session, PHONE, _wrong_code(code), IP)
        assert exc_info.value.status_code == 429
        assert exc_info.value.detail["code"] == ErrorCode.AUTH_LOCKED_OUT.value


# ─── Send limits (5/phone, 20/IP, 5 distinct phones/IP — one 15-min window) ────


class TestOtpSendLimits:
    async def test_sixth_send_per_phone_locked_out(
        self, db_session, otp_service,
    ) -> None:
        for _ in range(5):
            await otp_service.issue(db_session, PHONE, IP)

        with pytest.raises(HTTPException) as exc_info:
            await otp_service.issue(db_session, PHONE, IP)
        assert exc_info.value.status_code == 429
        assert exc_info.value.detail["code"] == ErrorCode.AUTH_LOCKED_OUT.value
        assert "Retry-After" in (exc_info.value.headers or {})

    async def test_sixth_distinct_phone_per_ip_locked_out(
        self, db_session, otp_service,
    ) -> None:
        for i in range(5):
            await otp_service.issue(db_session, f"+7999555110{i}", IP)

        with pytest.raises(HTTPException) as exc_info:
            await otp_service.issue(db_session, "+79995551199", IP)
        assert exc_info.value.status_code == 429
        assert exc_info.value.detail["code"] == ErrorCode.AUTH_LOCKED_OUT.value

    async def test_ip_send_limit_twenty_blocks_twenty_first_send(
        self, db_session, otp_service,
    ) -> None:
        # 20 sends from one IP spread over 5 phones (the distinct-phone
        # cap): each phone sits at 4 sends — its own 5-limit is NOT
        # tripped, so the 21st send is blocked by the IP wire alone.
        for i in range(5):
            for _ in range(4):
                await otp_service.issue(db_session, f"+7999555110{i}", IP)

        with pytest.raises(HTTPException) as exc_info:
            await otp_service.issue(db_session, "+79995551100", IP)
        assert exc_info.value.status_code == 429
        assert exc_info.value.detail["code"] == ErrorCode.AUTH_LOCKED_OUT.value

    async def test_send_limit_window_expires_after_15_minutes(
        self, db_session, otp_service,
    ) -> None:
        from src.auth import service as service_module

        # A saturated counter whose window has expired must not block —
        # the next send restarts the window (fixed-window semantics).
        service_module._FAILURE_COUNTERS[f"otp_send:phone:{PHONE}"] = (
            5, utc_now() - timedelta(minutes=16),
        )

        code = await otp_service.issue(db_session, PHONE, IP)
        assert len(code) == 6


# ─── Pepper setting (SECRET_KEY pattern) ───────────────────────────────────────


@pytest.mark.pure_unit
class TestOtpPepperSetting:
    def test_production_empty_pepper_fails_fast(self) -> None:
        with pytest.raises(ValueError, match="OTP_PEPPER"):
            Settings(_env_file=None, ENV="production", SECRET_KEY="set")

    def test_dev_empty_pepper_resolves_to_dev_constant(self) -> None:
        assert Settings(_env_file=None, ENV="development").OTP_PEPPER == "dev-otp-pepper"
