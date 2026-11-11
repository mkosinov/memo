"""#593 Task 3 — the callcheck initiate scenario (spec §Эндпоинты).

The flow behind ``POST /api/v1/auth/call/initiate`` (the HTTP mapping —
202 / 422 / 429 / 503 — lives in the auth router, the flow lives here),
the mirror of :func:`src.usecases.otp_login.request_otp_code`:

* fail-closed transport resolution (no provider →
  :class:`CallcheckUnavailableError` → 503 in EVERY environment);
* the SHARED staff silence — the exact ``otp/request`` predicate
  (:func:`phone_unavailable_for_client_login`): a staff or archived
  phone gets NO check, NO provider call, NO journal row — an
  indistinguishable 202 (no enumeration oracle);
* the §Гейты initiate gates (:mod:`src.auth.callcheck_gates`) — AFTER
  the staff skip, BEFORE the provider;
* ``callcheck/add`` — the client's IP rides along, format-validated
  (a malformed value is NEVER forwarded — ``None`` instead; trusting
  proxy headers is a deployment invariant, not code policy);
* on success ONE transaction (the Task 2 store's row upsert + the
  ``created`` journal row), committed here; only THEN are the gate
  windows registered — a provider failure consumes no budget (the
  deliberate deviation from ``otp_service.issue``, where the send is
  counted before the transport call; #593 spec §Эндпоинты).

#593 Task 4 adds the STATUS flow (:func:`poll_auth_call_status`) — the
mirror of ``verify_otp_login``: resolve the one-time handle (None → the
router's 404), ask the PROVIDER first (debounced 3 s per phone; any
provider failure → ``waiting`` without a state change or journal row),
then map: ``401`` → the ATOMIC consume + the SHARED finalizer
(:mod:`src.usecases.client_login`) + the ``confirmed`` journal row in
ONE transaction — a parallel poll of the same handle loses the
conditional update and answers 404, a failed transaction leaves the row
``pending`` (a retry repeats the attempt — the handle never burns in
vain); ``402`` → ``expired``; the local window (``created_at`` + the
constant) only closes a check the provider still reports waiting — a
late call confirms until the purge margin (the provider answer outranks
the local expiry, §Эндпоинты).

Commit discipline mirrors ``otp_login``: the scenario commits once on
success (the store writes nothing that must survive a rollback — a
provider failure raises BEFORE any DB work).

Spec: docs/specs/2026-11-11-auth-callcheck-design.md §Эндпоинты, §Гейты,
§Финализация
Domain rules: docs/domain-rules/auth.md «Методы авторизации клиента (#593)»
"""

from __future__ import annotations

import ipaddress
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any, cast

from sqlalchemy import update

from src.auth.callcheck import (
    ATTEMPT_OUTCOME_CONFIRMED,
    ATTEMPT_OUTCOME_EXPIRED,
    AUTH_CALL_STATUS_CONSUMED,
    AUTH_CALL_STATUS_EXPIRED,
    AUTH_CALL_STATUS_PENDING,
    AuthCall,
    AuthCallAttempt,
    hash_ip,
)
from src.auth.callcheck_gates import (
    call_initiate_gate,
    call_status_debounce_allows,
    register_call_initiate,
)
from src.auth.callcheck_provider import (
    CALLCHECK_WINDOW_SECONDS,
    CallcheckProviderError,
    CallcheckStatus,
    get_callcheck_transport,
)
from src.auth.callcheck_store import get_callcheck_store
from src.auth.scope import mask_phone
from src.usecases.client_login import finalize_client_login
from src.usecases.otp_login import phone_unavailable_for_client_login
from src.util.utc import utc_now

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from src.models.user import User

__all__ = [
    "AuthCallPoll",
    "CallInitiation",
    "CallcheckUnavailableError",
    "initiate_auth_call",
    "poll_auth_call_status",
]

logger = logging.getLogger("memo.usecases.callcheck_login")


class CallcheckUnavailableError(Exception):
    """No callcheck transport configured — the initiate is fail-closed
    503 in EVERY environment (spec §Конфигурация; the registry reports
    the method unavailable, so a configured frontend never offers it)."""


@dataclass(frozen=True, slots=True)
class CallInitiation:
    """A successfully started check — the initiate response payload."""

    #: The RAW one-time status handle (uuid4-hex): handed to the router
    #: for the response body, persisted only as its digest.
    handle: str
    #: The number the CLIENT calls — strictly ``+7…`` (some operators
    #: reject the bare form, especially from abroad).
    call_phone: str
    #: The window deadline shown by the call-screen timer — the add
    #: moment plus the client-side constant (the provider response
    #: carries no time field).
    expires_at: datetime


def _provider_ip(client_ip: str) -> str | None:
    """Format-validate the ASGI client address for the provider hand-off.

    The provider substitutes a regular number for the 8-800 one in
    roaming — but only for a well-formed address; anything else (the
    TestClient host, a mangled value) is withheld entirely rather than
    forwarded garbage (spec §Гейты: «значение валидируется по формату
    до передачи провайдеру»).
    """
    try:
        ipaddress.ip_address(client_ip)
    except ValueError:
        return None
    return client_ip


def _client_call_phone(call_phone: str) -> str:
    """Guarantee the client-facing ``+7…`` form (defense in depth).

    Both shipped transports already normalize to the leading ``+``;
    this guard keeps the invariant true for any future provider — the
    response contract (spec §Эндпоинты) is too important to trust a
    remote party with.
    """
    return call_phone if call_phone.startswith("+") else f"+{call_phone}"


async def initiate_auth_call(
    db_session: AsyncSession,
    *,
    phone: str,
    client_ip: str,
) -> CallInitiation | None:
    """Start a phone-verification-by-call check; ``None`` = staff skip.

    Raises :class:`CallcheckUnavailableError` BEFORE any work when no
    transport is configured (fail-closed), 429/503 from the §Гейты
    gates, and :class:`CallcheckProviderError` on any provider failure
    (the router maps both failure families to the single 503 — nothing
    is written, no budget is spent). The caller (router) validates the
    canonical phone BEFORE calling this — the 422 fires before gates
    and provider.
    """
    transport = get_callcheck_transport()
    if transport is None:
        raise CallcheckUnavailableError()

    if await phone_unavailable_for_client_login(db_session, phone):
        return None

    gate = call_initiate_gate(phone, client_ip)
    if gate is not None:
        raise gate

    created = await transport.create(phone, _provider_ip(client_ip))

    handle = await get_callcheck_store().save_initiated(
        db_session,
        phone=phone,
        provider_check_id=created.check_id,
        call_phone=_client_call_phone(created.call_phone),
        client_ip=client_ip,
    )
    await db_session.commit()
    register_call_initiate(phone, client_ip)

    return CallInitiation(
        handle=handle,
        call_phone=_client_call_phone(created.call_phone),
        expires_at=utc_now() + timedelta(seconds=CALLCHECK_WINDOW_SECONDS),
    )


# ─── Task 4 — the status flow (spec §Эндпоинты: POST /auth/call/status) ───────


@dataclass(frozen=True, slots=True)
class AuthCallPoll:
    """One status-poll outcome — the router's response payload.

    ``token`` is set ONLY on a successful confirm; the router then sets
    the ``memo_client_session`` cookie AFTER this scenario committed
    (the consume, the finalization and the journal are one transaction —
    the cookie must never outlive a rolled-back consume).
    """

    status: CallcheckStatus
    token: str | None = None


async def _provider_status(check_id: str, phone: str) -> CallcheckStatus | None:
    """One debounced provider poll; ``None`` = no answer (skip or failure).

    The debounce bounds ATTEMPTS: a poll inside the 3-s window skips the
    provider entirely. A provider failure (HTTP ≠ 2xx, timeout, network
    — the normalized :class:`CallcheckProviderError`) also returns
    ``None`` — the caller answers ``waiting`` without a state change
    and without a journal row (§Эндпоинты). Logged with the masked
    phone, the provider check id and the duration — never the raw
    handle, never the api key (§Логирование).
    """
    transport = get_callcheck_transport()
    if transport is None:
        # The transport went away between initiate and poll (a config
        # flip mid-window): no provider to ask — the same soft answer
        # as a provider failure, never a 500.
        return None
    if not call_status_debounce_allows(phone):
        return None

    started = time.monotonic()
    try:
        result = await transport.status(check_id)
    except CallcheckProviderError:
        logger.warning(
            "callcheck status failed: phone=%s check_id=%s duration_ms=%d",
            mask_phone(phone),
            check_id,
            (time.monotonic() - started) * 1000,
        )
        return None
    logger.info(
        "callcheck status: phone=%s check_id=%s outcome=%s duration_ms=%d",
        mask_phone(phone),
        check_id,
        result.value,
        (time.monotonic() - started) * 1000,
    )
    return result


async def _append_terminal_attempt(
    db_session: AsyncSession,
    *,
    row: AuthCall,
    client_ip: str,
    outcome: str,
    now: datetime,
) -> None:
    """Journal row for a terminal outcome (``confirmed`` / ``expired``)."""
    db_session.add(
        AuthCallAttempt(
            phone=row.phone,
            ip_hash=hash_ip(client_ip),
            provider_check_id=row.provider_check_id,
            outcome=outcome,
            created_at=now,
            checked_at=now,
        )
    )


async def _consume_and_finalize(
    db_session: AsyncSession,
    *,
    row: AuthCall,
    client_ip: str,
) -> tuple[User, str] | None:
    """The atomic confirm: conditional consume + finalization, ONE commit.

    The conditional update is the exactly-once arbiter — ``WHERE
    status != 'consumed'`` (the task's ``pending → consumed`` guard,
    widened by one step: a row the window already flipped ``expired``
    may still be confirmed by a late provider answer inside the purge
    margin — the tail is not cut, §Эндпоинты; exactly-once holds either
    way). Of parallel polls of one handle exactly one wins; the losers
    get ``None`` (the router's 404). On ANY failure the transaction
    rolls back — the row stays ``pending``, a retry repeats the attempt
    (the handle never burns in vain). The ``confirmed`` journal row and
    the session row join the SAME commit; the caller sets the cookie
    only after it.
    """
    now = utc_now()
    consumed = await db_session.execute(
        update(AuthCall)
        .where(
            AuthCall.phone == row.phone,
            AuthCall.status != AUTH_CALL_STATUS_CONSUMED,
        )
        .values(status=AUTH_CALL_STATUS_CONSUMED)
    )
    # The ``services.user`` rowcount pattern: Result is not typed with
    # rowcount (only CursorResult is), the UPDATE result always has it.
    if int(cast("Any", consumed).rowcount) != 1:
        return None  # a parallel poll consumed the handle — it answers 404

    user, token = await finalize_client_login(db_session, phone=row.phone)
    await _append_terminal_attempt(
        db_session,
        row=row,
        client_ip=client_ip,
        outcome=ATTEMPT_OUTCOME_CONFIRMED,
        now=now,
    )
    await db_session.commit()
    return user, token


async def _mark_expired(
    db_session: AsyncSession,
    *,
    row: AuthCall,
    client_ip: str,
) -> None:
    """Terminal ``expired``: the guarded flip + ONE journal row, committed.

    The ``pending → expired`` flip is guarded so a re-poll of an
    already-expired check journals nothing — the row is the
    exactly-once marker. ``expired`` is NOT a consume: a later provider
    ``confirmed`` (the late-call tail) can still win the row.
    """
    flipped = await db_session.execute(
        update(AuthCall)
        .where(
            AuthCall.phone == row.phone,
            AuthCall.status == AUTH_CALL_STATUS_PENDING,
        )
        .values(status=AUTH_CALL_STATUS_EXPIRED)
    )
    if int(cast("Any", flipped).rowcount) == 1:
        now = utc_now()
        await _append_terminal_attempt(
            db_session,
            row=row,
            client_ip=client_ip,
            outcome=ATTEMPT_OUTCOME_EXPIRED,
            now=now,
        )
        await db_session.commit()


async def poll_auth_call_status(
    db_session: AsyncSession,
    *,
    handle: str,
    client_ip: str,
) -> AuthCallPoll | None:
    """Poll a check by its one-time handle; ``None`` → the router's 404.

    The order is FIXED (§Эндпоинты): resolve the handle (invalid or
    consumed → None — the 404 that never discloses which), ask the
    PROVIDER (debounced; failures are ``waiting``), and only then weigh
    the local expiry — a call in the last seconds of the window is not
    lost. Terminal answers: ``confirmed`` (atomic consume +
    finalization + cookie token — :func:`_consume_and_finalize`),
    ``expired`` (provider 402, or the window over while the provider
    still says waiting); everything else is ``waiting`` — no state
    change, no journal row, no cookie.
    """
    row = await get_callcheck_store().find_by_handle(db_session, handle)
    if row is None or row.status == AUTH_CALL_STATUS_CONSUMED:
        return None

    provider_status = await _provider_status(row.provider_check_id, row.phone)

    if provider_status == CallcheckStatus.CONFIRMED:
        finalized = await _consume_and_finalize(db_session, row=row, client_ip=client_ip)
        if finalized is None:
            return None  # lost the consume race — indistinguishable 404
        _, token = finalized
        return AuthCallPoll(status=CallcheckStatus.CONFIRMED, token=token)

    if provider_status == CallcheckStatus.EXPIRED:
        await _mark_expired(db_session, row=row, client_ip=client_ip)
        return AuthCallPoll(status=CallcheckStatus.EXPIRED)

    # waiting / debounced / provider failure — the local window decides
    # only when the provider did NOT confirm: the tail is never cut.
    if row.status == AUTH_CALL_STATUS_EXPIRED:
        return AuthCallPoll(status=CallcheckStatus.EXPIRED)
    if utc_now() >= row.created_at + timedelta(seconds=CALLCHECK_WINDOW_SECONDS):
        await _mark_expired(db_session, row=row, client_ip=client_ip)
        return AuthCallPoll(status=CallcheckStatus.EXPIRED)
    return AuthCallPoll(status=CallcheckStatus.WAITING)
