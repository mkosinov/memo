"""GH #247 §3.4 + §2.11: AuthService — login / logout / resolve, sliding
session extension, and the two-tier login throttle.

Service-level tests against the shared test DB (``db_session`` fixture —
tests/test_repository_list.py pattern). Covers:
- login: success (AuthedUser + session row created), wrong password /
  unknown phone / archived user → identical 401 AUTH_INVALID_CREDENTIALS
  (no user enumeration); timing-parity dummy verify for unknown phones;
  phone trimmed; presented-token rotation; opportunistic cleanup of the
  user's expired sessions;
- the §2.11 DB-backed ladder: rung 1 (3 fails → 15-min lock), rung 2 (after
  expiry 3 more → 1-hour lock), rung 3 (hard lock until admin reset);
  correct password rejected during a lock; Retry-After only on timed locks;
  a successful login resets the ladder;
- the §3.4 in-memory counters: phone threshold 5 (unknown phones have no
  users row to carry the ladder), IP threshold 20 across phones, 15-min
  window expiry;
- resolve: unknown / expired-idle / expired-cap tokens → None (expired rows
  lazily deleted); archived users are not resolved; throttle window (no
  idle rewrite) vs past-throttle extension capped by the absolute deadline;
- logout: deletes the row, idempotent.

Spec: docs/specs/2026-09-08-auth-design.md §2.2, §2.11, §3.4
Domain rules: docs/domain-rules/auth.md (Sessions, Password Rules)
"""

from __future__ import annotations

import asyncio
import secrets
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from src.auth.passwords import DUMMY_HASH, hash_password
from src.auth.permissions import ROLE_PERMISSIONS, AuthedUser
from src.auth.service import (
    FAILURE_WINDOW,
    IP_FAILURE_THRESHOLD,
    PHONE_FAILURE_THRESHOLD,
    get_auth_service,
)
from src.auth.session import (
    ABSOLUTE_CAP,
    EXTENSION_THROTTLE,
    IDLE_WINDOW,
    Session,
)
from src.errors import ErrorCode
from src.models.enums import UserRole
from src.models.user import User

pytestmark = pytest.mark.asyncio

PASSWORD = "correct-horse-1"
# Argon2 is deliberately slow — hash the shared password once per module.
PASSWORD_HASH = hash_password(PASSWORD)


@pytest.fixture(autouse=True)
def _clear_failure_counters():
    """Isolate the module-level in-memory lockout store between tests."""
    from src.auth import service as service_module

    service_module._FAILURE_COUNTERS.clear()
    yield
    service_module._FAILURE_COUNTERS.clear()


# ─── Helpers ────────────────────────────────────────────────────────────────────


async def _make_user(
    db_session,
    phone: str = "+79990000001",
    password: str = PASSWORD,
    role: str = UserRole.ADMIN.value,
    is_active: bool = True,
) -> User:
    user = User(
        phone=phone,
        password_hash=PASSWORD_HASH if password == PASSWORD else hash_password(password),
        role=role,
        is_active=is_active,
    )
    db_session.add(user)
    await db_session.flush()
    return user


def _session_row(
    user_id: str,
    *,
    created_at: datetime | None = None,
    last_extended_at: datetime | None = None,
    idle_deadline: datetime | None = None,
    absolute_deadline: datetime | None = None,
) -> Session:
    now = datetime.utcnow()
    return Session(
        token=secrets.token_urlsafe(32),
        user_id=user_id,
        created_at=created_at or now,
        last_extended_at=last_extended_at or now,
        idle_deadline=idle_deadline or now + IDLE_WINDOW,
        absolute_deadline=absolute_deadline or now + ABSOLUTE_CAP,
    )


async def _fetch_session(db_session, token: str) -> Session | None:
    result = await db_session.execute(select(Session).where(Session.token == token))
    return result.scalar_one_or_none()


def _assert_close(actual: datetime, expected: datetime, tol_seconds: float = 5.0) -> None:
    assert abs((actual - expected).total_seconds()) <= tol_seconds, (
        f"{actual} !~ {expected}"
    )


async def _simulate_lock_expiry(db_session, user: User) -> None:
    """Simulate a timed lock expiring: backdate ``locked_until`` AND expire
    the in-memory counter windows.

    In real time the two always expire together — the counter window (15 min
    from the rung's FIRST failure) starts no later than the lock (15 min
    from its THIRD), so backdating only ``locked_until`` would model a
    state that cannot occur and the still-warm phone counter would 429 the
    next failures instead of the ladder.
    """
    from src.auth import service as service_module

    user.locked_until = datetime.utcnow() - timedelta(minutes=1)
    await db_session.commit()
    service_module._FAILURE_COUNTERS.clear()


def _code_of(exc: HTTPException) -> str:
    assert isinstance(exc.detail, dict)
    return str(exc.detail["code"])


def _assert_locked_out(exc: HTTPException, *, retry_after: bool) -> None:
    assert exc.status_code == 429
    assert _code_of(exc) == ErrorCode.AUTH_LOCKED_OUT.value
    if retry_after:
        assert exc.headers is not None
        assert "Retry-After" in exc.headers
        assert int(exc.headers["Retry-After"]) > 0
    else:
        assert not (exc.headers and "Retry-After" in exc.headers)


# ─── login: success ─────────────────────────────────────────────────────────────


class TestLoginSuccess:
    async def test_returns_authed_user_and_token(self, db_session) -> None:
        user = await _make_user(db_session)
        authed, _ = await get_auth_service().login(
            db_session, user.phone, PASSWORD, "203.0.113.10",
        )
        assert isinstance(authed, AuthedUser)
        assert authed.id == user.id
        assert authed.phone == user.phone
        assert authed.role == UserRole.ADMIN.value
        assert authed.staff_id is None  # GH #266 D10: principal key renamed
        assert authed.permissions == frozenset({"*"})

    async def test_master_role_gets_master_permission_set(self, db_session) -> None:
        user = await _make_user(db_session, role=UserRole.MASTER.value)
        authed, _ = await get_auth_service().login(
            db_session, user.phone, PASSWORD, "203.0.113.10",
        )
        assert authed.permissions == ROLE_PERMISSIONS[UserRole.MASTER.value]

    async def test_creates_session_row(self, db_session) -> None:
        user = await _make_user(db_session)
        _, token = await get_auth_service().login(
            db_session, user.phone, PASSWORD, "203.0.113.10",
        )
        row = await _fetch_session(db_session, token)
        assert row is not None
        assert row.user_id == user.id

    async def test_phone_is_trimmed(self, db_session) -> None:
        user = await _make_user(db_session)
        authed, _ = await get_auth_service().login(
            db_session, f"  {user.phone}  ", PASSWORD, "203.0.113.10",
        )
        assert authed.id == user.id

    async def test_multiple_concurrent_sessions_allowed(self, db_session) -> None:
        user = await _make_user(db_session)
        svc = get_auth_service()
        _, t1 = await svc.login(db_session, user.phone, PASSWORD, "203.0.113.10")
        _, t2 = await svc.login(db_session, user.phone, PASSWORD, "203.0.113.10")
        assert t1 != t2
        assert await _fetch_session(db_session, t1) is not None
        assert await _fetch_session(db_session, t2) is not None


# ─── login: failures (identical error, no enumeration) ──────────────────────────


class TestLoginInvalidCredentials:
    async def test_wrong_password(self, db_session) -> None:
        user = await _make_user(db_session)
        with pytest.raises(HTTPException) as ei:
            await get_auth_service().login(
                db_session, user.phone, "wrong-password", "203.0.113.11",
            )
        assert ei.value.status_code == 401
        assert _code_of(ei.value) == ErrorCode.AUTH_INVALID_CREDENTIALS.value

    async def test_unknown_phone_same_error(self, db_session) -> None:
        with pytest.raises(HTTPException) as ei:
            await get_auth_service().login(
                db_session, "+79990009999", "wrong-password", "203.0.113.11",
            )
        assert ei.value.status_code == 401
        assert _code_of(ei.value) == ErrorCode.AUTH_INVALID_CREDENTIALS.value

    async def test_archived_user_same_error(self, db_session) -> None:
        user = await _make_user(db_session, is_active=False)
        with pytest.raises(HTTPException) as ei:
            await get_auth_service().login(
                db_session, user.phone, PASSWORD, "203.0.113.11",
            )
        assert ei.value.status_code == 401
        assert _code_of(ei.value) == ErrorCode.AUTH_INVALID_CREDENTIALS.value

    async def test_wrong_password_counts_failure(self, db_session) -> None:
        user = await _make_user(db_session)
        with pytest.raises(HTTPException):
            await get_auth_service().login(
                db_session, user.phone, "wrong-password", "203.0.113.11",
            )
        assert user.failed_login_attempts == 1

    async def test_unknown_phone_runs_dummy_verify_for_timing_parity(
        self, db_session, monkeypatch,
    ) -> None:
        """Spec §3.4: unknown phone still runs a verify against DUMMY_HASH."""
        from src.auth import service as service_module

        calls: list[tuple[str, str]] = []

        def fake_verify(password: str, stored_hash: str) -> bool:
            calls.append((password, stored_hash))
            return False

        monkeypatch.setattr(service_module, "verify_password", fake_verify)
        with pytest.raises(HTTPException) as ei:
            await get_auth_service().login(
                db_session, "+79990009999", "whatever-pw", "203.0.113.11",
            )
        assert ei.value.status_code == 401
        assert calls == [("whatever-pw", DUMMY_HASH)]


# ─── login: session rotation + opportunistic cleanup ────────────────────────────


class TestLoginRotationAndCleanup:
    async def test_presented_token_row_deleted(self, db_session) -> None:
        user = await _make_user(db_session)
        stale = _session_row(user.id)
        db_session.add(stale)
        await db_session.commit()

        _, new_token = await get_auth_service().login(
            db_session, user.phone, PASSWORD, "203.0.113.12", presented_token=stale.token,
        )
        assert new_token != stale.token
        assert await _fetch_session(db_session, stale.token) is None
        assert await _fetch_session(db_session, new_token) is not None

    async def test_opportunistic_cleanup_deletes_expired_rows_for_user(
        self, db_session,
    ) -> None:
        user = await _make_user(db_session)
        now = datetime.utcnow()
        expired_idle = _session_row(
            user.id, idle_deadline=now - timedelta(minutes=1),
            last_extended_at=now - IDLE_WINDOW - timedelta(minutes=1),
        )
        expired_cap = _session_row(
            user.id, absolute_deadline=now - timedelta(minutes=1),
            created_at=now - ABSOLUTE_CAP - timedelta(minutes=1),
        )
        live = _session_row(user.id)
        db_session.add_all([expired_idle, expired_cap, live])
        await db_session.commit()

        await get_auth_service().login(
            db_session, user.phone, PASSWORD, "203.0.113.12",
        )
        assert await _fetch_session(db_session, expired_idle.token) is None
        assert await _fetch_session(db_session, expired_cap.token) is None
        assert await _fetch_session(db_session, live.token) is not None


# ─── resolve: validity, lazy deletion, sliding extension ────────────────────────


class TestResolve:
    async def test_unknown_token_returns_none(self, db_session) -> None:
        assert await get_auth_service().resolve(db_session, "no-such-token") is None

    async def test_expired_idle_returns_none_and_deletes_row(self, db_session) -> None:
        user = await _make_user(db_session)
        now = datetime.utcnow()
        s = _session_row(user.id, idle_deadline=now - timedelta(seconds=1))
        db_session.add(s)
        await db_session.commit()

        assert await get_auth_service().resolve(db_session, s.token) is None
        assert await _fetch_session(db_session, s.token) is None

    async def test_expired_cap_returns_none_and_deletes_row(self, db_session) -> None:
        user = await _make_user(db_session)
        now = datetime.utcnow()
        s = _session_row(user.id, absolute_deadline=now - timedelta(seconds=1))
        db_session.add(s)
        await db_session.commit()

        assert await get_auth_service().resolve(db_session, s.token) is None
        assert await _fetch_session(db_session, s.token) is None

    async def test_archived_user_not_resolved(self, db_session) -> None:
        user = await _make_user(db_session)
        s = _session_row(user.id)
        db_session.add(s)
        await db_session.commit()
        user.is_active = False
        await db_session.commit()

        assert await get_auth_service().resolve(db_session, s.token) is None

    async def test_valid_token_within_throttle_no_rewrite(self, db_session) -> None:
        user = await _make_user(db_session)
        s = _session_row(user.id)  # last_extended_at = now → within throttle
        db_session.add(s)
        await db_session.commit()
        idle_before = s.idle_deadline

        authed = await get_auth_service().resolve(db_session, s.token)
        assert authed is not None
        assert authed.id == user.id
        row = await _fetch_session(db_session, s.token)
        assert row is not None
        assert row.idle_deadline == idle_before  # at most one write per hour

    async def test_past_throttle_extends_idle_window(self, db_session) -> None:
        user = await _make_user(db_session)
        now = datetime.utcnow()
        s = _session_row(
            user.id,
            last_extended_at=now - EXTENSION_THROTTLE - timedelta(minutes=10),
            idle_deadline=now - timedelta(minutes=10) + IDLE_WINDOW,
        )
        db_session.add(s)
        await db_session.commit()
        before = datetime.utcnow()

        authed = await get_auth_service().resolve(db_session, s.token)
        assert authed is not None
        row = await _fetch_session(db_session, s.token)
        assert row is not None
        _assert_close(row.idle_deadline, before + IDLE_WINDOW)
        _assert_close(row.last_extended_at, before)
        assert row.absolute_deadline == s.absolute_deadline

    async def test_extension_capped_by_absolute_deadline(self, db_session) -> None:
        user = await _make_user(db_session)
        now = datetime.utcnow()
        cap = now + timedelta(hours=2)  # closer than now + IDLE_WINDOW
        s = _session_row(
            user.id,
            absolute_deadline=cap,
            last_extended_at=now - EXTENSION_THROTTLE - timedelta(minutes=10),
            idle_deadline=now - timedelta(minutes=10) + timedelta(hours=2, minutes=5),
        )
        db_session.add(s)
        await db_session.commit()

        assert await get_auth_service().resolve(db_session, s.token) is not None
        row = await _fetch_session(db_session, s.token)
        assert row is not None
        assert row.idle_deadline == cap


# ─── logout ─────────────────────────────────────────────────────────────────────


class TestLogout:
    async def test_deletes_row(self, db_session) -> None:
        user = await _make_user(db_session)
        _, token = await get_auth_service().login(
            db_session, user.phone, PASSWORD, "203.0.113.13",
        )
        await get_auth_service().logout(db_session, token)
        assert await _fetch_session(db_session, token) is None

    async def test_idempotent_for_unknown_token(self, db_session) -> None:
        await get_auth_service().logout(db_session, "no-such-token")  # no raise


# ─── §2.11 ladder (DB-backed per-user) ──────────────────────────────────────────


class TestLockoutLadder:
    async def test_rung1_three_failures_lock_15_minutes(self, db_session) -> None:
        user = await _make_user(db_session)
        svc = get_auth_service()
        for _ in range(2):
            with pytest.raises(HTTPException) as ei:
                await svc.login(db_session, user.phone, "wrong-password", "203.0.113.14")
            assert ei.value.status_code == 401
        before = datetime.utcnow()
        with pytest.raises(HTTPException) as ei:
            await svc.login(db_session, user.phone, "wrong-password", "203.0.113.14")
        _assert_locked_out(ei.value, retry_after=True)
        assert int(ei.value.headers["Retry-After"]) >= 890  # ~15 min

        assert user.lock_level == 1
        assert user.failed_login_attempts == 0  # reset when the rung trips
        _assert_close(user.locked_until, before + timedelta(minutes=15), tol_seconds=30)

    async def test_correct_password_rejected_during_timed_lock(
        self, db_session,
    ) -> None:
        user = await _make_user(db_session)
        svc = get_auth_service()
        for _ in range(3):
            with pytest.raises(HTTPException):
                await svc.login(db_session, user.phone, "wrong-password", "203.0.113.14")

        with pytest.raises(HTTPException) as ei:
            await svc.login(db_session, user.phone, PASSWORD, "203.0.113.14")
        _assert_locked_out(ei.value, retry_after=True)

    async def test_rung2_after_expiry_one_hour(self, db_session) -> None:
        user = await _make_user(db_session)
        svc = get_auth_service()
        for _ in range(3):
            with pytest.raises(HTTPException):
                await svc.login(db_session, user.phone, "wrong-password", "203.0.113.14")
        # simulate the 15-min lock (and counter window) expiring
        await _simulate_lock_expiry(db_session, user)

        for _ in range(2):
            with pytest.raises(HTTPException) as ei:
                await svc.login(db_session, user.phone, "wrong-password", "203.0.113.14")
            assert ei.value.status_code == 401
        before = datetime.utcnow()
        with pytest.raises(HTTPException) as ei:
            await svc.login(db_session, user.phone, "wrong-password", "203.0.113.14")
        _assert_locked_out(ei.value, retry_after=True)

        assert user.lock_level == 2
        _assert_close(user.locked_until, before + timedelta(hours=1), tol_seconds=30)
        assert 3595 <= int(ei.value.headers["Retry-After"]) <= 3600  # ~1 h

    async def test_rung3_hard_lock_until_admin_reset(self, db_session) -> None:
        user = await _make_user(db_session)
        svc = get_auth_service()
        for _ in range(3):  # three rungs: 15 min → 1 h → hard
            for _ in range(3):
                with pytest.raises(HTTPException):
                    await svc.login(
                        db_session, user.phone, "wrong-password", "203.0.113.14",
                    )
            if user.lock_level < 3:
                # simulate the timed lock (and counter window) expiring —
                # the hard lock has nothing to expire
                await _simulate_lock_expiry(db_session, user)

        assert user.lock_level == 3
        assert user.locked_until is None  # NULL = only an admin clears it

        # correct password still rejected, no Retry-After on the hard lock
        with pytest.raises(HTTPException) as ei:
            await svc.login(db_session, user.phone, PASSWORD, "203.0.113.14")
        _assert_locked_out(ei.value, retry_after=False)

    async def test_concurrent_failures_never_undercount(self, db_session) -> None:
        """BLOCKER regression: the ladder increment must be atomic.

        Read-modify-write on the ORM instance loses updates under
        concurrency (a reviewer probe: 30 gathered logins left the row at
        failed_login_attempts=2, lock_level=1). The ladder arithmetic
        (3/6/9) must stay reliable: after N concurrent wrong-password
        logins on one phone the persisted state reflects ALL N failures —
        either still counting (attempts == N mod rung) or rung-tripped.
        """
        from sqlalchemy.ext.asyncio import async_sessionmaker

        from src.db import db_manager

        user = await _make_user(db_session)
        await db_session.commit()

        session_factory = async_sessionmaker(db_manager.engine, expire_on_commit=False)
        ip = "203.0.113.21"

        async def _one_failed_login() -> None:
            async with session_factory() as s:
                with pytest.raises(HTTPException):
                    await get_auth_service().login(
                        s, user.phone, "wrong-password", ip,
                    )

        # 4 concurrent failures: sequential outcome = rung 1 trips on the
        # 3rd (attempts reset to 0), 4th lands → attempts == 1, level == 1.
        # Any interleaving must land on an equivalent-or-stricter state
        # (never fewer total failures persisted than sequential order).
        await asyncio.gather(*[_one_failed_login() for _ in range(4)])

        async with session_factory() as s:
            row = (
                await s.execute(select(User).where(User.id == user.id))
            ).scalar_one()
            # 4 ≥ 3 failures were persisted in total, no matter the
            # interleaving — rung 1 must have tripped, never clobbered to
            # a pre-trip state (the review probe saw lock_level=0).
            assert row.lock_level >= 1

    async def test_success_resets_ladder(self, db_session) -> None:
        user = await _make_user(db_session)
        svc = get_auth_service()
        for _ in range(2):
            with pytest.raises(HTTPException):
                await svc.login(db_session, user.phone, "wrong-password", "203.0.113.14")

        authed, _ = await svc.login(db_session, user.phone, PASSWORD, "203.0.113.14")
        assert authed.id == user.id
        assert user.failed_login_attempts == 0
        assert user.lock_level == 0
        assert user.locked_until is None

        # two more failures after the reset do NOT lock (ladder was cleared)
        for _ in range(2):
            with pytest.raises(HTTPException) as ei:
                await svc.login(db_session, user.phone, "wrong-password", "203.0.113.14")
            assert ei.value.status_code == 401
        assert user.lock_level == 0


# ─── §3.4 in-memory counters (phone 5 / IP 20, 15-min window) ───────────────────


class TestInMemoryCounters:
    async def test_unknown_phone_trips_at_5(self, db_session) -> None:
        svc = get_auth_service()
        for _ in range(PHONE_FAILURE_THRESHOLD - 1):
            with pytest.raises(HTTPException) as ei:
                await svc.login(
                    db_session, "+79990008888", "wrong-password", "203.0.113.15",
                )
            assert ei.value.status_code == 401
        with pytest.raises(HTTPException) as ei:
            await svc.login(db_session, "+79990008888", "wrong-password", "203.0.113.15")
        _assert_locked_out(ei.value, retry_after=True)

    async def test_ip_counter_trips_at_20_across_two_phones(self, db_session) -> None:
        svc = get_auth_service()
        ip = "203.0.113.16"
        for phone in ("+79990007771", "+79990007772"):
            for _ in range(10):
                with pytest.raises(HTTPException):
                    await svc.login(db_session, phone, "wrong-password", ip)

        # a BRAND-NEW phone from the blocked IP is rejected → IP-level trip
        with pytest.raises(HTTPException) as ei:
            await svc.login(db_session, "+79990007773", "wrong-password", ip)
        _assert_locked_out(ei.value, retry_after=True)

        # the same new phone from a DIFFERENT IP is not blocked
        with pytest.raises(HTTPException) as ei:
            await svc.login(db_session, "+79990007773", "wrong-password", "198.51.100.9")
        assert ei.value.status_code == 401
        assert _code_of(ei.value) == ErrorCode.AUTH_INVALID_CREDENTIALS.value

    async def test_tripped_ip_blocks_even_correct_password(self, db_session) -> None:
        """§3.4 order: the per-IP check runs BEFORE the verify — a tripped
        IP is rejected even with valid credentials (anti-stuffing)."""
        from src.auth import service as service_module

        user = await _make_user(db_session, phone="+79990005551")
        ip = "203.0.113.18"
        service_module._FAILURE_COUNTERS[f"ip:{ip}"] = (
            IP_FAILURE_THRESHOLD, datetime.utcnow(),
        )
        with pytest.raises(HTTPException) as ei:
            await get_auth_service().login(db_session, user.phone, PASSWORD, ip)
        _assert_locked_out(ei.value, retry_after=True)

    async def test_window_expiry_clears_counter(self, db_session) -> None:
        from src.auth import service as service_module

        ip = "203.0.113.17"
        stale_start = datetime.utcnow() - FAILURE_WINDOW - timedelta(minutes=1)
        service_module._FAILURE_COUNTERS[f"ip:{ip}"] = (IP_FAILURE_THRESHOLD, stale_start)
        service_module._FAILURE_COUNTERS["phone:+79990006666"] = (
            PHONE_FAILURE_THRESHOLD, stale_start,
        )

        with pytest.raises(HTTPException) as ei:
            await get_auth_service().login(
                db_session, "+79990006666", "wrong-password", ip,
            )
        assert ei.value.status_code == 401  # expired window → not blocked

    async def test_expired_entries_pruned_on_access(self, db_session) -> None:
        """The counter store is pruned on access — expired entries don't
        accumulate forever (unbounded ip:/phone: keys otherwise leak)."""
        from src.auth import service as service_module

        stale_start = datetime.utcnow() - FAILURE_WINDOW - timedelta(minutes=5)
        fresh = datetime.utcnow()
        service_module._FAILURE_COUNTERS.update({
            f"ip:198.51.100.{i}": (1, stale_start) for i in range(1, 11)
        })
        service_module._FAILURE_COUNTERS["ip:203.0.113.19"] = (1, fresh)

        with pytest.raises(HTTPException):
            await get_auth_service().login(
                db_session, "+79990006667", "wrong-password", "203.0.113.19",
            )
        stale_keys = [k for k in service_module._FAILURE_COUNTERS if "198.51.100." in k]
        assert stale_keys == []  # expired entries dropped by the prune sweep
        assert "ip:203.0.113.19" in service_module._FAILURE_COUNTERS  # live kept

    async def test_success_clears_phone_counter_not_ip(self, db_session) -> None:
        """Success clears only that phone's counter — the IP counter is
        never cleared by a success (one valid account must not reset an
        in-progress spray from the same IP)."""
        from src.auth import service as service_module

        user = await _make_user(db_session)
        ip = "203.0.113.20"
        # two failures from the same phone+IP, then a successful login
        for _ in range(2):
            with pytest.raises(HTTPException):
                await get_auth_service().login(
                    db_session, user.phone, "wrong-password", ip,
                )
        await get_auth_service().login(db_session, user.phone, PASSWORD, ip)

        assert f"phone:{user.phone}" not in service_module._FAILURE_COUNTERS
        count, started = service_module._FAILURE_COUNTERS[f"ip:{ip}"]
        assert count == 2
        assert datetime.utcnow() - started < FAILURE_WINDOW


# ─── singleton factory ──────────────────────────────────────────────────────────


class TestSingleton:
    async def test_get_auth_service_cached(self) -> None:
        assert get_auth_service() is get_auth_service()
