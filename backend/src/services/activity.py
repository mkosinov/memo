"""Business logic for activity CRUD operations with date filtering and occupied computation."""

from __future__ import annotations

from datetime import date
from functools import lru_cache

from fastapi import HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.domain.dates import day_range
from src.domain.record_visits import active_record_filter
from src.domain.visit_status import ACTIVE_RECORD_STATUSES
from src.errors import ErrorCode, ErrorDetail
from src.events.emitter import mark_changed
from src.models.activity import Activity
from src.models.master import Master
from src.models.payment import Payment
from src.models.photo import Photo
from src.models.record import Record
from src.models.service import Service
from src.models.tag import activity_tags, record_tags
from src.models.visit import Visit
from src.repositories.generic import BaseRepository, get_base_repository
from src.repositories.search import SearchField, search_predicate
from src.schemas.activity import ActivityCreate, ActivityResponse, ActivityUpdate
from src.schemas.common import PaginatedResponse
from src.services.decorators import transactional
from src.services.generic import GenericService


async def check_master_active(
    db_session: AsyncSession, master_id: str
) -> None:
    """GH #266 «Валидация и правила»: a new/moved activity may target only
    a master with ``masters.is_active = true``.

    The picker list may be stale (TOCTOU) — this server-side check is the
    authority. Raises ``HTTPException`` 422 ``MASTER_NOT_ACTIVE`` when the
    extension row is missing OR archived (same contract: the id is not a
    schedulable master).
    """
    ext = await db_session.get(Master, master_id)
    if ext is None or not ext.is_active:
        raise HTTPException(
            status_code=422,
            detail=ErrorDetail(
                code=ErrorCode.MASTER_NOT_ACTIVE,
                message="Мастер недоступен для расписания",
            ).model_dump(),
        )


class ActivityService(GenericService[ActivityCreate, ActivityUpdate, ActivityResponse]):
    """Activity service with date filtering and occupied count."""

    # Fields that map to NOT NULL columns in the activities table.
    # Patch should silently ignore null values for these fields.
    NOT_NULL_FIELDS = {"master_id", "service_id", "location_id", "start", "duration", "capacity"}

    # GH #212 search matrix (spec §5.2 activities row): substring over the
    # joined Service.title; exact activity.id when q parses as a full UUID.
    # The Service join is added ONLY when q is present, so the default query
    # plan is unchanged (spec §5.3 point 7).
    search_fields = [SearchField(Service.title), SearchField(Activity.id, kind="uuid")]

    def __init__(
        self, repository: BaseRepository, model: type[Activity]
    ) -> None:
        super().__init__(repository, model, response_schema=ActivityResponse)

    async def list(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 20,
        date_from: date | None = None,
        date_to: date | None = None,
        q: str | None = None,
        service_id: str | None = None,
        **filters,
    ) -> PaginatedResponse[ActivityResponse]:
        """List activities, paginated, with date/service filters and search.

        Single stmt builder — the former generic and ``_list_by_date`` paths
        funnel through here (GH #212 spec §5.3): equality filters → day range
        → ``service_id`` → ``q`` predicate (Service join only when q present,
        before the repo's COUNT so ``total`` reflects the filtered count).
        """
        stmt = select(Activity)
        for key, value in filters.items():  # equality filters, same as the old super().list path
            if value is not None:
                stmt = stmt.where(getattr(Activity, key) == value)
        from_dt, to_dt = day_range(date_from, date_to)
        if from_dt is not None:
            stmt = stmt.where(Activity.start >= from_dt)
        if to_dt is not None:
            stmt = stmt.where(Activity.start <= to_dt)
        if service_id is not None:
            stmt = stmt.where(Activity.service_id == service_id)
        if q is not None:
            stmt = stmt.join(Service, Activity.service_id == Service.id).where(
                search_predicate(q, self.search_fields)
            )
        items_orm, total = await self._repository.list_entity(
            db_session, stmt, limit=per_page, offset=(page - 1) * per_page
        )
        items = [ActivityResponse.model_validate(a) for a in items_orm]
        await self._populate_service_titles(db_session, items, items_orm)
        return PaginatedResponse(items=items, total=total, page=page, per_page=per_page)

    async def _populate_service_titles(
        self,
        db_session: AsyncSession,
        items: list[ActivityResponse],
        items_orm: list[Activity],
    ) -> None:
        """Set ``service_title`` on every list item via ONE bounded bulk query.

        Runs on every list call (with or without q) — spec §5.3 point 7 keeps
        ``test_list_activities_query_count`` bounded: constant +1 SELECT,
        never 1-per-row.
        """
        if not items:
            return
        rows = await db_session.execute(
            select(Activity.id, Service.title)
            .join(Service, Activity.service_id == Service.id)
            .where(Activity.id.in_([a.id for a in items_orm]))
        )
        titles = {row[0]: row[1] for row in rows.all()}
        for item in items:
            item.service_title = titles.get(item.id)

    @transactional
    async def create(
        self, db_session: AsyncSession, data: ActivityCreate
    ) -> ActivityResponse:
        """Create a new activity.

        GH #266 TOCTOU guard: the target master must be schedulable
        (``masters.is_active = true``) — ``MASTER_NOT_ACTIVE`` otherwise.
        """
        await check_master_active(db_session, data.master_id)
        return await super().create(db_session, data)

    @transactional
    async def update(
        self, db_session: AsyncSession, id: str, data: ActivityUpdate
    ) -> ActivityResponse | None:
        """Full-update an activity — перенесённое занятие тоже проходит
        мастер-проверку (MASTER_NOT_ACTIVE на перенос)."""
        await check_master_active(db_session, data.master_id)
        return await super().update(db_session, id, data)

    async def patch(
        self, db_session: AsyncSession, id: str, data
    ) -> ActivityResponse | None:
        """Partial-update — master_id revalidated when sent (перенос)."""
        new_master = getattr(data, "master_id", None)
        if new_master is not None:
            await check_master_active(db_session, new_master)
        return await super().patch(db_session, id, data)

    async def sum_active_seats(
        self, db_session: AsyncSession, activity_id: str
    ) -> int:
        """Return SUM(seats) for active records (excludes cancelled/missed).

        Active definition is shared with check_activity_capacity via
        domain.record_visits.active_record_filter so the view and the
        capacity check can never drift apart.
        """
        result = await db_session.execute(
            select(func.coalesce(func.sum(Record.seats), 0)).where(
                *active_record_filter(activity_id)
            )
        )
        return int(result.scalar() or 0)

    async def sum_active_seats_bulk(
        self, db_session: AsyncSession, activity_ids: list[str]
    ) -> dict[str, int]:
        """Return {activity_id: occupied_seats} for the given activities in ONE query.

        Active definition reuses ACTIVE_RECORD_STATUSES (same as active_record_filter)
        so the batch view can never drift from the per-activity capacity check.
        """
        if not activity_ids:
            return {}
        result = await db_session.execute(
            select(Record.activity_id, func.coalesce(func.sum(Record.seats), 0))
            .where(
                Record.activity_id.in_(activity_ids),
                Record.status.in_(ACTIVE_RECORD_STATUSES),
            )
            .group_by(Record.activity_id)
        )
        return {row[0]: int(row[1]) for row in result.all()}

    async def count_records(
        self, db_session: AsyncSession, activity_id: str
    ) -> int:
        """DEPRECATED: counts ALL records (including cancelled). Use sum_active_seats."""
        result = await db_session.execute(
            select(func.count(Record.id)).where(
                Record.activity_id == activity_id
            )
        )
        return int(result.scalar() or 0)

    @transactional
    async def delete(self, db_session: AsyncSession, id: str) -> bool:
        """Hard-delete an activity, its records (with their visits/payments),
        their record_tags join rows, the activity_tags join rows, and unlink
        photos (SET NULL).

        All cascade deletes run as explicit SQL inside this single
        ``@transactional`` transaction (no per-record commit) so the whole
        graph is removed atomically. Order matters: visits and payments
        reference records, so they are removed BEFORE the records; the
        records are removed BEFORE the activity. The *_tags join tables
        have FKs with NO ondelete action, so their rows must be removed
        explicitly BEFORE the parent (records/activity) — otherwise the
        DB raises IntegrityError (FK on) or leaves orphan rows (FK off).
        Photos are unlinked (activity_id := NULL) rather than deleted —
        a photo survives the activity that produced it (#194, G1b).
        """
        activity = await self._repository.get(db_session, Activity, id)
        if not activity:
            return False

        record_ids = (
            await db_session.execute(
                select(Record.id).where(Record.activity_id == id)
            )
        ).scalars().all()
        if record_ids:
            await db_session.execute(delete(Visit).where(Visit.record_id.in_(record_ids)))
            await db_session.execute(delete(Payment).where(Payment.record_id.in_(record_ids)))
            await db_session.execute(delete(record_tags).where(record_tags.c.record_id.in_(record_ids)))
            await db_session.execute(delete(Record).where(Record.id.in_(record_ids)))
            # GH #239 §3.3: these cascades actually ran (guarded by record_ids)
            mark_changed("records")
            mark_changed("visits")
            mark_changed("payments")
            mark_changed("tags")  # record_tags join rows
        await db_session.execute(
            update(Photo).where(Photo.activity_id == id).values(activity_id=None)
        )
        await db_session.execute(delete(activity_tags).where(activity_tags.c.activity_id == id))
        await db_session.execute(delete(Activity).where(Activity.id == id))
        # GH #239 §3.3: photos are unlinked (SET NULL) even without records;
        # activity_tags always die with the activity.
        mark_changed("photos")
        mark_changed("tags")
        return True


@lru_cache
def get_activity_service() -> ActivityService:
    """Returns a singleton ActivityService."""
    return ActivityService(get_base_repository(), Activity)
