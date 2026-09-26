"""UserService — the ``users`` writing owner (GH #326 Task 1).

Standalone service (``entity_name = "users"``, the ``VisitService`` /
``UserSettingsService`` precedent): every method is a SCENARIO BUILDING
BLOCK — no ``@transactional`` (canon docs/domain-rules/service-layer.md
rule 3), the session arrives as an argument, only ``flush()``; the
usecases layer (``create_user``, ``create_staff`` …) owns the
transaction boundary. ``mark_changed`` fires by fact of change:
unconditionally on a created row, on rowcount for the set-based updates.

Password policy stays inside the operation: ``validate_password`` →
``hash_password`` (domain helpers of ``auth/passwords.py`` — the auth
module itself is untouched); only the hash is stored, the plaintext
never lands on the row.

The role selection (position template D10, GH #263) moved here from
``StaffService`` as the pure function :func:`resolve_account_role`.
``users.staff_id`` is UNIQUE (one account per card), so every operation
writes «by card» — no set semantics needed.

GH #319 integration (main): the low-level row ops ``get_by_phone`` /
``create_row`` of the former main-only ``UserService`` are merged into
this single owner class — pure row operations, kept verbatim (NO
``mark_changed`` inside: their publication is owned by the calling
scenario's own accumulator, e.g. ``usecases/user.py::create_user``).
"""

from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING, Any, cast

from sqlalchemy import select, update

from src.auth.passwords import hash_password, validate_password
from src.events.emitter import mark_changed
from src.models.enums import UserRole
from src.models.user import User
from src.repositories.generic import BaseRepository, get_base_repository

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy.ext.asyncio import AsyncSession

# GH #263 D10 — role template anchored on the FIXED system position ids
# (never on title, D4 #266: titles are freely editable). Seniority:
# admin > master — several anchored positions collapse to the senior one.
_POSITION_ROLE_TEMPLATE: dict[str, UserRole] = {
    "admin": UserRole.ADMIN,
    "master": UserRole.MASTER,
}


def _template_role(position_ids: Sequence[str]) -> UserRole | None:
    """Highest template role among *position_ids* (admin > master).

    ``None`` = none of the anchored positions present — «прочие должности
    роль не трогают». Deliberate edge (D10): a set that LOSES master/admin
    also yields ``None`` → the linked account keeps its current role
    (removal is not a downgrade; roles are manual outside the template).
    """
    roles = [
        _POSITION_ROLE_TEMPLATE[pid]
        for pid in dict.fromkeys(position_ids)
        if pid in _POSITION_ROLE_TEMPLATE
    ]
    if UserRole.ADMIN in roles:
        return UserRole.ADMIN
    if roles:
        return UserRole.MASTER
    return None


def resolve_account_role(
    explicit_role: UserRole | None,
    position_ids: Sequence[str],
    has_master_section: bool,
) -> UserRole:
    """Account role for a staff card — explicit → template → fallback.

    Priority (GH #263 D10, moved verbatim from ``StaffService.create``):

    1. explicit role from the request body (ручная правка) always wins;
    2. otherwise the position template — the highest anchored system
       position (``admin`` > ``master``); custom positions (SMM) never
       influence the role;
    3. no anchored position → the legacy #247 fallback: a master section
       on the card means ``master``, otherwise ``admin``.
    """
    if explicit_role is not None:
        return explicit_role
    template = _template_role(position_ids)
    if template is not None:
        return template
    return UserRole.MASTER if has_master_section else UserRole.ADMIN


class UserService:
    """``users`` owner — scenario building blocks, never commits."""

    # Standalone service (no GenericService ``_model``) — canonical entity
    # name declared explicitly (spec §3.3/§3.4).
    entity_name: str = "users"

    def __init__(self, repository: BaseRepository) -> None:
        """Hold the shared ``BaseRepository`` (stateless, any model)."""
        self._repository: BaseRepository = repository

    # ─── low-level row ops (GH #319, main) ─────────────────────────────
    # Pure row operations — NO mark_changed: publication belongs to the
    # calling scenario's accumulator (``usecases/user.py::create_user``).

    async def get_by_phone(
        self, session: AsyncSession, phone: str
    ) -> User | None:
        """Find a user by phone (ORM row or None)."""
        stmt = select(User).where(User.phone == phone)
        result = await session.execute(stmt)
        return result.scalar_one_or_none()

    async def create_row(
        self,
        session: AsyncSession,
        *,
        phone: str,
        role: str,
        password_hash: str,
    ) -> User:
        """INSERT a ``users`` row and flush (materializes ``user.id``)."""
        user = User(
            phone=phone,
            role=role,
            password_hash=password_hash,
        )
        session.add(user)
        await session.flush()
        return user

    # ─── staff-account blocks (GH #326 Task 1) ─────────────────────────

    async def create_staff_account(
        self,
        db_session: AsyncSession,
        staff_id: str,
        phone: str,
        password: str,
        role: UserRole,
    ) -> User:
        """Insert a login account linked to the staff card.

        The password is validated against the policy and hashed INSIDE
        (``PasswordPolicyError`` propagates to the 422 mapping); only
        ``password_hash`` is stored. Flush, no commit; the created row is
        a fact → ``mark_changed("users")`` unconditionally.

        ONLY the ``users`` row (canon rule 1 — the row owner never
        writes foreign tables). The GH #319 UserSettings guarantee is
        composed by the ``create_staff`` scenario (``usecases/staff.py``)
        right after this block — the same pattern as the ``create_user``
        scenario (``usecases/user.py``).
        """
        user = User(
            phone=phone,
            password_hash=hash_password(validate_password(password)),
            role=role.value,
            staff_id=staff_id,
        )
        db_session.add(user)
        await db_session.flush()
        mark_changed("users")
        return user

    async def set_role_by_staff(
        self, db_session: AsyncSession, staff_id: str, role: UserRole
    ) -> int:
        """Set the linked account's role (by card, active-flag ignored —
        same semantics as the former ``_apply_role_template``).

        Returns the rowcount; marks ``"users"`` only when a row changed.
        """
        result = await db_session.execute(
            update(User)
            .where(User.staff_id == staff_id)
            .values(role=role.value)
        )
        rowcount = int(cast("Any", result).rowcount)
        if rowcount:
            mark_changed("users")
        return rowcount

    async def deactivate_active_by_staff(
        self, db_session: AsyncSession, staff_id: str
    ) -> int:
        """Deactivate the linked account — ONLY if currently active.

        The D6 dismissal checkbox semantics: an already-archived account
        is untouched (an archive call never silently restores anything).
        Returns the rowcount; marks ``"users"`` only when a row changed.
        """
        result = await db_session.execute(
            update(User)
            .where(User.staff_id == staff_id, User.is_active)
            .values(is_active=False)
        )
        rowcount = int(cast("Any", result).rowcount)
        if rowcount:
            mark_changed("users")
        return rowcount


@lru_cache
def get_user_service() -> UserService:
    """Returns a singleton UserService over the shared BaseRepository."""
    return UserService(get_base_repository())
