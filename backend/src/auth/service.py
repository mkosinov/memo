"""AuthService — login / logout / resolve + login throttling — GH #247 §3.4.

Two-tier brute-force throttle (spec §2.11 + §3.4):

* **DB-backed per-user ladder** (§2.11, user G2 decision) — the state lives
  on the ``users`` row (``failed_login_attempts`` / ``lock_level`` /
  ``locked_until``) so it survives restarts and is admin-resettable via
  sqladmin: 3 failures → 15-minute lock; after expiry 3 more → 1-hour
  lock; 3 more → hard lock until an administrator clears the fields. A
  locked account is rejected **even with the correct password**; timed
  locks carry ``Retry-After``, the hard lock does not (only an admin
  clears it). A successful login resets the ladder (the hard lock is the
  only state nothing but the admin clears).
* **In-memory secondary counters** (§3.4) — module-level
  ``dict[key, (count, window_start)]`` with a 15-minute window:
  ``"phone:<phone>"`` threshold 5 (covers unknown phones, which have no
  users row to carry the ladder) and ``"ip:<ip>"`` threshold 20 (slows
  credential stuffing across many accounts). Single-process runtime by
  design (#239-verified). Every failed attempt bumps BOTH counters — an
  attempt rejected because one counter tripped still feeds the other
  (that is what makes the IP trip wire work across sprayed phones).
  A successful login clears only that phone's counter; the IP counter is
  never cleared by a success (one valid account must not reset an
  in-progress spray from the same IP).

Login rotates the session: any token presented in the request is deleted
before the new session row is created (OWASP session-id rotation on
privilege change), and expired rows for the user are cleaned up
opportunistically.

Timing parity: an unknown phone runs the Argon2 verify against
``DUMMY_HASH`` anyway, so both branches take similar time — unknown phone
and wrong password are indistinguishable (no user enumeration).

Commit discipline: failure paths COMMIT the ladder mutation before
raising — ``get_db_session`` rolls back on exception, and losing the
increment would let brute-force reset the ladder by crashing requests.
``@transactional`` is deliberately NOT used here (it skips the commit on
the exception path, and auth is not an events-emitting entity).

Spec: docs/specs/2026-09-08-auth-design.md §2.2, §2.11, §3.4
Domain rules: docs/domain-rules/auth.md (Sessions)
"""

from __future__ import annotations

from datetime import datetime, timedelta
from functools import lru_cache
from typing import TYPE_CHECKING

from fastapi import HTTPException
from sqlalchemy import delete as sa_delete
from sqlalchemy import select

from src.auth.passwords import DUMMY_HASH, verify_password
from src.auth.permissions import ROLE_PERMISSIONS, AuthedUser
from src.auth.session import (
    EXTENSION_THROTTLE,
    IDLE_WINDOW,
    Session,
    new_session,
)
from src.errors import ErrorCode, ErrorDetail
from src.models.user import User

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

# ─── §3.4 in-memory secondary throttle ─────────────────────────────────────────

FAILURE_WINDOW = timedelta(minutes=15)
PHONE_FAILURE_THRESHOLD = 5
IP_FAILURE_THRESHOLD = 20

# Module-level counter store: key → (failure count, window start). The
# count resets whenever a failure arrives after the previous window
# expired (sliding 15-minute window, no background job).
_FAILURE_COUNTERS: dict[str, tuple[int, datetime]] = {}

# §2.11 ladder: failures per rung, and the lock each rung imposes.
_LADDER_RUNG_FAILURES = 3
_LADDER_LOCKS: dict[int, timedelta | None] = {
    1: timedelta(minutes=15),  # timed 15 min
    2: timedelta(hours=1),     # timed 1 h
    3: None,                   # hard — locked_until NULL, admin reset only
}


def _bump_counter(key: str, now: datetime) -> None:
    """Count a failure; restart the window if the previous one expired."""
    entry = _FAILURE_COUNTERS.get(key)
    if entry is None or now - entry[1] >= FAILURE_WINDOW:
        _FAILURE_COUNTERS[key] = (1, now)
        return
    _FAILURE_COUNTERS[key] = (entry[0] + 1, entry[1])


def _counter_exception(key: str, now: datetime) -> HTTPException | None:
    """429 (with Retry-After) when ``key``'s counter is at/over threshold.

    A counter whose window already expired never trips — the next failure
    restarts the window instead (``_bump_counter``). This guard matters
    for the pre-verify IP gate, which runs before any bump.
    """
    entry = _FAILURE_COUNTERS.get(key)
    if entry is None:
        return None
    count, started = entry
    if count < threshold_for(key):
        return None
    if now - started >= FAILURE_WINDOW:
        return None  # stale window — does not block
    remaining = max(1, int((FAILURE_WINDOW - (now - started)).total_seconds()))
    return AuthService._locked_out(retry_after=remaining)


def threshold_for(key: str) -> int:
    """Threshold for a counter key: ``ip:`` → 20, ``phone:`` → 5."""
    return IP_FAILURE_THRESHOLD if key.startswith("ip:") else PHONE_FAILURE_THRESHOLD


class AuthService:
    """Login / logout / session resolution with sliding-window sessions."""

    # ─── error factories ──────────────────────────────────────────────────

    @staticmethod
    def _invalid_credentials() -> HTTPException:
        """401 — identical shape for unknown phone and wrong password."""
        return HTTPException(
            status_code=401,
            detail=ErrorDetail(
                code=ErrorCode.AUTH_INVALID_CREDENTIALS,
                message="Неверный телефон или пароль",
            ).model_dump(),
        )

    @staticmethod
    def _locked_out(retry_after: int | None = None) -> HTTPException:
        """429 — timed locks carry Retry-After; the hard lock does not."""
        headers: dict[str, str] | None = (
            {"Retry-After": str(retry_after)} if retry_after is not None else None
        )
        return HTTPException(
            status_code=429,
            detail=ErrorDetail(
                code=ErrorCode.AUTH_LOCKED_OUT,
                message=(
                    "Слишком много неудачных попыток входа, попробуйте позже"
                    if retry_after is not None
                    else "Аккаунт заблокирован — обратитесь к администратору"
                ),
            ).model_dump(),
            headers=headers,
        )

    # ─── login ────────────────────────────────────────────────────────────

    async def login(
        self,
        db_session: AsyncSession,
        phone: str,
        password: str,
        client_ip: str,
        presented_token: str | None = None,
    ) -> tuple[AuthedUser, str]:
        """Verify phone + password; create a session and return the principal.

        Check order (spec §3.4): the §2.11 user ladder (a locked account is
        rejected even with the correct password), then the per-IP counter
        gate (a tripped IP is rejected even with the correct password),
        then the Argon2 verify with timing parity for unknown phones, then
        — on failure — the in-memory counters. Returns ``(AuthedUser,
        token)``.
        """
        now = datetime.utcnow()
        normalized = phone.strip()
        phone_key = f"phone:{normalized}"
        ip_key = f"ip:{client_ip}"

        user = (
            await db_session.execute(
                select(User).where(
                    User.phone == normalized, User.is_active == True,  # noqa: E712
                )
            )
        ).scalar_one_or_none()

        # ── §2.11 ladder: locked accounts never reach the verify ────────
        if user is not None:
            lock = self._ladder_check(user, now)
            if lock is not None:
                raise lock

        # ── per-IP secondary counter gate (§3.4): before the verify, so a
        # tripped IP is rejected even with valid credentials ────────────
        ip_lock = _counter_exception(ip_key, now)
        if ip_lock is not None:
            raise ip_lock

        # ── verify (timing parity for unknown phones) ───────────────────
        if user is None:
            # No row matched (unknown or archived phone): run the Argon2
            # verify against the dummy hash anyway so both branches take
            # similar time — no user enumeration via response timing.
            verify_password(password, DUMMY_HASH)
            _bump_counter(phone_key, now)
            _bump_counter(ip_key, now)
            raise (
                _counter_exception(phone_key, now)
                or _counter_exception(ip_key, now)
                or self._invalid_credentials()
            )

        if not verify_password(password, user.password_hash):
            user.failed_login_attempts += 1
            _bump_counter(phone_key, now)
            _bump_counter(ip_key, now)
            if user.failed_login_attempts >= _LADDER_RUNG_FAILURES:
                user.lock_level = min(user.lock_level + 1, 3)
                duration = _LADDER_LOCKS[user.lock_level]
                user.locked_until = now + duration if duration is not None else None
                user.failed_login_attempts = 0
            # COMMIT the ladder mutation before raising — the request
            # dependency rolls back on exception, and losing the increment
            # would reset the ladder on every locking attempt.
            await db_session.commit()
            raise (
                self._ladder_check(user, now)
                or _counter_exception(phone_key, now)
                or _counter_exception(ip_key, now)
                or self._invalid_credentials()
            )

        # ── success: reset the ladder, rotate, create, clean up ─────────
        user.failed_login_attempts = 0
        user.lock_level = 0
        user.locked_until = None
        _FAILURE_COUNTERS.pop(phone_key, None)

        if presented_token is not None:
            await db_session.execute(
                sa_delete(Session).where(Session.token == presented_token)
            )

        session = new_session(user.id)
        db_session.add(session)

        # Opportunistic cleanup: drop the user's expired rows (§3.3). The
        # freshly added row is flushed by the delete-execute but its
        # deadlines are in the future, so it never matches.
        await db_session.execute(
            sa_delete(Session).where(
                Session.user_id == user.id,
                (Session.idle_deadline <= now) | (Session.absolute_deadline <= now),
            )
        )

        await db_session.commit()
        return self._to_authed(user), session.token

    # ─── logout / resolve ─────────────────────────────────────────────────

    async def logout(self, db_session: AsyncSession, token: str) -> None:
        """Delete the session row — instant revocation. Idempotent."""
        await db_session.execute(sa_delete(Session).where(Session.token == token))
        await db_session.commit()

    async def resolve(
        self, db_session: AsyncSession, token: str
    ) -> AuthedUser | None:
        """Resolve a session token to the authenticated principal.

        Returns ``None`` for unknown tokens, lazily-deleted expired rows,
        and sessions whose user has been archived since login. A valid row
        whose ``last_extended_at`` is older than ``EXTENSION_THROTTLE``
        gets its idle window slid forward, never past the absolute cap
        (at most one extension write per hour — §2.2).
        """
        row = (
            await db_session.execute(select(Session).where(Session.token == token))
        ).scalar_one_or_none()
        if row is None:
            return None

        now = datetime.utcnow()
        if row.idle_deadline <= now or row.absolute_deadline <= now:
            await db_session.execute(
                sa_delete(Session).where(Session.token == token)
            )
            await db_session.commit()
            return None

        user = (
            await db_session.execute(
                select(User).where(
                    User.id == row.user_id, User.is_active == True,  # noqa: E712
                )
            )
        ).scalar_one_or_none()
        if user is None:
            return None

        if now - row.last_extended_at >= EXTENSION_THROTTLE:
            row.last_extended_at = now
            row.idle_deadline = min(now + IDLE_WINDOW, row.absolute_deadline)
            await db_session.commit()

        return self._to_authed(user)

    # ─── internals ────────────────────────────────────────────────────────

    @staticmethod
    def _to_authed(user: User) -> AuthedUser:
        """Map the ORM user to the guard-injectable principal (§3.5)."""
        return AuthedUser(
            id=user.id,
            phone=user.phone,
            role=user.role,
            master_id=user.master_id,
            permissions=ROLE_PERMISSIONS.get(user.role, frozenset()),
        )

    @staticmethod
    def _ladder_check(user: User, now: datetime) -> HTTPException | None:
        """§2.11: hard lock or an unexpired timed lock → 429, else None."""
        if user.lock_level >= 3:
            return AuthService._locked_out()  # no Retry-After, admin reset only
        if (
            user.lock_level in (1, 2)
            and user.locked_until is not None
            and user.locked_until > now
        ):
            retry_after = max(1, int((user.locked_until - now).total_seconds()))
            return AuthService._locked_out(retry_after=retry_after)
        return None


@lru_cache
def get_auth_service() -> AuthService:
    """Singleton factory (repo pattern: ``api/v1/masters.py`` service dep)."""
    return AuthService()
