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
  account flow: reuse the client account for the phone or create
  ``user(role=client, phone)`` + the client card (find-or-create by
  exact phone, ACTIVE cards only, first active on duplicates under the
  stable creation-order sort) + the ``UserSettings`` defaults row (GH
  #319 — same transaction), ``phone_is_confirmed = true``; a concurrent
  verify on the same new phone loses the unique-``users.phone`` race,
  re-reads the winner's row and continues (idempotent login). The
  client session row is added in the SAME commit as the code absorption.

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

from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from src.auth.otp import OtpCode
from src.auth.otp_service import get_otp_service
from src.auth.otp_transport import OtpTransportUnavailableError, get_otp_transport
from src.auth.session import new_session
from src.models.enums import UserRole
from src.models.user import User
from src.services.client import get_client_service
from src.services.user_settings import UserSettingsService

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


async def _phone_unavailable_for_client_login(
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

    if await _phone_unavailable_for_client_login(db_session, phone):
        return None

    code = await get_otp_service().issue(db_session, phone, client_ip)
    await transport.send(phone, code)
    return code


async def _reuse_client_user(
    db_session: AsyncSession,
    phone: str,
) -> User | None:
    """The client account for this phone, if one exists (re-login).

    A successful confirmation always stamps ``phone_is_confirmed = true``
    (spec §3) — idempotent on an already-confirmed account. The lookup
    is role-scoped: a staff holder can never surface here (request-side
    silence means no code row exists for its phone in the first place).
    """
    user = (
        await db_session.execute(
            select(User).where(
                User.phone == phone,
                User.role == UserRole.CLIENT.value,
            )
        )
    ).scalar_one_or_none()
    if user is not None:
        user.phone_is_confirmed = True
    return user


async def _create_client_user(
    db_session: AsyncSession,
    phone: str,
) -> User:
    """§3: card + passwordless client account + settings, one transaction.

    The card comes from the active-only exact-phone find-or-create
    (duplicates → first active under the stable sort). The account is
    ``role=client``, ``password_hash=NULL`` (the invariant — client
    accounts never hold a password), linked to the card, confirmed.
    A concurrent verify on the same new phone: the unique
    ``users.phone`` insert loses the race → rollback, re-absorb the
    code (the rollback resurrects its row), re-read the winner's
    account and continue — the idempotent-login rule.
    """
    card = await get_client_service().get_or_create_active_by_phone(db_session, phone)
    user = User(
        phone=phone,
        role=UserRole.CLIENT.value,
        client_id=card.id,
        phone_is_confirmed=True,
    )
    db_session.add(user)
    try:
        await db_session.flush()  # materializes user.id (the create_row pattern)
    except IntegrityError:
        await db_session.rollback()
        await db_session.execute(sa_delete(OtpCode).where(OtpCode.phone == phone))
        winner = (
            await db_session.execute(
                select(User).where(
                    User.phone == phone,
                    User.role == UserRole.CLIENT.value,
                )
            )
        ).scalar_one()
        return winner

    # GH #319: the guaranteed child row in the SAME transaction — after
    # the user flush, so the FK target exists (the create_user order).
    await UserSettingsService.insert_defaults(db_session, user.id)
    return user


async def verify_otp_login(
    db_session: AsyncSession,
    *,
    phone: str,
    code: str,
    client_ip: str,
) -> tuple[User, str]:
    """Verify the code and issue the client session — one commit.

    ``verify`` absorbs the code row INSIDE this transaction (one-time
    use, §4.1); the account find-or-create (§3) and the new session row
    join it, and the single commit makes the login atomic with the
    absorption. Any code refusal raises :class:`InvalidOtpError` (the
    unified answer; the gates may raise 429 first — a tripped budget
    rejects even the correct code). Returns ``(user, token)``; the
    router sets the ``memo_client_session`` cookie with the token.
    """
    if not await get_otp_service().verify(db_session, phone, code, client_ip):
        raise InvalidOtpError(InvalidOtpError.MESSAGE)

    user = await _reuse_client_user(db_session, phone)
    if user is None:
        user = await _create_client_user(db_session, phone)

    session = new_session(user.id)
    db_session.add(session)
    await db_session.commit()
    return user, session.token
