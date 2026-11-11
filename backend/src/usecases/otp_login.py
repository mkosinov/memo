"""#499 Task 3 — the OTP login scenario (spec §3 + §4.2).

Two entry points called by the auth router (the HTTP mapping — 202 /
503 / 401 / cookie — lives there, the flow lives here):

* :func:`request_otp_code` — fail-closed transport resolution (no
  transport → :class:`OtpTransportUnavailableError`), the §4.2 staff
  silence (a phone held by a staff account — or an archived client
  account, which could never log in — gets NO code row and NO send,
  indistinguishable from success), then the Task 2 ``issue`` (rotation,
  send limits) and the transport hand-off.
* :func:`verify_otp_login` — the Task 2 ``verify`` (HMAC + TTL + attempt
  gates, ATOMIC code absorption in this transaction), then the §3
  account flow + the session row via the SHARED finalizer
  (:func:`src.usecases.client_login.finalize_client_login` — extracted
  by #593 Task 4 so ``call/status`` confirms through the exact same
  code: find-or-create the client account, ``phone_is_confirmed=true``,
  no rotation); the client session row is added in the SAME commit as
  the code absorption.

Commit discipline mirrors ``AuthService`` (not ``@transactional`` —
auth is not an events-emitting entity): the caller-owned session
commits once on success; failure paths leave nothing that must survive
a rollback (rate-limit counters are in-memory).

Spec: docs/specs/2026-10-20-web-client-auth-booking-design.md §3, §4.2
Domain rules: docs/domain-rules/auth.md («Клиентская аутентификация (#499)»),
docs/domain-rules/clients.md (phone lookup — active-only)
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import select

from src.auth.otp_service import get_otp_service
from src.auth.otp_transport import OtpTransportUnavailableError, get_otp_transport
from src.models.enums import UserRole
from src.models.user import User
from src.usecases.client_login import finalize_client_login

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

__all__ = [
    "InvalidOtpError",
    "OtpTransportUnavailableError",
    "request_otp_code",
    "verify_otp_login",
]


class InvalidOtpError(Exception):
    """The ONE verify refusal — wrong, expired, unknown, or replayed code.

    A single 401 answer (the router maps it to ``AUTH_INVALID_CREDENTIALS``
    with this message): the endpoint must not let anyone enumerate which
    phones have live codes (§4.2 «отказ — единое сообщение»).
    """

    MESSAGE = "Неверный код подтверждения или истёк срок действия"


async def phone_unavailable_for_client_login(
    db_session: AsyncSession,
    phone: str,
) -> bool:
    """True when the phone must never receive a client code (§4.2).

    Two shapes, one silent answer: a STAFF account (``admin``/``master``
    — «телефон сотрудника», regardless of its active flag: the unique
    string is occupied) and an ARCHIVED client account (the resolver
    refuses archived accounts, so the login could never resolve). Both
    skip code generation and the transport entirely — the 202 is
    byte-identical to a real send, no enumeration oracle.

    Public since #593: the callcheck initiate path shares this EXACT
    predicate for its own silent 202 (spec §Эндпоинты — «тот же
    предикат, что и в запросе кода»); one rule, one home.
    """
    row = (
        await db_session.execute(select(User.role, User.is_active).where(User.phone == phone))
    ).first()
    if row is None:
        return False
    return row.role != UserRole.CLIENT.value or not row.is_active


async def request_otp_code(
    db_session: AsyncSession,
    *,
    phone: str,
    client_ip: str,
) -> str | None:
    """Issue (and deliver) a code; ``None`` = the silent staff skip.

    Raises :class:`OtpTransportUnavailableError` BEFORE any work when no
    transport is configured (fail-closed — the code is neither written
    nor counted), 429 from the §4.1 send gates via ``issue``. Returns
    the raw code for the transport/`dev_code` hand-off; it is never
    persisted or logged raw.
    """
    transport = get_otp_transport()
    if transport is None:
        raise OtpTransportUnavailableError()

    if await phone_unavailable_for_client_login(db_session, phone):
        return None

    code = await get_otp_service().issue(db_session, phone, client_ip)
    await transport.send(phone, code)
    return code


async def verify_otp_login(
    db_session: AsyncSession,
    *,
    phone: str,
    code: str,
    client_ip: str,
) -> tuple[User, str]:
    """Verify the code and issue the client session — one commit.

    ``verify`` absorbs the code row INSIDE this transaction (one-time
    use, §4.1); the SHARED finalizer's account flow (§3 — extracted to
    :mod:`src.usecases.client_login` by #593 Task 4) and the new session
    row join it, and the single commit makes the login atomic with the
    absorption. Any code refusal raises :class:`InvalidOtpError` (the
    unified answer; the gates may raise 429 first — a tripped budget
    rejects even the correct code). Returns ``(user, token)``; the
    router sets the ``memo_client_session`` cookie with the token.
    """
    if not await get_otp_service().verify(db_session, phone, code, client_ip):
        raise InvalidOtpError(InvalidOtpError.MESSAGE)

    user, token = await finalize_client_login(db_session, phone=phone)

    await db_session.commit()
    return user, token
