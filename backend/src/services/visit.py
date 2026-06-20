"""Business logic for visit read and status update operations."""

from datetime import UTC, datetime
from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.domain.visit_status import VisitItem, compute_record_status
from src.models.record import Record
from src.models.visit import Visit


class VisitService:
    """Handles visit entity operations (read + status update)."""

    async def get(self, db_session: AsyncSession, visit_id: str) -> Visit | None:
        """Return a visit by ID, or None if not found."""
        result = await db_session.execute(
            select(Visit).where(Visit.id == visit_id)
        )
        return result.scalar_one_or_none()

    async def update_status(self, db_session: AsyncSession, visit_id: str, status: str) -> Visit | None:
        """Update a visit's status and re-derive the parent record's status."""
        visit = await self.get(db_session, visit_id)
        if not visit:
            return None
        visit.status = status
        visit.updated_at = datetime.now(UTC)

        # Re-derive parent record status from all active visits
        record = await self._derive_record_status(db_session, visit.record_id)

        await db_session.flush()
        await db_session.refresh(visit)
        return visit

    @staticmethod
    async def _derive_record_status(db_session: AsyncSession, record_id: str) -> Record | None:
        """Recompute record.status from its active visits."""
        result = await db_session.execute(
            select(Record).where(Record.id == record_id)
        )
        record = result.scalar_one_or_none()
        if not record:
            return None

        visits_result = await db_session.execute(
            select(Visit).where(
                Visit.record_id == record_id,
                Visit.is_active.is_(True),
            )
        )
        active_visits = list(visits_result.scalars().all())

        record.status = compute_record_status([
            VisitItem(id=v.id, status=v.status)
            for v in active_visits
        ]).value
        record.updated_at = datetime.now(UTC)
        return record


@lru_cache
def get_visit_service() -> VisitService:
    """Returns a singleton VisitService."""
    return VisitService()
