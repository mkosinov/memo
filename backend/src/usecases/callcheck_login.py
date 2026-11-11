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

Commit discipline mirrors ``otp_login``: this scenario commits once on
success (the store writes nothing that must survive a rollback — a
provider failure raises BEFORE any DB work).

Spec: docs/specs/2026-11-11-auth-callcheck-design.md §Эндпоинты, §Гейты
Domain rules: docs/domain-rules/auth.md «Методы авторизации клиента (#593)»
"""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import TYPE_CHECKING

from src.auth.callcheck_gates import call_initiate_gate, register_call_initiate
from src.auth.callcheck_provider import (
    CALLCHECK_WINDOW_SECONDS,
    get_callcheck_transport,
)
from src.auth.callcheck_store import get_callcheck_store
from src.usecases.otp_login import phone_unavailable_for_client_login
from src.util.utc import utc_now

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

__all__ = [
    "CallInitiation",
    "CallcheckUnavailableError",
    "initiate_auth_call",
]


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
