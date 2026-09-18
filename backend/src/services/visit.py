"""Business logic for visit CRUD operations.

Cascade logic lives in the domain layer (record_visits.py) as free
functions. VisitService orchestrates but never calls another service.
"""

from datetime import UTC, datetime
from functools import lru_cache

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.domain.record_visits import (
    check_activity_capacity,
    recompute_record_seats,
    recompute_record_status,
)
from src.events.emitter import mark_changed
from src.models.activity import Activity
from src.models.record import Record
from src.models.visit import Visit
from src.repositories.generic import BaseRepository, get_base_repository
from src.schemas.common import PaginatedResponse
from src.schemas.visit import VisitCreate, VisitPatch, VisitResponse, VisitUpdate
from src.services.decorators import transactional


class VisitService:
    """Visit service — manual CRUD with record cascade domain hooks."""

    # GH #239: standalone transactional service (no GenericService ``_model``)
    # — canonical entity name declared explicitly (spec §3.3/§3.4).
    entity_name: str = "visits"

    def __init__(self, repository: BaseRepository) -> None:
        self._repository = repository

    async def list(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 20,
        record_id: str | None = None,
        master_key: str | None = None,
    ) -> PaginatedResponse[VisitResponse]:
        """Return a paginated page of visits, optionally filtered by record_id.

        GH #263 T2: ``master_key`` (the requester's scope) joins
        visit → record → activity and filters ``activities.master_id`` —
        a visit is visible only through its record's activity
        («всё через записи»); conjunctive with the ``record_id`` filter.
        ``None`` (admin) → no join filter.

        Items are validated via VisitResponse.model_validate.
        """
        stmt = select(Visit)
        if master_key is not None:
            stmt = (
                stmt.join(Record, Visit.record_id == Record.id)
                .join(Activity, Record.activity_id == Activity.id)
                .where(Activity.master_id == master_key)
            )
        if record_id is not None:
            stmt = stmt.where(Visit.record_id == record_id)
        # ONE count shape repo-wide (cf. VisitorService.list): the count
        # rides a subquery of the filtered stmt — no second hand-mirrored
        # join chain to keep in sync.
        total = (
            await db_session.execute(
                select(func.count()).select_from(stmt.subquery())
            )
        ).scalar_one()
        rows = await db_session.execute(
            stmt.limit(per_page).offset((page - 1) * per_page)
        )
        items_orm = list(rows.scalars().all())
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

    async def get_scoped(
        self, db_session: AsyncSession, visit_id: str, master_key: str | None
    ) -> Visit | None:
        """Point get with the per-master scope in ONE query (GH #263 T2).

        Scope chain: visit → record → activity (``всё через записи``) —
        чужой visit is indistinguishable from missing (``None`` → route
        renders 404; 404-fast-path, plan T7). ``master_key=None`` (admin)
        → unfiltered.
        """
        stmt = (
            select(Visit)
            .join(Record, Visit.record_id == Record.id)
            .join(Activity, Record.activity_id == Activity.id)
            .where(Visit.id == visit_id)
        )
        if master_key is not None:
            stmt = stmt.where(Activity.master_id == master_key)
        return (await db_session.execute(stmt)).scalar_one_or_none()

    async def get_record_scoped(
        self, db_session: AsyncSession, record_id: str, master_key: str | None
    ) -> Record | None:
        """Parent-record owner gate for visit create (GH #263 T2).

        ONE query: record → activity, ``activities.master_id == master_key``
        when scoped; ``None`` (admin) → unfiltered existence check.
        """
        stmt = (
            select(Record)
            .join(Activity, Record.activity_id == Activity.id)
            .where(Record.id == record_id)
        )
        if master_key is not None:
            stmt = stmt.where(Activity.master_id == master_key)
        return (await db_session.execute(stmt)).scalar_one_or_none()

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
        # GH #239 §3.3: the parent record is rewritten by the recompute hooks
        mark_changed("records")
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
        # GH #239 §3.3: the parent record is rewritten by the recompute hook
        mark_changed("records")
        return visit

    @transactional
    async def patch(
        self, db_session: AsyncSession, visit_id: str, data: VisitPatch,
    ) -> Visit | None:
        """Partial update — only fields explicitly set in `data` are applied.

        Null-policy (GH #179): an explicit ``null`` on the NOT NULL columns
        ``price``/``status`` is IGNORED ('don't change'); on nullable fields
        (``visitor_id``/``tariff_id``/``custom_price``) it is APPLIED
        (clears the field). Empty body is a full no-op: no ``updated_at``
        bump, no status cascade, no ``mark_changed``.

        Cascade only status (seats unchanged — is_active not in VisitPatch).
        """
        visit = await self.get(db_session, visit_id)
        if not visit:
            return None
        update_data = data.model_dump(exclude_unset=True)

        # Strip null values for NOT NULL columns — client intent is "don't
        # change", not "set to null" (same approach as UserSettingsService)
        _not_null_fields = {"price", "status"}
        for field in _not_null_fields:
            if field in update_data and update_data[field] is None:
                del update_data[field]

        # Empty body → full no-op (early exit)
        if not update_data:
            return visit

        for field, value in update_data.items():
            setattr(visit, field, value)
        visit.updated_at = datetime.now(UTC)
        await db_session.flush()
        # Cascade: status only
        await recompute_record_status(db_session, visit.record_id)
        await db_session.flush()
        await db_session.refresh(visit)
        # GH #239 §3.3: the parent record is rewritten by the recompute hook
        mark_changed("records")
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
        # GH #239 §3.3: the parent record is rewritten by the recompute hooks
        mark_changed("records")
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
        # GH #239 §3.3: the parent record is rewritten by the recompute hook
        mark_changed("records")
        return visit


@lru_cache
def get_visit_service() -> VisitService:
    """Returns a singleton VisitService."""
    return VisitService(get_base_repository())
