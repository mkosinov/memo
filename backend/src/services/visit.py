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
from src.repositories.generic import BaseRepository, get_base_repository
from src.schemas.common import PaginatedResponse
from src.schemas.visit import VisitCreate, VisitUpdate, VisitPatch, VisitResponse
from src.services.decorators import transactional


class VisitService:
    """Visit service — manual CRUD with record cascade domain hooks."""

    def __init__(self, repository: BaseRepository) -> None:
        self._repository = repository

    async def list(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 20,
        record_id: str | None = None,
    ) -> PaginatedResponse[VisitResponse]:
        """Return a paginated page of visits, optionally filtered by record_id.

        Items are validated via VisitResponse.model_validate.
        """
        items_orm, total = await self._repository.list(
            db_session,
            Visit,
            filters={"record_id": record_id},
            limit=per_page,
            offset=(page - 1) * per_page,
        )
        # VisitResponse has created_at: str / updated_at: str but ORM has datetime.
        # Pydantic v2 strict str doesn't coerce datetime, so convert manually.
        items = [
            VisitResponse(
                id=v.id,
                record_id=v.record_id,
                visitor_id=v.visitor_id,
                tariff_id=v.tariff_id,
                price=v.price,
                custom_price=v.custom_price,
                status=v.status,
                created_at=v.created_at.isoformat() if v.created_at else "",
                updated_at=v.updated_at.isoformat() if v.updated_at else "",
            )
            for v in items_orm
        ]
        return PaginatedResponse(items=items, total=total, page=page, per_page=per_page)

    async def get(self, db_session: AsyncSession, visit_id: str) -> Visit | None:
        """Return a visit by ID, or None if not found."""
        result = await db_session.execute(
            select(Visit).where(Visit.id == visit_id)
        )
        return result.scalar_one_or_none()

    @transactional
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

    @transactional
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

    @transactional
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

    @transactional
    async def delete(self, db_session: AsyncSession, visit_id: str) -> bool:
        """Hard-delete the visit and cascade: derive record.status + record.seats."""
        visit = await self.get(db_session, visit_id)
        if not visit:
            return False
        record_id = visit.record_id
        await db_session.delete(visit)
        await db_session.flush()
        # Cascade via domain functions
        await recompute_record_status(db_session, record_id)
        await recompute_record_seats(db_session, record_id)
        await db_session.flush()
        return True

    @transactional
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
    return VisitService(get_base_repository())
