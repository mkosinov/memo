"""Business logic for record CRUD operations with nested visits."""

from datetime import UTC, datetime
from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.db.repository import GenericRepository, get_repository
from src.models.record import Record
from src.models.visit import Visit
from src.schemas.record import RecordCreate, RecordResponse, RecordUpdate
from src.services.generic import GenericService


class RecordService(GenericService[RecordCreate, RecordUpdate, RecordResponse]):
    """Record service with nested visit management."""

    def __init__(
        self, repository: GenericRepository, model: type[Record]
    ) -> None:
        super().__init__(repository, model, response_schema=RecordResponse)

    async def list(
        self, db_session: AsyncSession, **filters
    ) -> list[Record]:
        """Return all active records with visits eagerly loaded (raw ORM)."""
        result = await db_session.execute(
            select(Record)
            .where(Record.is_active)
            .options(selectinload(Record.visits))
        )
        return list(result.scalars().all())

    async def get(
        self, db_session: AsyncSession, id: str
    ) -> Record | None:
        """Return a record by ID with visits eagerly loaded (raw ORM)."""
        result = await db_session.execute(
            select(Record)
            .where(Record.id == id)
            .options(selectinload(Record.visits))
        )
        return result.scalar_one_or_none()

    async def create(
        self, db_session: AsyncSession, data: RecordCreate
    ) -> Record:
        """Create record with nested visits, auto-compute seats."""
        record = Record(
            activity_id=data.activity_id,
            client_id=data.client_id,
            status="pending",
            seats=len(data.visits),
            comment=data.comment,
        )
        db_session.add(record)
        await db_session.flush()

        for visit_item in data.visits:
            visit = Visit(
                record_id=record.id,
                visitor_id=visit_item.visitor_id,
                price=visit_item.price,
                status=visit_item.status,
            )
            db_session.add(visit)

        await db_session.flush()
        await db_session.refresh(record)
        return record

    async def update(
        self, db_session: AsyncSession, id: str, data: RecordUpdate
    ) -> Record | None:
        """Full-update record: replace visits, recalculate seats."""
        record = await self.get(db_session, id)
        if not record:
            return None

        record.activity_id = data.activity_id
        record.client_id = data.client_id
        record.status = data.status
        record.comment = data.comment
        record.seats = len(data.visits)
        record.updated_at = datetime.now(UTC)

        for existing_visit in record.visits:
            existing_visit.is_active = False

        for visit_item in data.visits:
            visit = Visit(
                record_id=record.id,
                visitor_id=visit_item.visitor_id,
                price=visit_item.price,
                status=visit_item.status,
            )
            db_session.add(visit)

        await db_session.flush()
        await db_session.refresh(record)
        return record


@lru_cache
def get_record_service() -> RecordService:
    """Returns a singleton RecordService."""
    return RecordService(get_repository(), Record)
