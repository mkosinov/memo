"""Read-only masters view service (GH #266 T4, D8).

Thin view module over ``staff`` ⨝ ``masters`` (plan File Structure:
``services/master.py`` collapses into this read-only view — the old
masters CRUD service is gone, the composite :class:`StaffService` owns
all writes). Serves ACTING masters only (``masters.is_active = true``)
with the D8 wire shape: ``id`` = staff_id, names, specialty, color,
``avatar_url``, ``sort_order``.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import TYPE_CHECKING

from sqlalchemy import func, select

if TYPE_CHECKING:
    from collections.abc import Sequence
    from datetime import datetime
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession

from src.domain.errors import BareListLimitExceededError
from src.models.enums import ArchiveStatus
from src.models.master import Master
from src.models.staff import Staff
from src.repositories.search import ids_in_predicate
from src.schemas.common import PaginatedResponse
from src.schemas.master import MasterViewResponse
from src.services.generic import BARE_LIST_MAX_ROWS


@dataclass
class _MasterViewRow:
    """Attribute glue: staff row + master extension → view wire shape."""

    id: str
    first_name: str
    last_name: str
    specialty: str
    color: str
    avatar_url: str | None
    sort_order: int
    archived: bool
    created_at: datetime
    updated_at: datetime

    @classmethod
    def build(cls, staff: Staff, ext: Master) -> _MasterViewRow:
        return cls(
            id=staff.id,
            first_name=staff.first_name,
            last_name=staff.last_name,
            specialty=ext.specialty,
            color=ext.color,
            avatar_url=staff.avatar_url,
            sort_order=staff.sort_order,
            archived=not ext.is_active,
            created_at=staff.created_at,
            updated_at=staff.updated_at,
        )


class MasterViewService:
    """Read-only list services for the acting-masters view."""

    _model = Staff  # walk-compatible _model (events entity resolution)

    async def _fetch(
        self, db_session: AsyncSession, order_by=None, limit: int | None = None,
        offset: int = 0, status: ArchiveStatus = ArchiveStatus.ACTIVE,
        ids: Sequence[UUID] | None = None,
    ) -> list[tuple[Staff, Master]]:
        """staff INNER JOIN masters filtered by archive status — one query.

        GH #232 §3.1: ``ids`` narrows by the VIEW identity (``id`` on the
        wire = ``staff_id``) via the shared one-line helper.
        """
        stmt = select(Staff, Master).join(Master, Master.staff_id == Staff.id)
        if status is ArchiveStatus.ACTIVE:
            stmt = stmt.where(Master.is_active.is_(True))
        elif status is ArchiveStatus.ARCHIVED:
            stmt = stmt.where(Master.is_active.is_(False))
        # ALL → no archive filter.
        id_pred = ids_in_predicate(Staff.id, ids)
        if id_pred is not None:
            stmt = stmt.where(id_pred)
        if order_by is not None:
            stmt = stmt.order_by(*order_by)
        if limit is not None:
            stmt = stmt.limit(limit)
        if offset:
            stmt = stmt.offset(offset)
        rows = await db_session.execute(stmt)
        return [tuple(r) for r in rows.all()]

    async def list(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 20,
        order_by=None,
        ids: Sequence[UUID] | None = None,
    ) -> PaginatedResponse[MasterViewResponse]:
        """Paginated view (GH #205 envelope). ``ids`` (GH #232 §3.1) is the
        typed ``?id=`` set narrowing — carried into BOTH the count and the
        page fetch so ``total`` stays honest."""
        count_stmt = (
            select(func.count())
            .select_from(Staff)
            .join(Master, Master.staff_id == Staff.id)
            .where(Master.is_active)
        )
        id_pred = ids_in_predicate(Staff.id, ids)
        if id_pred is not None:
            count_stmt = count_stmt.where(id_pred)
        total = (await db_session.execute(count_stmt)).scalar_one()
        pairs = await self._fetch(
            db_session, order_by=order_by, limit=per_page,
            offset=(page - 1) * per_page, ids=ids,
        )
        items = [
            MasterViewResponse.model_validate(_MasterViewRow.build(s, m))
            for s, m in pairs
        ]
        return PaginatedResponse(
            items=items, total=total, page=page, per_page=per_page,
        )

    async def list_all(
        self, db_session: AsyncSession, order_by=None,
        status: ArchiveStatus = ArchiveStatus.ACTIVE,
    ) -> list[MasterViewResponse]:
        """Bare /all array with the BARE_LIST_MAX_ROWS guard (GH #205).

        ``status`` (GH #267): active (default) / archived / all.
        """
        pairs = await self._fetch(
            db_session, order_by=order_by, limit=BARE_LIST_MAX_ROWS + 1,
            status=status,
        )
        if len(pairs) > BARE_LIST_MAX_ROWS:
            # Reuse the guard's canonical message via the shared error.
            raise BareListLimitExceededError(
                Staff.__tablename__, BARE_LIST_MAX_ROWS
            )
        return [
            MasterViewResponse.model_validate(_MasterViewRow.build(s, m))
            for s, m in pairs
        ]


@lru_cache
def get_master_view_service() -> MasterViewService:
    return MasterViewService()
