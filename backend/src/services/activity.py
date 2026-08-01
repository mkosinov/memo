"""Business logic for activity CRUD operations with date filtering and occupied computation."""

from __future__ import annotations

from datetime import datetime
from functools import lru_cache
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.generic import BaseRepository, get_base_repository
from src.models.activity import Activity
from src.models.payment import Payment
from src.models.photo import Photo
from src.models.record import Record
from src.models.visit import Visit
from src.schemas.activity import ActivityCreate, ActivityResponse, ActivityUpdate
from src.schemas.common import PaginatedResponse
from src.services.generic import GenericService
from src.services.decorators import transactional
from src.domain.record_visits import active_record_filter
from src.domain.visit_status import ACTIVE_RECORD_STATUSES


class ActivityService(GenericService[ActivityCreate, ActivityUpdate, ActivityResponse]):
    """Activity service with date filtering and occupied count."""

    # Fields that map to NOT NULL columns in the activities table.
    # Patch should silently ignore null values for these fields.
    NOT_NULL_FIELDS = {"master_id", "service_id", "location_id", "start", "duration", "capacity"}

    def __init__(
        self, repository: BaseRepository, model: type[Activity]
    ) -> None:
        super().__init__(repository, model, response_schema=ActivityResponse)

    async def list(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 20,
        date_from: str | None = None,
        date_to: str | None = None,
        **filters,
    ) -> PaginatedResponse[ActivityResponse]:
        """List activities with optional date range filter, paginated."""
        if date_from or date_to:
            return await self._list_by_date(db_session, date_from, date_to, page, per_page)
        return await super().list(db_session, page=page, per_page=per_page, **filters)

    async def _list_by_date(
        self,
        db_session: AsyncSession,
        date_from: str | None,
        date_to: str | None,
        page: int,
        per_page: int,
    ) -> PaginatedResponse[ActivityResponse]:
        """Return a paginated page of activities filtered by date range."""
        stmt = select(Activity)
        if date_from:
            from_dt = datetime.fromisoformat(date_from)
            stmt = stmt.where(Activity.start >= from_dt)
        if date_to:
            to_dt = datetime.fromisoformat(date_to)
            to_dt = to_dt.replace(hour=23, minute=59, second=59)
            stmt = stmt.where(Activity.start <= to_dt)
        total = (
            await db_session.execute(select(func.count()).select_from(stmt.subquery()))
        ).scalar_one()
        result = await db_session.execute(
            stmt.limit(per_page).offset((page - 1) * per_page)
        )
        items = [ActivityResponse.model_validate(a) for a in result.scalars().all()]
        return PaginatedResponse(items=items, total=total, page=page, per_page=per_page)

    async def sum_active_seats(
        self, db_session: AsyncSession, activity_id: str
    ) -> int:
        """Return SUM(seats) for active records (excludes cancelled/missed).

        Active definition is shared with check_activity_capacity via
        domain.record_visits.active_record_filter so the view and the
        capacity check can never drift apart.
        """
        result = await db_session.execute(
            select(func.coalesce(func.sum(Record.seats), 0)).where(
                *active_record_filter(activity_id)
            )
        )
        return int(result.scalar() or 0)

    async def sum_active_seats_bulk(
        self, db_session: AsyncSession, activity_ids: list[str]
    ) -> dict[str, int]:
        """Return {activity_id: occupied_seats} for the given activities in ONE query.

        Active definition reuses ACTIVE_RECORD_STATUSES (same as active_record_filter)
        so the batch view can never drift from the per-activity capacity check.
        """
        if not activity_ids:
            return {}
        result = await db_session.execute(
            select(Record.activity_id, func.coalesce(func.sum(Record.seats), 0))
            .where(
                Record.activity_id.in_(activity_ids),
                Record.status.in_(ACTIVE_RECORD_STATUSES),
            )
            .group_by(Record.activity_id)
        )
        return {row[0]: int(row[1]) for row in result.all()}

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

    @transactional
    async def delete(self, db_session: AsyncSession, id: str) -> bool:
        """Hard-delete an activity, its records (with their visits/payments),
        and unlink photos (SET NULL).

        All cascade deletes run as explicit SQL inside this single
        ``@transactional`` transaction (no per-record commit) so the whole
        graph is removed atomically. Order matters: visits and payments
        reference records, so they are removed BEFORE the records; the
        records are removed BEFORE the activity. Photos are unlinked
        (activity_id := NULL) rather than deleted — a photo survives the
        activity that produced it (#194, G1b).
        """
        activity = await self._repository.get(db_session, Activity, id)
        if not activity:
            return False

        record_ids = (
            await db_session.execute(
                select(Record.id).where(Record.activity_id == id)
            )
        ).scalars().all()
        if record_ids:
            await db_session.execute(delete(Visit).where(Visit.record_id.in_(record_ids)))
            await db_session.execute(delete(Payment).where(Payment.record_id.in_(record_ids)))
            await db_session.execute(delete(Record).where(Record.id.in_(record_ids)))
        await db_session.execute(
            update(Photo).where(Photo.activity_id == id).values(activity_id=None)
        )
        await db_session.execute(delete(Activity).where(Activity.id == id))
        return True


@lru_cache
def get_activity_service() -> ActivityService:
    """Returns a singleton ActivityService."""
    return ActivityService(get_base_repository(), Activity)
