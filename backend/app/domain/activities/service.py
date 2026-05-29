"""Business logic for activity CRUD operations with date filtering and occupied computation."""

from datetime import datetime
from functools import lru_cache

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.activity import Activity
from app.db.models.record import Record
from app.domain.activities.schemas import ActivityCreate, ActivityUpdate


class ActivityService:
    """Handles activity entity operations with date filtering and occupied count."""

    def __init__(self) -> None:
        pass

    async def list_all(
        self,
        db_session: AsyncSession,
        date_from: str | None = None,
        date_to: str | None = None,
    ) -> list[Activity]:
        """Return all active activities, optionally filtered by date range."""
        stmt = select(Activity).where(Activity.is_active)

        if date_from:
            from_dt = datetime.fromisoformat(date_from)
            stmt = stmt.where(Activity.start >= from_dt)
        if date_to:
            to_dt = datetime.fromisoformat(date_to)
            # Include the entire end day: set time to end of day
            to_dt = to_dt.replace(hour=23, minute=59, second=59)
            stmt = stmt.where(Activity.start <= to_dt)

        result = await db_session.execute(stmt)
        return list(result.scalars().all())

    async def get_by_id(self, db_session: AsyncSession, activity_id: str) -> Activity | None:
        """Return an activity by ID, or None if not found."""
        result = await db_session.execute(
            select(Activity).where(Activity.id == activity_id)
        )
        return result.scalar_one_or_none()

    async def create(self, db_session: AsyncSession, data: ActivityCreate) -> Activity:
        """Create a new activity and persist it."""
        activity = Activity(**data.model_dump())
        db_session.add(activity)
        await db_session.flush()
        await db_session.refresh(activity)
        return activity

    async def update(
        self, db_session: AsyncSession, activity_id: str, data: ActivityUpdate
    ) -> Activity | None:
        """Full-update an activity by ID. Returns None if not found."""
        activity = await self.get_by_id(db_session=db_session, activity_id=activity_id)
        if not activity:
            return None
        for key, value in data.model_dump().items():
            setattr(activity, key, value)
        await db_session.flush()
        await db_session.refresh(activity)
        return activity

    async def delete(self, db_session: AsyncSession, activity_id: str) -> bool:
        """Soft-delete an activity (set is_active=False). Returns False if not found."""
        activity = await self.get_by_id(db_session=db_session, activity_id=activity_id)
        if not activity:
            return False
        activity.is_active = False
        await db_session.flush()
        return True

    async def count_records(self, db_session: AsyncSession, activity_id: str) -> int:
        """Count the number of Records linked to this activity."""
        result = await db_session.execute(
            select(func.count(Record.id)).where(
                Record.activity_id == activity_id
            )
        )
        return result.scalar() or 0


@lru_cache
def get_activity_service() -> ActivityService:
    """Returns a singleton ActivityService."""
    return ActivityService()
