"""The shared client-login finalizer (#593 Task 4, spec §Финализация).

Extracted verbatim-in-behavior from the OTP verify flow (before #593 the
cookie-time account flow lived inline in :mod:`src.usecases.otp_login`):
one helper, two (and later more) confirmation methods — ``otp/verify``
(#499/#586) and ``call/status`` (#593) both end here.

The finalizer contract (spec §Финализация):

- **find-or-create the client account by phone** — reuse the
  ``role=client`` account or create ``user(role=client, phone)`` + the
  client card (active-only exact-phone find-or-create, first active on
  duplicates) + the ``UserSettings`` defaults row (GH #319 — same
  transaction), and stamp ``phone_is_confirmed = true`` (idempotent);
- **the session row** joins the CALLER's transaction — for ``call/status``
  that is what makes the consume atomic with the finalization;
- **NO rotation** (owner decision 2026-11-11): a presented or previously
  issued client session is NEVER revoked here — parallel sessions live,
  gashing is only the explicit logout. Contrast: staff ``auth/login``
  rotates;
- **no commit** — the caller owns the transaction boundary
  (``verify_otp_login`` / the callcheck consume commit when their atomic
  unit completes); the router sets the cookie only AFTER that commit
  (:func:`set_client_session_cookie` — the ONE ``memo_client_session``
  recipe, the #499 attributes).

The concurrent same-phone insert (a rare cross-method race: an OTP verify
and a call confirm in the same instant) loses the unique-``users.phone``
race inside a SAVEPOINT — the outer transaction (the caller's atomic
consume/absorb) survives untouched, the winner's account is re-read and
reused: both methods mint their own session, exactly one account row.
(The pre-#593 code rolled the WHOLE session back and then resurrected
the OTP-code delete; the savepoint reaches the same end state — the code
stays consumed, one account — without caller-specific surgery.)

Spec: docs/specs/2026-11-11-auth-callcheck-design.md §Финализация
Domain rules: docs/domain-rules/auth.md («Клиентская аутентификация (#499)»,
«Методы авторизации клиента (#593)» — сессии без ротации)
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from src.auth.permissions import CLIENT_SESSION_COOKIE
from src.auth.session import ABSOLUTE_CAP, new_session
from src.core.config import settings
from src.models.enums import UserRole
from src.models.user import User
from src.services.client import get_client_service
from src.services.user_settings import UserSettingsService

if TYPE_CHECKING:
    from fastapi import Response
    from sqlalchemy.ext.asyncio import AsyncSession

__all__ = [
    "finalize_client_login",
    "find_or_create_client_user",
    "set_client_session_cookie",
]


async def _reuse_client_user(
    db_session: AsyncSession,
    phone: str,
) -> User | None:
    """The client account for this phone, if one exists (re-login).

    A successful confirmation always stamps ``phone_is_confirmed = true``
    (#499 §3) — idempotent on an already-confirmed account. The lookup
    is role-scoped: a staff holder can never surface here (request-side
    silence means no check exists for its phone in the first place).
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
    """:#499 §3: card + passwordless client account + settings, atomically.

    The card comes from the active-only exact-phone find-or-create
    (duplicates → first active under the stable sort). The account is
    ``role=client``, ``password_hash=NULL`` (the invariant — client
    accounts never hold a password), linked to the card, confirmed.
    The whole create runs inside a SAVEPOINT: a concurrent confirm of
    the same new phone wins the unique ``users.phone`` — the savepoint
    rolls back ONLY this insert block (the caller's transaction — an
    OTP-code absorption or a callcheck consume — stays intact), the
    winner's account is re-read and returned (the idempotent-login rule).
    """
    try:
        async with db_session.begin_nested():
            card = await get_client_service().get_or_create_active_by_phone(db_session, phone)
            user = User(
                phone=phone,
                role=UserRole.CLIENT.value,
                client_id=card.id,
                phone_is_confirmed=True,
            )
            db_session.add(user)
            await db_session.flush()  # materializes user.id (the create_row pattern)

            # GH #319: the guaranteed child row in the SAME transaction —
            # after the user flush, so the FK target exists (the
            # create_user order).
            await UserSettingsService.insert_defaults(db_session, user.id)
    except IntegrityError:
        winner = (
            await db_session.execute(
                select(User).where(
                    User.phone == phone,
                    User.role == UserRole.CLIENT.value,
                )
            )
        ).scalar_one()
        return winner
    return user


async def find_or_create_client_user(
    db_session: AsyncSession,
    phone: str,
) -> User:
    """The §3 account flow alone: reuse-or-create, confirmed.

    Shared by every confirmation method; safe to call repeatedly
    (idempotent at the account level).
    """
    user = await _reuse_client_user(db_session, phone)
    if user is None:
        user = await _create_client_user(db_session, phone)
    return user


async def finalize_client_login(
    db_session: AsyncSession,
    *,
    phone: str,
) -> tuple[User, str]:
    """The §Финализация finalizer: account flow + the session row.

    Runs INSIDE the caller's transaction and does NOT commit: the caller's
    atomic unit (code absorption / handle consume) and the finalization
    are one commit. Does NOT rotate anything — previously issued client
    sessions of the user stay alive (the owner's no-rotation decision).
    Returns ``(user, token)``; set the cookie with
    :func:`set_client_session_cookie` AFTER the caller's commit.
    """
    user = await find_or_create_client_user(db_session, phone)
    session = new_session(user.id)
    db_session.add(session)
    return user, session.token


def set_client_session_cookie(response: Response, token: str) -> None:
    """Set ``memo_client_session`` — the ONE cookie recipe (the #499 login
    attributes: HttpOnly, SameSite=Lax, Path=/, Max-Age = the absolute
    cap; ``Secure`` iff production). Both login methods end here, so the
    two cookies are byte-identical in shape."""
    response.set_cookie(
        key=CLIENT_SESSION_COOKIE,
        value=token,
        max_age=int(ABSOLUTE_CAP.total_seconds()),
        httponly=True,
        samesite="lax",
        secure=settings.ENV == "production",
        path="/",
    )
