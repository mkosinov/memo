"""Callcheck provider seam — Protocol, wiring, dev transport (#593 Task 1).

The ``call`` method of client authorization (#593 spec): the client
CALLS a provider-issued number themselves (the call is dropped — free),
the provider confirms the caller id matched the declared phone. The
seam mirrors ``otp_transport.py`` (#499 §4.2):

- ``CALLCHECK_TRANSPORT`` empty/unknown (the default) → the resolver
  returns ``None`` → the method is honestly unavailable (registry
  ``available:false``) and initiate is fail-closed 503;
- ``dev`` → :class:`DevCallcheckProvider`, active only under the exact
  ``ENV == "development"`` — anywhere else the resolver still returns
  ``None``, so a staging copy of a dev config cannot fake checks;
- ``smsru`` → :class:`SmsRuClient` (the fail-fast settings validator
  demands ``SMSRU_CALLCHECK_API_KEY`` when this selector is set).

The check window (300 s) is a constant HERE: the sms.ru ``add``
response carries no time field (research §Эндпоинты), so ``expires_at``
is always computed locally; the dev transport reuses the same constant
so both transports shape identical windows.

Spec: docs/specs/2026-11-11-auth-callcheck-design.md §Клиент провайдера,
§Конфигурация
Domain rules: docs/domain-rules/auth.md «Методы авторизации клиента (#593)»
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from src.auth.scope import mask_phone
from src.core.config import settings

logger = logging.getLogger("memo.auth.callcheck_provider")

#: The provider check window — a client-side CONSTANT (spec §Клиент
#: провайдера: the sms.ru ``add`` response has no time field; 5 minutes
#: per the research doc). Never parsed from a provider response.
CALLCHECK_WINDOW_SECONDS = 300

#: The fake number the dev transport hands out — canonical ``+7…`` so
#: the client-facing shape matches the real transport exactly.
_DEV_CALL_PHONE = "+78005553535"


class CallcheckStatus(StrEnum):
    """The outcome of a check poll — the router's waiting/confirmed/expired."""

    WAITING = "waiting"
    CONFIRMED = "confirmed"
    EXPIRED = "expired"


@dataclass(frozen=True, slots=True)
class CheckCreated:
    """A check accepted by the provider (``callcheck/add``)."""

    check_id: str
    #: The number the CLIENT calls — canonical ``+7…`` (the provider
    #: returns bare digits; some operators reject the plus-less form,
    #: especially from abroad — research «Факты провайдера для UI»).
    call_phone: str
    window_seconds: int


class CallcheckProviderError(Exception):
    """Any provider failure: HTTP ≠ 2xx, code ≠ 100, timeout, network,
    malformed body. Raised by every transport; the message carries NO
    request body and NO api key (spec §Клиент провайдера)."""


class CallcheckProvider(Protocol):
    """A phone-verification-by-call provider (spec §Клиент провайдера).

    ``create`` starts a check for the canonical ``+7…`` phone (the
    caller's ``ip`` rides along — the provider substitutes a regular
    number for the 8-800 one in roaming); ``status`` polls the check
    outcome. Implementations must never leak the api key or request
    bodies through exceptions or logs.
    """

    async def create(self, phone: str, ip: str | None) -> CheckCreated: ...

    async def status(self, check_id: str) -> CallcheckStatus: ...


class DevCallcheckProvider:
    """Development-only provider: in-memory checks, nothing is sent.

    The mirror of ``DevOtpTransport`` (masked log, no real request).
    Checks live in a process-local registry; the dev-done imitator
    (#593 Task 4) flips an entry to CONFIRMED on the RESOLVED instance —
    which is why :func:`get_callcheck_transport` hands out the
    module-level singleton, not a fresh object per call.
    """

    def __init__(self) -> None:
        self._checks: dict[str, CallcheckStatus] = {}

    async def create(self, phone: str, ip: str | None) -> CheckCreated:
        check_id = uuid.uuid4().hex
        self._checks[check_id] = CallcheckStatus.WAITING
        logger.info(
            "callcheck dev transport: check for phone=%s check_id=%s (no real call)",
            mask_phone(phone),
            check_id,
        )
        return CheckCreated(
            check_id=check_id,
            call_phone=_DEV_CALL_PHONE,
            window_seconds=CALLCHECK_WINDOW_SECONDS,
        )

    async def status(self, check_id: str) -> CallcheckStatus:
        # Own check ids are always known; a stale one waiting is the
        # honest dev answer (the dev-done imitator never confirmed it).
        return self._checks.get(check_id, CallcheckStatus.WAITING)


# The dev-transport singleton: resolved once, reused across requests so
# the Task 4 dev-done imitator flips the SAME instance initiate used.
_DEV_PROVIDER: DevCallcheckProvider | None = None


def get_callcheck_transport() -> CallcheckProvider | None:
    """Resolve the configured provider; ``None`` = the method is off.

    Mirrors :func:`src.auth.otp_transport.get_otp_transport`: settings
    are read at call time (test/monkeypatch friendly); an unknown
    selector value is a misconfiguration and fails closed like an empty
    one. ``dev`` resolves only under the exact ``ENV == "development"``.
    ``smsru`` builds the real client — the registry's ``available`` flag
    flows through THIS construction, never through a bare env-var check.
    """
    global _DEV_PROVIDER
    selector = settings.CALLCHECK_TRANSPORT
    if selector == "dev":
        if settings.ENV != "development":
            return None
        if _DEV_PROVIDER is None:
            _DEV_PROVIDER = DevCallcheckProvider()
        return _DEV_PROVIDER
    if selector == "smsru":
        # Deferred import: smsru_client imports the seam types above, so
        # a module-level import here would be a cycle. Resolved at call
        # time — monkeypatching src.auth.smsru_client.SmsRuClient shows
        # through (the registry-matrix tests rely on that).
        from src.auth.smsru_client import SmsRuClient

        return SmsRuClient(api_id=settings.SMSRU_CALLCHECK_API_KEY)
    return None
