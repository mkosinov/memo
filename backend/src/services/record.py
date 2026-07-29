"""Business logic for record CRUD operations with nested visits."""

from datetime import UTC, datetime
from functools import lru_cache

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.repositories.generic import SoftDeleteRepository, get_soft_delete_repository
from src.domain.record_visits import (
    recompute_record_seats,
    recompute_record_status,
    check_activity_capacity,
)
from src.models.client import Client
from src.models.payment import Payment
from src.models.record import Record
from src.models.visit import Visit
from src.models.visitor import Visitor
from src.schemas.common import PaginatedResponse
from src.schemas.record import RecordCreate, RecordPatch, RecordResponse, RecordUpdate
from src.services.generic import GenericService
from src.services.decorators import transactional


class RecordService(GenericService[RecordCreate, RecordUpdate, RecordResponse]):
    """Record service with nested visit management."""

    def __init__(
        self, repository: SoftDeleteRepository, model: type[Record]
    ) -> None:
        super().__init__(repository, model, response_schema=RecordResponse)

    async def list(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 20,
        client_id: str | None = None,
        **filters,
    ) -> PaginatedResponse:  # items are ORM Record instances
        """Return a paginated page of active records (ORM items, visits eagerly loaded)."""
        stmt = (
            select(Record)
            .where(Record.is_active)
            .options(selectinload(Record.visits))
        )
        if client_id:
            stmt = stmt.where(Record.client_id == client_id)
        for key, value in filters.items():
            if value is not None:
                stmt = stmt.where(getattr(Record, key) == value)
        total = (
            await db_session.execute(select(func.count()).select_from(stmt.subquery()))
        ).scalar_one()
        result = await db_session.execute(
            stmt.limit(per_page).offset((page - 1) * per_page)
        )
        orm_items = list(result.scalars().all())
        return PaginatedResponse.model_construct(items=orm_items, total=total, page=page, per_page=per_page)

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

    @transactional
    async def delete(self, db_session: AsyncSession, id: str) -> bool:
        """Soft-delete a record and hard-delete its visits and payments."""
        record = await self._repository.get(db_session, Record, id)
        if not record or not record.is_active:
            return False

        # Cascade: hard-delete all related visits
        await db_session.execute(
            delete(Visit).where(Visit.record_id == id)
        )

        # Cascade: hard-delete all related payments
        await db_session.execute(
            delete(Payment).where(Payment.record_id == id)
        )

        # Soft-delete the record itself
        record.is_active = False
        await db_session.flush()
        return True

    @transactional
    async def create(
        self, db_session: AsyncSession, data: RecordCreate
    ) -> Record:
        """Create record with nested visits, auto-compute seats.

        Supports both phone-based and client-ID-based flows.
        Raises HTTPException 409 if activity is at capacity.
        """
        # ── Capacity check ─────────────────────────────────────────────
        effective_seats = len(data.visits) + (data.anonym_visits or 0)
        await check_activity_capacity(db_session, data.activity_id, seats=effective_seats)

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

        # ── Create Record (status derived after visits flush) ──────────
        record = Record(
            activity_id=data.activity_id,
            client_id=client.id if client else data.client_id,
            status="pending",
            seats=effective_seats,
            anonym_visits=data.anonym_visits or 0,
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
                custom_price=item.custom_price,
                status=item.status.value,
            )
            db_session.add(visit)

        await db_session.flush()

        # ── Recompute seats and status from actual visits ────────────────
        # Route final persisted seats through recompute_record_seats so
        # create/update/patch all share the same single source of truth
        # (US-8). The inline `seats=effective_seats` above is only an
        # initial value before the visits are flushed; after the flush
        # we always recompute from the DB.
        await recompute_record_seats(db_session, record.id)
        await recompute_record_status(db_session, record.id)
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

    @transactional
    async def update(
        self, db_session: AsyncSession, id: str, data: RecordUpdate
    ) -> Record | None:
        """Full-update record: replace visits, recalculate seats.

        Re-checks activity capacity (Variant 1 from #129): after the record's own
        visits are deleted and `anonym_visits` is updated, the record's stored
        ``seats`` is recomputed BEFORE the capacity check so the occupied sum
        reflects only *other* records + this record's (new) anonym count. If
        over capacity, raises 409 and the transaction rolls back, restoring the
        record to its pre-update state.
        """
        record = await self.get(db_session, id)
        if not record:
            return None

        record.activity_id = data.activity_id
        record.client_id = data.client_id
        record.comment = data.comment
        record.custom_price = data.custom_price
        record.anonym_visits = data.anonym_visits or 0
        record.updated_at = datetime.now(UTC)

        # Remove the record's own existing visits first (so they don't self-count)
        for existing_visit in list(record.visits):
            await db_session.delete(existing_visit)
        await db_session.flush()

        # CRITICAL: check_activity_capacity sums the stored Record.seats COLUMN,
        # not live visit counts. Deleting visits does NOT change Record.seats —
        # it keeps its old value until recompute_record_seats runs. So we MUST
        # recompute seats here (→ 0 visits + current anonym_visits) BEFORE the
        # capacity check, otherwise the occupied sum still includes this
        # record's stale old seats → double-count → a shrink (US-6) would
        # falsely 409. This resets the record's own contribution.
        await recompute_record_seats(db_session, record.id)

        # Capacity re-check with the record's own seats already reset in the sum
        effective_seats = len(data.visits) + record.anonym_visits
        await check_activity_capacity(
            db_session, data.activity_id, seats=effective_seats
        )

        # Only now insert the new visits
        for visit_item in data.visits:
            visit = Visit(
                record_id=record.id,
                visitor_id=visit_item.visitor_id,
                tariff_id=visit_item.tariff_id,
                price=visit_item.price,
                custom_price=visit_item.custom_price,
                status=visit_item.status.value,
            )
            db_session.add(visit)

        await db_session.flush()

        # Recompute seats and status from actual visits
        await recompute_record_seats(db_session, record.id)
        await recompute_record_status(db_session, record.id)

        await db_session.refresh(record)
        return record

    @transactional
    async def patch(
        self, db_session: AsyncSession, id: str, data: RecordPatch
    ) -> Record | None:
        """Partial-update record — only fields explicitly sent are changed.

        Handles visits specially: if ``visits`` is provided in the patch,
        deactivates existing visits and creates new ones; otherwise visits
        are left untouched. Seats and status are always recomputed via
        domain free functions after the flush.

        Capacity re-check (#129 Variant 1): only fires when the patch touches
        ``visits`` or ``anonym_visits`` (the ``seats_changed`` guard). A patch
        of only ``comment``/``custom_price`` does not change seats and skips
        the capacity query.
        """
        record = await self.get(db_session, id)
        if not record:
            return None

        update_data = data.model_dump(exclude_unset=True)

        if "comment" in update_data:
            record.comment = update_data["comment"]
        if "custom_price" in update_data:
            record.custom_price = update_data["custom_price"]
        if "anonym_visits" in update_data:
            record.anonym_visits = update_data["anonym_visits"] or 0

        # ── Capacity re-check (only when seats may change) ─────────────
        seats_changed = "visits" in update_data or "anonym_visits" in update_data
        if "visits" in update_data:
            for existing_visit in list(record.visits):
                await db_session.delete(existing_visit)
            await db_session.flush()

        if seats_changed:
            # CRITICAL (same as update): reset Record.seats to reflect the
            # current DB state BEFORE the capacity check, so the occupied
            # sum doesn't double-count this record's stale old seats.
            # recompute_record_seats counts visits still in the DB (0 if we
            # just deleted them for a visits-patch; unchanged for an
            # anonym-only patch) + record.anonym_visits.
            await recompute_record_seats(db_session, record.id)
            new_anonym = record.anonym_visits  # already updated above if present
            if "visits" in update_data:
                new_visit_count = len(update_data["visits"])
            else:
                # anonym-only change: count current visits still in DB
                new_visit_count = len(list(record.visits))
            effective_seats = new_visit_count + new_anonym
            await check_activity_capacity(
                db_session, record.activity_id, seats=effective_seats
            )

        # ── Insert new visits (if provided) ───────────────────────────
        if "visits" in update_data:
            for visit_item in update_data["visits"]:
                visit = Visit(
                    record_id=record.id,
                    visitor_id=visit_item.get("visitor_id"),
                    tariff_id=visit_item.get("tariff_id"),
                    price=visit_item["price"],
                    custom_price=visit_item.get("custom_price"),
                    status=visit_item.get("status", "waiting"),
                )
                db_session.add(visit)

        record.updated_at = datetime.now(UTC)
        await db_session.flush()

        # Recompute seats and status from actual active visits in DB
        await recompute_record_seats(db_session, record.id)
        await recompute_record_status(db_session, record.id)

        await db_session.refresh(record)
        return record


@lru_cache
def get_record_service() -> RecordService:
    """Returns a singleton RecordService."""
    return RecordService(get_soft_delete_repository(), Record)
