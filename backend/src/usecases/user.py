"""User scenarios — business actions around a user account (GH #319).

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
