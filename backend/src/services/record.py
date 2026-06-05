"""Business logic for record CRUD operations with nested visits."""

from datetime import UTC, datetime
from functools import lru_cache

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.repositories.generic import GenericRepository, get_generic_repository
from src.models.activity import Activity
from src.models.client import Client
from src.models.payment import Payment
from src.models.record import Record
from src.models.visit import Visit
from src.models.visitor import Visitor
from src.schemas.record import RecordCreate, RecordPatch, RecordResponse, RecordUpdate
from src.services.generic import GenericService


class RecordService(GenericService[RecordCreate, RecordUpdate, RecordResponse]):
    """Record service with nested visit management."""

    def __init__(
        self, repository: GenericRepository, model: type[Record]
    ) -> None:
        super().__init__(repository, model, response_schema=RecordResponse)

    async def list(
        self, db_session: AsyncSession, client_id: str | None = None, **filters
    ) -> list[Record]:
        """Return all active records with visits eagerly loaded (raw ORM).

        Optionally filter by client_id.
        """
        stmt = (
            select(Record)
            .where(Record.is_active)
            .options(selectinload(Record.visits))
        )
        if client_id:
            stmt = stmt.where(Record.client_id == client_id)
        result = await db_session.execute(stmt)
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

    async def delete(self, db_session: AsyncSession, id: str) -> bool:
        """Soft-delete a record and cascade-soft-delete its visits and payments."""
        record = await self._repository.get(db_session, Record, id)
        if not record or not record.is_active:
            return False

        # Cascade: soft-delete all related visits
        await db_session.execute(
            update(Visit)
            .where(Visit.record_id == id, Visit.is_active.is_(True))  # type: ignore[union-attr]
            .values(is_active=False)
        )

        # Cascade: soft-delete all related payments
        await db_session.execute(
            update(Payment)
            .where(Payment.record_id == id, Payment.is_active.is_(True))  # type: ignore[union-attr]
            .values(is_active=False)
        )

        # Soft-delete the record itself
        record.is_active = False
        await db_session.flush()
        return True

    async def create(
        self, db_session: AsyncSession, data: RecordCreate
    ) -> Record:
        """Create record with nested visits, auto-compute seats.

        Supports both phone-based and client-ID-based flows.
        Raises HTTPException 409 if activity is at capacity.
        """
        # ── Capacity check ─────────────────────────────────────────────
        await self._check_capacity(db_session, data.activity_id, seats=len(data.visits))

        # ── Resolve client ──────────────────────────────────────────────
        if data.phone:
            client = await self._resolve_client_by_phone(db_session, data)
        else:
            client = None

        # ── Resolve visitors (name-based, ID-based, or anonymous) ───────
        visitor_ids: list[str | None] = []
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
                # Anonymous visit — no visitor linked
                visitor_ids.append(None)

        # ── Create Record ───────────────────────────────────────────────
        record = Record(
            activity_id=data.activity_id,
            client_id=client.id if client else data.client_id,
            status=data.status.value if data.status else "pending",
            seats=len(data.visits),
            comment=data.comment,
            custom_price=data.custom_price,
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
        record.custom_price = data.custom_price
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

    async def patch(
        self, db_session: AsyncSession, id: str, data: RecordPatch
    ) -> Record | None:
        """Partial-update record — only fields explicitly sent are changed.

        Handles visits specially: if ``visits`` is provided in the patch,
        deactivates existing visits and creates new ones; otherwise visits
        are left untouched.
        """
        record = await self.get(db_session, id)
        if not record:
            return None

        update_data = data.model_dump(exclude_unset=True)

        if "status" in update_data:
            record.status = update_data["status"]
        if "comment" in update_data:
            record.comment = update_data["comment"]
        if "custom_price" in update_data:
            record.custom_price = update_data["custom_price"]
        if "visits" in update_data:
            for existing_visit in record.visits:
                existing_visit.is_active = False
            for visit_item in update_data["visits"]:
                visit = Visit(
                    record_id=record.id,
                    visitor_id=visit_item.get("visitor_id"),
                    price=visit_item["price"],
                    status=visit_item.get("status", "waiting"),
                )
                db_session.add(visit)
            record.seats = len(update_data["visits"])

        record.updated_at = datetime.now(UTC)
        await db_session.flush()
        await db_session.refresh(record)
        return record

    @staticmethod
    async def _check_capacity(
        db_session: AsyncSession, activity_id: str, seats: int = 1,
    ) -> None:
        """Check if the activity has enough capacity for the new seats.

        Raises HTTPException 409 if the activity is at or over capacity.
        """
        result = await db_session.execute(
            select(Activity).where(Activity.id == activity_id, Activity.is_active)
        )
        activity = result.scalar_one_or_none()
        if not activity:
            return  # activity not found — let create handle it downstream

        occupied_result = await db_session.execute(
            select(func.coalesce(func.sum(Record.seats), 0)).where(
                Record.activity_id == activity_id,
                Record.is_active.is_(True),  # type: ignore[union-attr]
            )
        )
        occupied = occupied_result.scalar() or 0

        if occupied + seats > activity.capacity:
            raise HTTPException(
                status_code=409,
                detail=f"Activity at capacity: {occupied}/{activity.capacity} seats occupied",
            )


@lru_cache
def get_record_service() -> RecordService:
    """Returns a singleton RecordService."""
    return RecordService(get_generic_repository(), Record)
