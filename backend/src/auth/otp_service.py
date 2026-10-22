"""OtpService — phone-verification code storage (#499 spec §4.1, Task 2).

Storage layer only: the HTTP endpoints (Task 3) call ``issue`` /
``verify``. ``issue`` rotates — one live row per phone, a new send
replaces the old — and returns the raw code for the transport layer;
the raw code is never persisted (only its pepper-keyed HMAC digest).
``verify`` gates on the attempt/IP counters, purges expired rows on
access, compares the digest in constant time, and atomically consumes
the row on success — one-time use. The caller (Task 3) issues the
client session in the SAME transaction, which is what makes the
consumption atomic with the login.

Rate limits live in the auth in-memory counter store (service.py —
«существующий стор», one 15-minute window): 5 sends/phone, 20/IP shared
by sends and verify failures, 5 distinct phones/IP, 5 failed inputs per
phone; code rotation does not reset the attempt budget. Commit
discipline mirrors auth: nothing here commits — the caller-owned
session commits on success (``get_db_session``), and failure paths
write nothing that must survive a rollback (counters are in-memory).

Spec: docs/specs/2026-10-20-web-client-auth-booking-design.md §4.1
Domain rules: docs/domain-rules/auth.md «Клиентская аутентификация (#499)»
"""

from __future__ import annotations

import hmac
from datetime import datetime
from functools import lru_cache
from typing import TYPE_CHECKING

from sqlalchemy import delete as sa_delete
from sqlalchemy import select

from src.auth.otp import OtpCode, hash_code, new_code, new_otp_code
from src.auth.service import (
    otp_send_gate,
    otp_verify_gate,
    register_otp_send,
    register_otp_verify_failure,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

# Stand-in digest for the row-missing branch — the compare always runs so
# both branches do the same work (the login dummy-hash discipline; the
# HMAC cost is trivial, the uniformity is free).
_DUMMY_DIGEST = "0" * 64


class OtpService:
    """Issue / verify one-time phone-verification codes (§4.1)."""

    async def issue(
        self, db_session: AsyncSession, phone: str, client_ip: str,
    ) -> str:
        """Rate-limited code issue; returns the raw 6-digit code.

        Raises 429 ``AUTH_LOCKED_OUT`` when a send limit is tripped. The
        row is written before the send is counted — a failed write must
        not consume the budget. The caller hands the raw code to the
        transport layer (which must not log it, §4.2).
        """
        gate = otp_send_gate(phone, client_ip)
        if gate is not None:
            raise gate

        code = new_code()
        await db_session.execute(sa_delete(OtpCode).where(OtpCode.phone == phone))
        db_session.add(new_otp_code(phone, code))
        await db_session.flush()

        register_otp_send(phone, client_ip)
        return code

    async def verify(
        self, db_session: AsyncSession, phone: str, code: str, client_ip: str,
    ) -> bool:
        """Verify and atomically consume the code; False on any failure.

        Check order (§4.1): the attempt gates (a tripped budget rejects
        even the correct code — the login-lockout rule), the row lookup
        with the expiry purge (expired rows are deleted on access), then
        the constant-time digest compare. Every failure feeds the phone
        attempt budget and the shared IP wire; a 429 raised by the
        tripped IP wire wins over the unified failure response.
        """
        gate = otp_verify_gate(phone, client_ip)
        if gate is not None:
            raise gate

        now = datetime.utcnow()
        row = (await db_session.execute(
            select(OtpCode).where(OtpCode.phone == phone)
        )).scalar_one_or_none()

        if row is not None and row.expires_at <= now:
            # §4.1: expired rows are deleted on any phone access; an
            # expired code is a failure, not a pass.
            await db_session.execute(
                sa_delete(OtpCode).where(OtpCode.phone == phone)
            )
            await db_session.flush()
            row = None

        stored = row.code_hash if row is not None else _DUMMY_DIGEST
        matches = hmac.compare_digest(stored, hash_code(code)) and row is not None

        if not matches:
            trip = register_otp_verify_failure(phone, client_ip)
            if trip is not None:
                raise trip
            return False

        # Atomic one-time consumption: the row disappears in this
        # transaction, together with the caller's session issue.
        await db_session.execute(sa_delete(OtpCode).where(OtpCode.phone == phone))
        await db_session.flush()
        return True


@lru_cache
def get_otp_service() -> OtpService:
    """Process-singleton OtpService (the ``get_auth_service`` pattern)."""
    return OtpService()
