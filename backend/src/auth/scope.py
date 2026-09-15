"""Per-master scope context + contact mask — GH #263 T1 (D1/D3).

Above the role matrix (``permissions.py``) the ``master`` role gets a
server-side «only mine» scope (spec
docs/specs/2026-09-10-master-role-design.md D1): the anchor is
``master_key`` = the account's masters row (``users.staff_id`` →
``masters.staff_id``, post-#266) — exactly the value
``activities.master_id`` references, so the later filters are plain
``activity.master_id == master_key`` joins.

Rules (D1, domain rules «Per-master data scoping»):

* **admin → no scope**: ``master_key=None`` means «no filter»;
* **master with a masters row → scoped**: one join users → staff →
  masters yields the key; the scope ignores ``masters.is_active`` (the
  schedule flag) — an ARCHIVED masters row keeps the key alive so
  history stays visible;
* **master without a masters row → EMPTY scope, not «no filter»**:
  ``master_key`` is the ``EMPTY_SCOPE_KEY`` sentinel — never ``None``,
  so a scope filter can never degrade into «the whole studio»;
* unknown roles (defensive) get the empty sentinel too.

``mask_phone`` is the single contact-mask implementation (D3): applied
by services when building client-bearing responses for masters — keep
non-digit separators in place, every digit except the LAST 4 → ``•``
in its position, fewer than 4 digits → fully masked, ``None`` →
``None``. Mutations are never masked: the master creates a client with
the full number (WYSIWYG #221); the mask is read-side only.

Spec: docs/specs/2026-09-10-master-role-design.md (D1, D3, Scope-слой)
Domain rules: docs/domain-rules/auth.md (Per-master data scoping #263)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Final

from fastapi import Depends
from sqlalchemy import select

# Runtime import (not TYPE_CHECKING): FastAPI's get_type_hints resolves
# dependency signatures at registration time (same as Request in
# permissions.py) — hence the TC002 noqa.
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: TC002

from src.auth.permissions import AuthedUser, require_session
from src.db import db_manager
from src.models.enums import UserRole
from src.models.master import Master
from src.models.staff import Staff
from src.models.user import User

# Sentinel master_key for «master without a masters row» (and, defensively,
# unknown roles): an unfilterable context that still carries a master_key,
# so consumers filtering ``entity.master_id == scope.master_key`` match a
# deliberately EMPTY set — never «no filter» (D1 safety rule). The value
# cannot collide with real keys: PKs are UUIDs or former m-ids («m1»…),
# this constant is neither.
EMPTY_SCOPE_KEY: Final[str] = "__empty_scope__#263"


@dataclass(frozen=True)
class ScopeContext:
    """Scope carried through a request (D1).

    ``master_key`` semantics:

    * ``None`` — admin: no scope filter (the whole studio);
    * ``EMPTY_SCOPE_KEY`` — master without a masters row: filter by a key
      that matches nothing (deliberately empty result set);
    * any other value — the master's own key (``masters.staff_id``).
    """

    user_id: str
    role: str
    master_key: str | None = None

    @property
    def is_scoped(self) -> bool:
        """True for a master WITH a real masters row (a live filter)."""
        return self.master_key is not None and self.master_key != EMPTY_SCOPE_KEY

    @property
    def is_empty_scope(self) -> bool:
        """True for the empty-scope sentinel (see nothing, not see all)."""
        return self.master_key == EMPTY_SCOPE_KEY


def mask_phone(phone: str | None) -> str | None:
    """Mask all but the LAST 4 digits, preserving non-digits in place.

    ``+7 909 123-45-67`` → ``+• ••• •••-45-67``. Strings with fewer than
    4 digits are masked entirely (separators still preserved); ``None``
    maps to ``None``.
    """
    if phone is None:
        return None
    digit_positions = [i for i, ch in enumerate(phone) if ch.isdigit()]
    visible: set[int] = set() if len(digit_positions) < 4 else set(digit_positions[-4:])
    return "".join("•" if (ch.isdigit() and i not in visible) else ch for i, ch in enumerate(phone))


async def resolve_scope(db_session: AsyncSession, authed: AuthedUser) -> ScopeContext:
    """Build the scope context for an authenticated principal.

    Admin → context without scope, no query. Master → ONE select joining
    users → staff → masters for the account's masters row; found → its
    ``staff_id`` (regardless of ``masters.is_active``), missing → the
    empty-scope sentinel. Any other role → the sentinel (never unfiltered).
    """
    if authed.role == UserRole.ADMIN.value:
        return ScopeContext(user_id=authed.id, role=authed.role, master_key=None)

    master_key: str | None = EMPTY_SCOPE_KEY
    if authed.role == UserRole.MASTER.value:
        # One join users → staff → masters (the key doubles as masters PK).
        row = (
            await db_session.execute(
                select(Master.staff_id)
                .join(Staff, Staff.id == Master.staff_id)
                .join(User, User.staff_id == Staff.id)
                .where(User.id == authed.id)
                .limit(1)
            )
        ).scalar_one_or_none()
        if row is not None:
            master_key = row

    return ScopeContext(user_id=authed.id, role=authed.role, master_key=master_key)


async def get_scope(
    db_session: Annotated[AsyncSession, Depends(db_manager.get_db_session)],
    # B008 (`Depends` in defaults) is the idiomatic FastAPI dependency
    # pattern used across this repo (cf. require_session).
    authed: AuthedUser = Depends(require_session),  # noqa: B008
) -> ScopeContext:
    """FastAPI dependency: session guard + scope resolution (D1).

    401 from ``require_session`` for anonymous/expired requests; the
    scope never broadens what the session authenticated.
    """
    return await resolve_scope(db_session, authed)
