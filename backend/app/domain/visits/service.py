"""Business logic for visit read and status update operations."""

from datetime import UTC, datetime
from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.visit import Visit


class VisitService:
    """Handles visit entity operations (read-only + status update)."""

    def __init__(self) -> None:
        pass

    async def get_by_id(self, db_session: AsyncSession, visit_id: str) -> Visit | None:
        """Return a visit by ID, or None if not found."""
        result = await db_session.execute(
            select(Visit).where(Visit.id == visit_id)
        )
        return result.scalar_one_or_none()

    async def update_status(self, db_session: AsyncSession, visit_id: str, status: str) -> Visit | None:
        """Update a visit's status. Returns None if not found."""
        visit = await self.get_by_id(db_session=db_session, visit_id=visit_id)
        if not visit:
            return None
        visit.status = status
        visit.updated_at = datetime.now(UTC)
        await db_session.flush()
        await db_session.refresh(visit)
        return visit


@lru_cache
def get_visit_service() -> VisitService:
    """Returns a singleton VisitService."""
    return VisitService()
