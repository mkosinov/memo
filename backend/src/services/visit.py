"""Business logic for visit CRUD operations.

Cascade logic lives in the domain layer (record_visits.py) as free
functions. VisitService orchestrates but never calls another service.
"""

from datetime import UTC, datetime
from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.domain.record_visits import (
    recompute_record_seats,
    recompute_record_status,
    check_activity_capacity,
)
from src.models.record import Record
from src.models.visit import Visit
from src.schemas.visit import VisitCreate, VisitUpdate, VisitPatch


class VisitService:
    """No __init__ deps — cascade lives in domain layer.

    In production, FastAPI Depends(get_visit_service) returns a singleton.
    In tests, you can instantiate VisitService() directly (no mocks needed).
    """

    async def list(
        self, db_session: AsyncSession, record_id: str | None = None,
    ) -> list[Visit]:
        """Return active visits, optionally filtered by record_id."""
        stmt = select(Visit).where(Visit.is_active.is_(True))
        if record_id is not None:
            stmt = stmt.where(Visit.record_id == record_id)
        result = await db_session.execute(stmt)
        return list(result.scalars().all())

    async def get(self, db_session: AsyncSession, visit_id: str) -> Visit | None:
        """Return a visit by ID, or None if not found."""
        result = await db_session.execute(
            select(Visit).where(Visit.id == visit_id)
        )
        return result.scalar_one_or_none()

    async def create(
        self, db_session: AsyncSession, data: VisitCreate,
    ) -> Visit | None:
        """Create a new visit, then cascade: derive record.status + record.seats.

        Returns None if the parent record doesn't exist.
        Raises HTTPException 409 + ErrorCode.ACTIVITY_AT_CAPACITY if activity is at capacity.
        """
        # 1. Verify parent record exists
        record = await db_session.get(Record, data.record_id)
        if not record:
            return None
        # 2. Capacity check
        await check_activity_capacity(db_session, record.activity_id, seats=1)
        # 3. Insert visit
        visit = Visit(**data.model_dump())
        db_session.add(visit)
        await db_session.flush()
        # 4. Cascade via domain functions (no service-to-service dep)
        await recompute_record_status(db_session, visit.record_id)
        await recompute_record_seats(db_session, visit.record_id)
        await db_session.flush()
        await db_session.refresh(visit)
        return visit

    async def update(
        self, db_session: AsyncSession, visit_id: str, data: VisitUpdate,
    ) -> Visit | None:
        """Full-replace update. Cascade only status (seats unchanged — is_active not in VisitUpdate)."""
        visit = await self.get(db_session, visit_id)
        if not visit:
            return None
        for field, value in data.model_dump().items():
            setattr(visit, field, value)
        visit.updated_at = datetime.now(UTC)
        await db_session.flush()
        # Cascade: status only (seats: no change — is_active not exposed in VisitUpdate)
        await recompute_record_status(db_session, visit.record_id)
        await db_session.flush()
        await db_session.refresh(visit)
        return visit

    async def patch(
        self, db_session: AsyncSession, visit_id: str, data: VisitPatch,
    ) -> Visit | None:
        """Partial update — only fields explicitly set in `data` are applied.

        Cascade only status (seats unchanged — is_active not in VisitPatch).
        """
        visit = await self.get(db_session, visit_id)
        if not visit:
            return None
        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(visit, field, value)
        visit.updated_at = datetime.now(UTC)
        await db_session.flush()
        # Cascade: status only
        await recompute_record_status(db_session, visit.record_id)
        await db_session.flush()
        await db_session.refresh(visit)
        return visit

    async def delete(self, db_session: AsyncSession, visit_id: str) -> bool:
        """Soft-delete the visit (is_active=False) and cascade: derive record.status + record.seats.

        seats -= 1 because the deleted visit is no longer in len(active_visits).
        """
        visit = await self.get(db_session, visit_id)
        if not visit:
            return False
        visit.is_active = False
        visit.updated_at = datetime.now(UTC)
        await db_session.flush()
        # Cascade via domain functions
        await recompute_record_status(db_session, visit.record_id)
        await recompute_record_seats(db_session, visit.record_id)
        await db_session.flush()
        return True

    async def update_status(
        self, db_session: AsyncSession, visit_id: str, status: str,
    ) -> Visit | None:
        """Update a visit's status and re-derive the parent record's status."""
        visit = await self.get(db_session, visit_id)
        if not visit:
            return None
        visit.status = status
        visit.updated_at = datetime.now(UTC)
        # Use the domain function instead of inlined logic
        await recompute_record_status(db_session, visit.record_id)
        await db_session.flush()
        await db_session.refresh(visit)
        return visit


@lru_cache
def get_visit_service() -> VisitService:
    """Returns a singleton VisitService."""
    return VisitService()
