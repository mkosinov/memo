"""Business logic for activity CRUD operations with date filtering and occupied computation."""

from __future__ import annotations

from datetime import datetime
from functools import lru_cache
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.generic import GenericRepository, get_generic_repository
from src.models.activity import Activity
from src.models.record import Record
from src.schemas.activity import ActivityCreate, ActivityResponse, ActivityUpdate
from src.services.generic import GenericService


class ActivityService(GenericService[ActivityCreate, ActivityUpdate, ActivityResponse]):
    """Activity service with date filtering and occupied count."""

    # Fields that map to NOT NULL columns in the activities table.
    # Patch should silently ignore null values for these fields.
    NOT_NULL_FIELDS = {"master_id", "service_id", "location_id", "start", "duration", "capacity"}

    # Only VisitStatus values that mean "the visit will happen or has happened".
    # Cancelled and missed are excluded from the sum.
    ACTIVE_RECORD_STATUSES = ("waiting", "visited")

    def __init__(
        self, repository: GenericRepository, model: type[Activity]
    ) -> None:
        super().__init__(repository, model, response_schema=ActivityResponse)

    async def list(
        self,
        db_session: AsyncSession,
        date_from: str | None = None,
        date_to: str | None = None,
        **filters,
    ) -> list[Activity]:
        """List activities with optional date range filter."""
        if date_from or date_to:
            return await self._list_by_date(db_session, date_from, date_to)
        return await super().list(db_session, **filters)

    async def _list_by_date(
        self,
        db_session: AsyncSession,
        date_from: str | None,
        date_to: str | None,
    ) -> list[Activity]:
        """Return active activities filtered by date range."""
        stmt = select(Activity).where(Activity.is_active)
        if date_from:
            from_dt = datetime.fromisoformat(date_from)
            stmt = stmt.where(Activity.start >= from_dt)
        if date_to:
            to_dt = datetime.fromisoformat(date_to)
            to_dt = to_dt.replace(hour=23, minute=59, second=59)
            stmt = stmt.where(Activity.start <= to_dt)
        result = await db_session.execute(stmt)
        return list(result.scalars().all())

    async def sum_active_seats(
        self, db_session: AsyncSession, activity_id: str
    ) -> int:
        """Return SUM(seats) for active records (excludes cancelled/missed).

        Active = is_active AND status IN ('waiting', 'visited').
        """
        result = await db_session.execute(
            select(func.coalesce(func.sum(Record.seats), 0)).where(
                Record.activity_id == activity_id,
                Record.is_active.is_(True),  # type: ignore[union-attr]
                Record.status.in_(self.ACTIVE_RECORD_STATUSES),
            )
        )
        return int(result.scalar() or 0)

    async def count_records(
        self, db_session: AsyncSession, activity_id: str
    ) -> int:
        """DEPRECATED: counts ALL records (including cancelled). Use sum_active_seats."""
        result = await db_session.execute(
            select(func.count(Record.id)).where(
                Record.activity_id == activity_id
            )
        )
        return int(result.scalar() or 0)


@lru_cache
def get_activity_service() -> ActivityService:
    """Returns a singleton ActivityService."""
    return ActivityService(get_generic_repository(), Activity)
