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
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession

from src.domain.errors import BareListLimitExceededError
from src.models.master import Master
from src.models.staff import Staff
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
            created_at=staff.created_at,
            updated_at=staff.updated_at,
        )


class MasterViewService:
    """Read-only list services for the acting-masters view."""

    _model = Staff  # walk-compatible _model (events entity resolution)

    async def _fetch(
        self, db_session: AsyncSession, order_by=None, limit: int | None = None,
        offset: int = 0,
    ) -> list[tuple[Staff, Master]]:
        """Acting masters: staff INNER JOIN masters ON is_active — one query."""
        stmt = (
            select(Staff, Master)
            .join(Master, Master.staff_id == Staff.id)
            .where(Master.is_active)
        )
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
    ) -> PaginatedResponse[MasterViewResponse]:
        """Paginated view (GH #205 envelope)."""
        total = (
            await db_session.execute(
                select(func.count())
                .select_from(Staff)
                .join(Master, Master.staff_id == Staff.id)
                .where(Master.is_active)
            )
        ).scalar_one()
        pairs = await self._fetch(
            db_session, order_by=order_by, limit=per_page,
            offset=(page - 1) * per_page,
        )
        items = [
            MasterViewResponse.model_validate(_MasterViewRow.build(s, m))
            for s, m in pairs
        ]
        return PaginatedResponse(
            items=items, total=total, page=page, per_page=per_page,
        )

    async def list_all(
        self, db_session: AsyncSession, order_by=None
    ) -> list[MasterViewResponse]:
        """Bare /all array with the BARE_LIST_MAX_ROWS guard (GH #205)."""
        pairs = await self._fetch(
            db_session, order_by=order_by, limit=BARE_LIST_MAX_ROWS + 1
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
