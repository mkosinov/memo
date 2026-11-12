"""GH #593 Task 2: callcheck storage — auth_calls + auth_call_attempts.

Storage-level tests of the Task 2 seam (the HTTP endpoints are Tasks
3–4). Covers spec §Хранение / plan DoD:

- ``save_initiated``: exactly one ``pending`` row per phone (``phone``
  is the PK — a new initiate REPLACES the row), the raw handle never
  touches the DB (only its pepper-keyed HMAC digest — the OTP
  mechanism, same pepper), and a journal row ``created`` is appended in
  the same transaction with a masked ``ip_hash`` (raw IP absent);
- replacement: after a new initiate on the same phone the OLD
  handle_hash is gone — the status-lookup seam returns None (the
  storage-level 404 of the DoD);
- TTL purge on touch (the ``otp_codes`` pattern): a row past
  window+margin is hard-deleted when its handle is looked up; a row
  inside the margin survives — the late-call tail is not cut (spec
  §Эндпоинты: a call in the last seconds of the window is still
  confirmed);
- the journal is append-only across initiates (one ``created`` row per
  initiate, ``checked_at`` NULL until a terminal outcome — Task 4).

Spec: docs/specs/2026-11-11-auth-callcheck-design.md §Хранение
Domain rules: docs/domain-rules/auth.md «Методы авторизации клиента (#593)»
"""

import hashlib
import hmac
from datetime import timedelta

import pytest
from sqlalchemy import select, update

from src.auth.callcheck import (
    ATTEMPT_OUTCOME_CREATED,
    AUTH_CALL_STATUS_PENDING,
    AuthCall,
    AuthCallAttempt,
    hash_handle,
)
from src.auth.callcheck_provider import CALLCHECK_WINDOW_SECONDS
from src.auth.callcheck_store import AUTH_CALL_PURGE_TTL, CallcheckStore
from src.core.config import settings
from src.util.utc import utc_now

pytestmark = pytest.mark.integration

PHONE = "+79995551122"
OTHER_PHONE = "+79995551133"
IP = "203.0.113.7"
CHECK_ID = "5f0c9d2e7b1a4c8d"
CALL_PHONE = "+78005553535"
OTHER_CALL_PHONE = "+78005553599"

HEX_DIGITS = set("0123456789abcdef")


# ─── Fixtures / helpers ────────────────────────────────────────────────────────


@pytest.fixture
def store() -> CallcheckStore:
    return CallcheckStore()


def _expected_hmac(value: str) -> str:
    """The OTP mechanism (§4.1): HMAC-SHA-256 with the auth pepper."""
    return hmac.new(
        settings.OTP_PEPPER.encode("utf-8"),
        value.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


async def _fetch_call(db_session, phone: str) -> AuthCall | None:
    return (
        await db_session.execute(
            select(AuthCall).where(AuthCall.phone == phone)
        )
    ).scalar_one_or_none()


async def _fetch_attempts(db_session, phone: str) -> list[AuthCallAttempt]:
    return list(
        (
            await db_session.execute(
                select(AuthCallAttempt).where(AuthCallAttempt.phone == phone)
            )
        )
        .scalars()
        .all()
    )


async def _backdate(db_session, phone: str, delta: timedelta) -> None:
    await db_session.execute(
        update(AuthCall)
        .where(AuthCall.phone == phone)
        .values(created_at=utc_now() - delta)
    )


# ─── save_initiated: row shape, hashing, journal ───────────────────────────────


class TestSaveInitiated:
    async def test_pending_row_hashed_handle_and_created_journal(
        self, db_session, store,
    ) -> None:
        before = utc_now()
        handle = await store.save_initiated(
            db_session,
            phone=PHONE,
            provider_check_id=CHECK_ID,
            call_phone=CALL_PHONE,
            client_ip=IP,
        )
        after = utc_now()

        # The handle handed back to the caller: uuid4-hex (the response
        # shape Task 3 returns; only the hash is persisted).
        assert len(handle) == 32
        assert set(handle) <= HEX_DIGITS

        row = await _fetch_call(db_session, PHONE)
        assert row is not None
        assert row.status == AUTH_CALL_STATUS_PENDING
        assert row.provider_check_id == CHECK_ID
        assert row.call_phone == CALL_PHONE
        assert before <= row.created_at <= after
        # The raw handle is never stored, and the digest is keyed HMAC,
        # not a flat SHA-256 (the §4.1 discipline).
        assert row.handle_hash != handle
        assert row.handle_hash != hashlib.sha256(handle.encode("utf-8")).hexdigest()
        assert hmac.compare_digest(row.handle_hash, _expected_hmac(handle))
        assert hmac.compare_digest(row.handle_hash, hash_handle(handle))

        attempts = await _fetch_attempts(db_session, PHONE)
        assert len(attempts) == 1
        attempt = attempts[0]
        assert attempt.outcome == ATTEMPT_OUTCOME_CREATED
        assert attempt.checked_at is None  # set only on terminal outcomes (Task 4)
        assert attempt.provider_check_id == CHECK_ID
        # ip_hash is a mask for incident analysis — the raw IP is absent.
        assert attempt.ip_hash == _expected_hmac(IP)
        assert attempt.ip_hash != IP
        # Journal id is a uuid string (the notification-attempt pattern).
        assert isinstance(attempt.id, str) and len(attempt.id) == 36


# ─── Replacement: PK semantics — the old handle dies ──────────────────────────


class TestReplacement:
    async def test_new_initiate_replaces_row_and_kills_old_handle(
        self, db_session, store,
    ) -> None:
        old_handle = await store.save_initiated(
            db_session,
            phone=PHONE,
            provider_check_id="old-check",
            call_phone=CALL_PHONE,
            client_ip=IP,
        )
        new_handle = await store.save_initiated(
            db_session,
            phone=PHONE,
            provider_check_id="new-check",
            call_phone=OTHER_CALL_PHONE,
            client_ip=IP,
        )

        assert old_handle != new_handle

        # One live row per phone — replace, not append (the otp pattern).
        rows = list(
            (
                await db_session.execute(
                    select(AuthCall).where(AuthCall.phone == PHONE)
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1
        assert rows[0].provider_check_id == "new-check"
        assert rows[0].call_phone == OTHER_CALL_PHONE
        assert rows[0].status == AUTH_CALL_STATUS_PENDING

        # The OLD handle_hash is absent after the upsert — the status
        # seam answers None (the storage-level 404, DoD).
        assert await store.find_by_handle(db_session, old_handle) is None
        found = await store.find_by_handle(db_session, new_handle)
        assert found is not None
        assert found.provider_check_id == "new-check"

    async def test_unknown_handle_not_found(self, db_session, store) -> None:
        assert await store.find_by_handle(db_session, "0" * 32) is None

    async def test_journal_append_only_across_initiates(
        self, db_session, store,
    ) -> None:
        await store.save_initiated(
            db_session,
            phone=PHONE,
            provider_check_id="first",
            call_phone=CALL_PHONE,
            client_ip=IP,
        )
        await store.save_initiated(
            db_session,
            phone=PHONE,
            provider_check_id="second",
            call_phone=OTHER_CALL_PHONE,
            client_ip=IP,
        )

        attempts = await _fetch_attempts(db_session, PHONE)
        assert len(attempts) == 2  # append-only: replacement kills the row, not the journal
        assert {a.provider_check_id for a in attempts} == {"first", "second"}
        assert all(a.outcome == ATTEMPT_OUTCOME_CREATED for a in attempts)
        assert all(a.checked_at is None for a in attempts)


# ─── TTL purge on touch (window + margin, the otp_codes pattern) ──────────────


class TestTtlPurge:
    async def test_find_by_handle_purges_row_past_ttl(
        self, db_session, store,
    ) -> None:
        # The purge TTL is the window plus a margin — the margin guards
        # the late-call tail; 60 s of headroom over the 300 s window.
        assert timedelta(
            seconds=CALLCHECK_WINDOW_SECONDS + 60,
        ) == AUTH_CALL_PURGE_TTL

        handle = await store.save_initiated(
            db_session,
            phone=PHONE,
            provider_check_id=CHECK_ID,
            call_phone=CALL_PHONE,
            client_ip=IP,
        )
        await _backdate(db_session, PHONE, AUTH_CALL_PURGE_TTL + timedelta(seconds=1))

        assert await store.find_by_handle(db_session, handle) is None
        assert await _fetch_call(db_session, PHONE) is None  # hard-deleted on touch

    async def test_purge_touches_only_the_expired_row(
        self, db_session, store,
    ) -> None:
        expired_handle = await store.save_initiated(
            db_session,
            phone=PHONE,
            provider_check_id=CHECK_ID,
            call_phone=CALL_PHONE,
            client_ip=IP,
        )
        fresh_handle = await store.save_initiated(
            db_session,
            phone=OTHER_PHONE,
            provider_check_id="other-check",
            call_phone=OTHER_CALL_PHONE,
            client_ip=IP,
        )
        await _backdate(db_session, PHONE, AUTH_CALL_PURGE_TTL + timedelta(seconds=1))

        assert await store.find_by_handle(db_session, expired_handle) is None
        # A fresh row of another phone survives the touch (scoped purge).
        found = await store.find_by_handle(db_session, fresh_handle)
        assert found is not None
        assert found.phone == OTHER_PHONE

    async def test_row_past_window_but_inside_margin_survives(
        self, db_session, store,
    ) -> None:
        handle = await store.save_initiated(
            db_session,
            phone=PHONE,
            provider_check_id=CHECK_ID,
            call_phone=CALL_PHONE,
            client_ip=IP,
        )
        # 30 s past the window, still 30 s inside the margin — the row
        # must survive the purge so a late call can still confirm (the
        # window tail is not cut, spec §Эндпоинты).
        await _backdate(
            db_session, PHONE, timedelta(seconds=CALLCHECK_WINDOW_SECONDS + 30),
        )

        found = await store.find_by_handle(db_session, handle)
        assert found is not None
        assert found.status == AUTH_CALL_STATUS_PENDING
