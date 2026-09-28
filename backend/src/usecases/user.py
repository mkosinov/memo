"""User scenarios — business actions around a user account (GH #319/#348).

Corridor 2 of the service canon (docs/domain-rules/service-layer.md
rule 2): each scenario is a public function named after the business
action, decorated ``@transactional`` (ONE transaction + ONE event batch
per action), composing undecorated service methods and domain functions
only — no RUNTIME ORM-model imports (the only model reference is the
TYPE_CHECKING-only return annotation; ORM rows are built by the owning
service — ``UserService.create_row``).

``create_user`` = the ``users`` row insert + the UserSettings defaults
core (``UserSettingsService.insert_defaults``) in the SAME transaction —
the GH #319 guarantee (domain-rules/auth.md «User Lifecycle»,
user_settings.md at-rest invariant): a created user ALWAYS has its
settings row. The defaults core publishes NO separate bus-invalidation
event from inside the parent transaction (conscious simplification).
The CLI dev surface keeps its PASSWORD (spec #348 §7) — this scenario
is called from ``cli.py``, never from the staff-card flow (the card
block creates passwordless rows via ``UserService.create_staff_account``).

``update_user_phone`` (GH #348 Task 3, spec §4 — S5) = the admin-side
phone edit of an existing account:

* unknown user → ``None`` (route → 404); the SHARED phone validator
  (:func:`src.domain.phones.validate_phone`) gates the value;
* uniqueness is EXACT-STRING (no normalization — that would break
  existing accounts' logins): an explicit probe raises
  :class:`PhoneTakenError` for ANY holder (archived included — the DB
  unique constraint has no active-filter); a same-string no-op writes
  nothing and journals nothing (audit §5.1);
* success journals ONE ``update`` row (entity ``users``, author = the
  staged admin actor) — the phone pair is MASKED by the canon audit
  serializer (§5.1, last 4 digits; the full number never enters the
  snapshot);
* SESSIONS ARE NOT REVOKED (spec §4: cookie sessions are not tied to
  the phone — contrast ``set_password_by_link``, S8).

CALLING CONVENTION: the ``@transactional`` wrapper's signature is
``wrapper(self, *args, **kwargs)`` — a module-level scenario therefore
MUST be called with an explicit leading ``None`` (the unused ``self``
slot) and keyword arguments::

    user = await create_user(None, db_session=session, phone=..., ...)

A bare positional call would bind the session to the wrapper's ``self``
slot and shift every argument — that misdirection fails loudly
(TypeError), never silently (see ``src/usecases/records.py``).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from src.auth.passwords import hash_password, validate_password
from src.domain.errors import PhoneTakenError
from src.domain.phones import validate_phone
from src.events.emitter import mark_changed
from src.services.decorators import transactional
from src.services.user import get_user_service
from src.services.user_settings import UserSettingsService

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from src.models.user import User


class DuplicatePhoneError(Exception):
    """A user with this phone already exists."""


@transactional
async def create_user(
    db_session: AsyncSession,
    phone: str,
    role: str,
    password: str,
) -> User:
    """Validate and INSERT a staff user + its UserSettings defaults row —
    ONE transaction.

    Formerly ``cli.create_user`` (behavior-for-behavior move) + the GH #319
    guarantee. The phone is trimmed (login trims too, spec §2.3); the
    password runs through ``validate_password`` (policy gate → trimmed
    value) before hashing. Raises ``DuplicatePhoneError`` when the phone is
    taken and ``PasswordPolicyError`` when the password fails the policy
    (in which case nothing is inserted).

    NOTE: call as ``create_user(None, db_session=..., ...)`` — see the
    module docstring for why.
    """
    # Own-entity mark — the selfless @transactional path seeds an EMPTY
    # accumulator (no auto-mark), so user creation surfaces "users"
    # (parity with the staff-card «Учётка» flow's mark).
    mark_changed("users")

    phone = phone.strip()
    user_service = get_user_service()
    existing = await user_service.get_by_phone(db_session, phone)
    if existing is not None:
        raise DuplicatePhoneError(phone)

    password = validate_password(password)
    user = await user_service.create_row(
        db_session,
        phone=phone,
        role=role,
        password_hash=hash_password(password),
    )
    # GH #319: guaranteed child record — the defaults row in the SAME
    # transaction (silent core: no separate bus-invalidation event).
    await UserSettingsService.insert_defaults(db_session, user.id)
    return user


@transactional
async def update_user_phone(
    db_session: AsyncSession,
    user_id: str,
    phone: str,
) -> User | None:
    """Edit an account's phone — the admin-side S5 scenario (#348 §4).

    Returns ``None`` for an unknown ``user_id`` (route → 404). The value
    runs through the SHARED validator (:func:`validate_phone` → 422
    ``PHONE_INVALID``); an exact-string holder (any active flag) raises
    :class:`PhoneTakenError` (422 ``PHONE_TAKEN``) BEFORE any write. A
    same-string no-op is a pure read — no row write, no journal row
    (audit §5.1). On success ONE audit ``update`` row lands in the same
    transaction (the canon serializer masks the phone pair — the raw
    number never enters the snapshot); sessions stay (cookie sessions
    are not tied to the phone).

    NOTE: call as ``update_user_phone(None, db_session=..., user_id=...,
    phone=...)`` — see the module docstring for why.
    """
    user_service = get_user_service()
    user = await user_service.get_by_id(db_session, user_id)
    if user is None:
        return None  # unknown account — the route maps to 404

    phone = validate_phone(phone)

    # Same trimmed string → a no-op write would journal a zero diff (§5.1
    # — no-op fields never journal); short-circuit before any mutation.
    old_phone = user.phone
    if phone == old_phone:
        return user

    # Exact-string uniqueness — ANY holder counts (archived included:
    # the DB unique constraint has no active-filter).
    if await user_service.get_by_phone(db_session, phone) is not None:
        raise PhoneTakenError(phone)

    user.phone = phone
    await db_session.flush()
    mark_changed("users")

    # Audit (spec §8): ONE update row; the ``phone`` pair is masked by
    # the canon serializer (§5.1). LAZY import — the audit module is
    # off-limits at top level (cycle discipline, the records.py
    # precedent).
    from src.events.audit import mark_audit

    mark_audit(
        entity="users",
        action="update",
        entity_id=user_id,
        changes={"phone": [old_phone, phone]},
    )
    return user
