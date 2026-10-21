"""OTP code transport — the §4.2 fail-closed selection (#499 Task 3).

The transport is an INTERFACE with a fail-closed default: with no
transport explicitly configured the code request answers 503
``NOTIFY_TRANSPORT_UNAVAILABLE`` in EVERY environment (staging and
preview included — «любое окружение кроме точно development» is not a
side door). Two selection rules (spec §4.2):

- ``OTP_TRANSPORT`` empty/unknown (the default) → no transport → 503;
- ``dev`` → :class:`DevOtpTransport`, active only under the exact
  ``ENV == "development"`` — anywhere else the selector still returns
  ``None`` (503), so a staging copy of a dev config cannot leak codes.

The dev transport logs a MASKED entry (phone + a code identifier — the
first 12 hex chars of the peppered HMAC digest; the raw code never
reaches the log) and is the only configuration under which the request
response carries ``dev_code`` (tests + manual checks, the demo-seed
principle — default-deny by environment).

The PRODUCTION transport arrives with the #476/#485 notify family;
until then production honestly answers 503.

Spec: docs/specs/2026-10-20-web-client-auth-booking-design.md §4.2
Domain rules: docs/domain-rules/auth.md «Клиентская аутентификация (#499)»
"""

from __future__ import annotations

import logging
from typing import Protocol

from src.auth.otp import hash_code
from src.core.config import settings

logger = logging.getLogger("memo.auth.otp_transport")


class OtpTransportUnavailableError(Exception):
    """No transport is configured — the request endpoint maps this to
    503 ``NOTIFY_TRANSPORT_UNAVAILABLE`` (fail-closed, §4.2)."""


class OtpTransport(Protocol):
    """A delivery channel for a phone-verification code (§4.2).

    Implementations receive the RAW code and must never log or persist
    it (the masked-logging rule); the caller hands it over right after
    the ``otp_codes`` row is written.
    """

    async def send(self, phone: str, code: str) -> None: ...


class DevOtpTransport:
    """Development-only transport: a masked log line, nothing is sent."""

    async def send(self, phone: str, code: str) -> None:
        # Masked entry (§4.2): the phone + a code IDENTIFIER (digest
        # prefix), never the raw 6 digits.
        logger.info(
            "otp dev transport: code for phone=%s code_id=%s (raw code withheld)",
            phone,
            hash_code(code)[:12],
        )


def dev_code_enabled() -> bool:
    """``dev_code`` surfaces in the request response iff the DEV
    transport is the active one (exact ``ENV == "development"``).

    One knob for both §4.2 gates: the same condition that lets the dev
    transport send also lets the response carry the code — in any other
    environment neither exists.
    """
    return settings.OTP_TRANSPORT == "dev" and settings.ENV == "development"


def get_otp_transport() -> OtpTransport | None:
    """Resolve the configured transport; ``None`` = fail-closed (503).

    Reads settings at call time (test/monkeypatch friendly); an unknown
    selector value is a misconfiguration and fails closed like an empty
    one.
    """
    if dev_code_enabled():
        return DevOtpTransport()
    return None
