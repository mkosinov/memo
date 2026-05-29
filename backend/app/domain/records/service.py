"""Business logic for record CRUD operations with nested visits."""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.record import Record
from app.db.models.visit import Visit
from app.domain.records.schemas import RecordCreate, RecordUpdate


class RecordService:
    """Handles record entity operations with nested visit management."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_all(self) -> list[Record]:
        """Return all active records with visits eagerly loaded."""
        stmt = (
            select(Record)
            .where(Record.is_active)
        )
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def get_by_id(self, record_id: str) -> Record | None:
        """Return a record by ID with visits, or None if not found."""
        stmt = select(Record).where(Record.id == record_id)
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def create(self, data: RecordCreate) -> Record:
        """Create a new record with visits. Seats = len(visits), status = PENDING."""
        record = Record(
            activity_id=data.activity_id,
            client_id=data.client_id,
            status="pending",
            seats=len(data.visits),
            comment=data.comment,
        )
        self._session.add(record)
        await self._session.flush()

        for visit_item in data.visits:
            visit = Visit(
                record_id=record.id,
                visitor_id=visit_item.visitor_id,
                price=visit_item.price,
                status=visit_item.status,
            )
            self._session.add(visit)

        await self._session.flush()
        await self._session.refresh(record)
        return record

    async def update(self, record_id: str, data: RecordUpdate) -> Record | None:
        """Full-update a record, replacing visits and recalculating seats."""
        record = await self.get_by_id(record_id)
        if not record:
            return None

        record.activity_id = data.activity_id
        record.client_id = data.client_id
        record.status = data.status
        record.comment = data.comment
        record.seats = len(data.visits)
        record.updated_at = datetime.now(UTC)

        # Replace all visits: soft-delete existing, create new ones
        for existing_visit in record.visits:
            existing_visit.is_active = False

        for visit_item in data.visits:
            visit = Visit(
                record_id=record.id,
                visitor_id=visit_item.visitor_id,
                price=visit_item.price,
                status=visit_item.status,
            )
            self._session.add(visit)

        await self._session.flush()
        await self._session.refresh(record)
        return record

    async def delete(self, record_id: str) -> bool:
        """Soft-delete a record (set is_active=False). Returns False if not found."""
        record = await self.get_by_id(record_id)
        if not record:
            return False
        record.is_active = False
        await self._session.flush()
        return True
