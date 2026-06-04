"""Business logic for record CRUD operations with nested visits."""

from datetime import UTC, datetime
from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.repositories.generic import GenericRepository, get_generic_repository
from src.models.client import Client
from src.models.record import Record
from src.models.visit import Visit
from src.models.visitor import Visitor
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
        """Create record with nested visits, auto-compute seats.

        Supports both phone-based and client-ID-based flows.
        """
        # ── Resolve client ──────────────────────────────────────────────
        if data.phone:
            client = await self._resolve_client_by_phone(db_session, data)
        else:
            client = None

        # ── Resolve visitors (name-based or ID-based) ───────────────────
        visitor_ids: list[str] = []
        for item in data.visits:
            if item.name:
                # Name-based flow: find-or-create Visitor
                visitor = await self._resolve_visitor_by_name(
                    db_session, client_id=client.id if client else data.client_id, name=item.name, age=item.age,
                )
                visitor_ids.append(visitor.id)
            elif item.visitor_id:
                # ID-based flow: use existing Visitor directly
                visitor_ids.append(item.visitor_id)
            else:
                raise ValueError("Each visit must have either 'name' or 'visitor_id'")

        # ── Create Record ───────────────────────────────────────────────
        record = Record(
            activity_id=data.activity_id,
            client_id=client.id if client else data.client_id,
            status=data.status.value if data.status else "pending",
            seats=len(data.visits),
            comment=data.comment,
        )
        db_session.add(record)
        await db_session.flush()

        # ── Create Visits ───────────────────────────────────────────────
        for i, item in enumerate(data.visits):
            visit = Visit(
                record_id=record.id,
                visitor_id=visitor_ids[i],
                price=item.price,
                status=item.status,
            )
            db_session.add(visit)

        await db_session.flush()
        await db_session.refresh(record)
        return record

    @staticmethod
    async def _resolve_client_by_phone(
        db_session: AsyncSession, data: RecordCreate,
    ) -> Client:
        """Find existing client by phone or create a new one."""
        result = await db_session.execute(
            select(Client).where(Client.phone == data.phone)
        )
        client = result.scalar_one_or_none()
        if not client:
            first_name = data.visits[0].name if data.visits else "Гость"
            client = Client(
                phone=data.phone,
                name=first_name,
                channel="whatsapp",
            )
            db_session.add(client)
            await db_session.flush()
        return client

    @staticmethod
    async def _resolve_visitor_by_name(
        db_session: AsyncSession,
        client_id: str | None,
        name: str,
        age: int | None = None,
    ) -> Visitor:
        """Find existing visitor by client_id + name or create a new one."""
        result = await db_session.execute(
            select(Visitor).where(
                Visitor.client_id == client_id,
                Visitor.name == name,
            )
        )
        visitor = result.scalar_one_or_none()
        if not visitor:
            visitor = Visitor(
                client_id=client_id,
                name=name,
                age=age,
            )
            db_session.add(visitor)
            await db_session.flush()
        return visitor

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
    return RecordService(get_generic_repository(), Record)
