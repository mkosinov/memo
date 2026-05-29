"""Business logic for visit read and status update operations."""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.visit import Visit


class VisitService:
    """Handles visit entity operations (read-only + status update)."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_id(self, visit_id: str) -> Visit | None:
        """Return a visit by ID, or None if not found."""
        result = await self._session.execute(
            select(Visit).where(Visit.id == visit_id)
        )
        return result.scalar_one_or_none()

    async def update_status(self, visit_id: str, status: str) -> Visit | None:
        """Update a visit's status. Returns None if not found."""
        visit = await self.get_by_id(visit_id)
        if not visit:
            return None
        visit.status = status
        visit.updated_at = datetime.now(UTC)
        await self._session.flush()
        await self._session.refresh(visit)
        return visit
