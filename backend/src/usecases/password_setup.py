"""Password setup link scenarios — issue + set (GH #348 Task 2, spec §4/§8).

Corridor 2 of the service canon (docs/domain-rules/service-layer.md
rule 2): each scenario is a public function named after the business
action, decorated ``@transactional`` (ONE transaction + ONE event batch
per action), composing undecorated owner blocks only.

``issue_password_link`` — the admin-side issue:

* unknown user → ``None`` (the route maps to 404); deactivated account
  → :class:`AccountDeactivatedError` (route → 422
  ``ACCOUNT_DEACTIVATED``) — both BEFORE any write;
* ONE transaction deletes ALL of the user's former tokens (live AND
  consumed — the table never grows per account, spec §4) and inserts
  the new live one (PK = SHA-256 digest; the raw token never persists;
  the partial unique live-token index is the DB-level double-issue
  guard);
* TTL is a scenario parameter — ``ttl`` (default 24 h; tests pass a
  short one);
* ONE audit row ``password_link_issued`` (entity ``users``,
  action-only — no field snapshot, spec §8): the author is the
  request's staged actor (the issuing admin); no staged actor → no row
  (audit §4.1), the action itself still runs.

``set_password_by_link`` — the public consume (authority = the token
itself, spec §7):

* password policy check + Argon2 hash run BEFORE the first DB
  statement (spec §4: the hash is slow, the write transaction must be
  short) — a policy failure therefore never touches the token;
* conditional consume — ``UPDATE ... WHERE token = digest AND used_at
  IS NULL AND expires_at > now`` with RETURNING (the
  ``_register_failure`` atomic-UPDATE precedent): 0 rows →
  :class:`PasswordLinkInvalidError`. One statement decides unknown /
  expired / double-use;
* the account-active check runs in the SAME transaction; a deactivated
  account (token issued before archiving, spec §4) rejects with the
  SAME error and the consume is rolled back — the row keeps
  ``used_at IS NULL`` (an archive never burns the link; a later
  reactivation finds it live again);
* success: new hash + the WHOLE lockout ladder reset (including the
  hard level-3 lock — previously sqladmin-only, canon auth.md #348) +
  every session of the user revoked (S8) — owner blocks
  ``UserService.apply_password_reset`` / ``AuthService
  .revoke_user_sessions``;
* NO audit row — public call, no author (audit canon «нет автора →
  нет записи»); the event is reconstructable from the issue journal
  row + the consumed token (spec §8).

Timing parity (spec §4, the login unknown-phone precedent): every
rejection path of the public consume pays the same fixed work — the
policy+Argon2 cost runs before ANY branch, so the missing-token /
expired / used / inactive branches cannot be cheaper than the success
path. (At login the dummy-hash verify equalizes branches ON user
existence; here the branch point sits after the fixed cost, which is
the same equalization outcome — the task brief's «dummy argon run» is
paid unconditionally.)

CALLING CONVENTION: the ``@transactional`` wrapper's signature is
``wrapper(self, *args, **kwargs)`` — a module-level scenario therefore
MUST be called with an explicit leading ``None`` (the unused ``self``
slot) and keyword arguments::

    link = await issue_password_link(
        None, db_session=session, user_id=...
    )
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import TYPE_CHECKING

from sqlalchemy import delete as sa_delete
from sqlalchemy import update as sa_update

from src.auth.password_setup import PasswordSetupToken, token_digest
from src.auth.passwords import hash_password, validate_password
from src.services.decorators import transactional
from src.services.user import get_user_service

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

#: Default link lifetime — 24 h (spec §4; a scenario parameter so tests
#: can pass a short one — S4's expiry tests redate the row instead).
DEFAULT_LINK_TTL = timedelta(hours=24)

# 256 bits of urlsafe entropy (43 chars) — brute force is unrealistic
# (spec §7: «полномочие — сам токен»).
_RAW_TOKEN_BYTES = 32


class AccountDeactivatedError(Exception):
    """Link issue refused: the account is archived (route → 422
    ``ACCOUNT_DEACTIVATED``)."""


class PasswordLinkInvalidError(Exception):
    """Public setup refused: unknown / expired / consumed token or an
    inactive account — ONE answer for all four (route → 422
    ``PASSWORD_LINK_INVALID``)."""


@dataclass(frozen=True)
class IssuedLink:
    """What the issue returns: the raw token (shown once; Task 4 shapes
    the HTTP response) + the expiry the caller must display."""

    raw_token: str
    expires_at: datetime


@transactional
async def issue_password_link(
    db_session: AsyncSession,
    user_id: str,
    ttl: timedelta = DEFAULT_LINK_TTL,
) -> IssuedLink | None:
    """Delete ALL former tokens of the user, insert a fresh live link.

    Returns ``None`` for an unknown ``user_id`` (route → 404); raises
    :class:`AccountDeactivatedError` for an archived account BEFORE any
    write. The audit row (``password_link_issued``) lands in the same
    transaction — author = the staged actor.

    NOTE: call as ``issue_password_link(None, db_session=...,
    user_id=...)`` — see the module docstring for why.
    """
    user = await get_user_service().get_by_id(db_session, user_id)
    if user is None:
        return None  # unknown account — the route maps to 404
    if not user.is_active:
        raise AccountDeactivatedError(user_id)

    now = datetime.utcnow()
    raw_token = secrets.token_urlsafe(_RAW_TOKEN_BYTES)
    expires_at = now + ttl

    # ONE transaction: sweep ALL former tokens (live AND consumed —
    # the table never grows per account) …
    await db_session.execute(
        sa_delete(PasswordSetupToken).where(
            PasswordSetupToken.user_id == user_id
        )
    )
    # … and insert the new live one (PK = SHA-256 digest; the raw
    # token never persists).
    db_session.add(
        PasswordSetupToken(
            token=token_digest(raw_token),
            user_id=user_id,
            expires_at=expires_at,
        )
    )
    await db_session.flush()

    # Audit (spec §8): ONE action-only row; author = the staged actor
    # (no actor → no row, §4.1). LAZY import — the audit module is off
    # -limits at top level (cycle discipline, the records.py precedent).
    from src.events.audit import mark_audit

    mark_audit(
        entity="users",
        action="password_link_issued",
        entity_id=user_id,
        changes=None,
    )
    return IssuedLink(raw_token=raw_token, expires_at=expires_at)


@transactional
async def set_password_by_link(
    db_session: AsyncSession,
    raw_token: str,
    password: str,
) -> None:
    """Consume the one-time link and set the account password.

    Fixed cost first (timing parity): policy validation + Argon2 hash
    BEFORE any DB statement. Then ONE transaction: conditional consume
    (0 rows → :class:`PasswordLinkInvalidError` — unknown, expired or
    already used), account-active check (inactive → the same error,
    the consume rolls back — an archive never burns the link), then
    the owner blocks: hash + full ladder reset (``UserService
    .apply_password_reset``) and session revocation (``AuthService
    .revoke_user_sessions``). No audit row (public call — no author).

    NOTE: call as ``set_password_by_link(None, db_session=...,
    raw_token=..., password=...)``.
    """
    # ── fixed pre-transaction cost (spec §4: hash before the write tx) ─
    password_hash = hash_password(validate_password(password))
    digest = token_digest(raw_token)

    # ── conditional consume: one statement for unknown/expired/used ────
    consumed = await db_session.execute(
        sa_update(PasswordSetupToken)
        .where(
            PasswordSetupToken.token == digest,
            PasswordSetupToken.used_at.is_(None),
            PasswordSetupToken.expires_at > datetime.utcnow(),
        )
        .values(used_at=datetime.utcnow())
        .returning(PasswordSetupToken.user_id)
    )
    user_id: str | None = consumed.scalar_one_or_none()
    if user_id is None:
        raise PasswordLinkInvalidError()

    # ── account-active check (token issued before archiving, spec §4) ──
    user = await get_user_service().get_by_id(db_session, user_id)
    if user is None or not user.is_active:
        # The raised exception rolls the consume back — the row keeps
        # used_at IS NULL: an archive never burns the link; a later
        # reactivation finds it live again.
        raise PasswordLinkInvalidError()

    # ── success: hash + WHOLE ladder reset + session revocation ────────
    # LAZY import — src.auth.service imports this chain's dependencies
    # (src.auth.permissions → src.events.audit); the function-local
    # form keeps the import graph acyclic at module load.
    from src.auth.service import get_auth_service

    await get_user_service().apply_password_reset(db_session, user, password_hash)
    await get_auth_service().revoke_user_sessions(db_session, user_id)
    await db_session.flush()
