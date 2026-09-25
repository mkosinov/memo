"""Business logic for activity CRUD operations with date filtering and occupied computation."""

from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache
from typing import TYPE_CHECKING

from fastapi import HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: TC002 — runtime SQLAlchemy dep

from src.domain.dates import day_range
from src.domain.record_visits import active_record_filter
from src.domain.visit_status import ACTIVE_RECORD_STATUSES
from src.errors import ERROR_MESSAGES, ErrorCode, ErrorDetail
from src.events.emitter import mark_changed
from src.models.activity import Activity
from src.models.location import Location
from src.models.master import Master
from src.models.payment import Payment
from src.models.photo import Photo
from src.models.record import Record
from src.models.service import Service
from src.models.staff import Staff
from src.models.tag import activity_tags, record_tags
from src.models.visit import Visit
from src.repositories.generic import BaseRepository, get_base_repository
from src.repositories.search import SearchField, search_predicate
from src.schemas.activity import (
    ActivityCreate,
    ActivityResponse,
    ActivityUpdate,
    CopyWeekResult,
)
from src.schemas.common import PaginatedResponse
from src.services.decorators import transactional
from src.services.generic import GenericService

if TYPE_CHECKING:
    from collections.abc import Sequence

# Copy-week volume cap (GH #242 spec §4, user decision D3): at most 100 rows
# may be INSERTED per call; more → 422 COPY_WEEK_SOURCE_TOO_LARGE ("copy in
# several passes by location"). The cap is checked AFTER filters+dedup, so a
# successful copy is always exact and complete — no silent truncation.
COPY_WEEK_MAX_INSERTS = 100


def _split_specialty(specialty: str | None) -> set[str]:
    """CSV specialty («живопись, керамика») → lowercase set of names.

    Comparison helper for the archived-master remap (spec §5.3): «analogous
    specialty» = non-empty intersection of the two CSV lists (split by ",",
    strip, case-insensitive).
    """
    if not specialty:
        return set()
    return {part.strip().lower() for part in specialty.split(",") if part.strip()}


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

    async def get_scoped(
        self, db_session: AsyncSession, id: str, master_key: str | None
    ) -> Activity | None:
        """GH #263 T2 — point get with the per-master scope in ONE query.

        ``master_key=None`` (admin / anonymous) → unfiltered. A scoped
        master gets ``Activity.master_id == master_key`` folded into the
        same SELECT — чужое and не-существующее are indistinguishable
        (both ``None`` → the route renders 404; 404-fast-path, plan T7:
        no separate owner round-trip).
        """
        stmt = select(Activity).where(Activity.id == id)
        if master_key is not None:
            stmt = stmt.where(Activity.master_id == master_key)
        return (await db_session.execute(stmt)).scalar_one_or_none()

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
        # GH #344 (§4.5): the deferred-delete COMMIT journals the final
        # DELETE — the activity snapshot staged BEFORE the row disappears;
        # the cascaded records/visits/payments/join writes never journal.
        # LAZY audit import — cycle discipline (entities.py WARNING).
        from src.events.audit import derive_row_label, mark_audit, snapshot_pairs_before

        mark_audit(
            entity="activities",
            action="delete",
            entity_id=id,
            entity_label=derive_row_label("activities", activity),
            changes=snapshot_pairs_before("activities", activity),
        )
        return True

    @transactional
    async def copy_week(
        self, db_session: AsyncSession, *,
        week_start: date, locations: Sequence[str],
    ) -> CopyWeekResult:
        """Copy the previous week's activities into the target week (GH #242).

        The WHOLE pipeline runs in this single method under ONE ``@transactional``
        (spec §5.5): read source/target → filter → remap → dedup → cap → insert.
        Any failure mid-way propagates out of the decorator, which skips the
        commit → full rollback → ZERO copies (atomicity invariant).

        Steps (spec §4/§5):
          1. ``week_start`` must be a Monday → 422 COPY_WEEK_START_NOT_MONDAY;
             every requested location id must exist → 422 COPY_WEEK_INVALID_LOCATION.
          2. Windows: source ``[week_start-7 .. week_start-1]``, target
             ``[week_start .. week_start+6]`` — whole days via ``day_range()``.
          3. Source rows in ONE internal query (left-join masters so an
              orphaned master extension is «archived», plus locations for the
              archive flag); target keys = ``(master, service, start, duration)``.
              Board ordering for remap comes from the separate staff board
              query, so staff is NOT joined here.
          4. Filters (spec §5.1): ``is_private`` → skipped_filtered; archived
             location → skipped_filtered; location not in the request list →
             silently out (the user unchecked it — no counter, spec §4).
             Activities of ARCHIVED services ARE copied (deliberate, §5.1).
          5. Remap (spec §5.3): archived master (extension row archived OR
             missing) → first ACTIVE master with a non-empty CSV-specialty
             intersection in canonical board order (sort_order, first_name, id);
             no replacement → skipped_no_master. ``check_master_active`` is NOT
             called on copies — master ids come from the server-side remap,
             never from user input (separate validation path, not a guard bypass).
          6. Dedup key ``(master_id, service_id, start + 7d, duration)`` (spec
             §5.2 — location/capacity deliberately outside) against target rows
             AND rows inserted in this same run (in-run set) → skipped_duplicates.
          7. Cap: more than 100 rows to insert (checked AFTER dedup) → 422
             COPY_WEEK_SOURCE_TOO_LARGE — no silent truncation (D3).
          8. Insertion (spec §5.4/§5.5): direct ``Activity(...)`` instances +
             ``flush`` — NOT ``ActivityService.create`` (each call is itself
             ``@transactional`` and would commit per row, killing atomicity).
             Copies carry every source field except id/timestamps; ``is_private``
             is always ``false`` (private rows were filtered on input).
          9. Tag links are copied via EXPLICIT ``activity_tags`` join rows
             (the generic create never writes tags) + a ``tags`` mark_changed.
             The ``activities`` family label itself comes from the decorator's
             auto-mark — no per-row mark_changed calls.
        """
        # ── 1. Validation guards ─────────────────────────────────────────
        if week_start.weekday() != 0:
            raise HTTPException(
                status_code=422,
                detail=ErrorDetail(
                    code=ErrorCode.COPY_WEEK_START_NOT_MONDAY,
                    message=ERROR_MESSAGES[ErrorCode.COPY_WEEK_START_NOT_MONDAY],
                ).model_dump(),
            )
        requested: set[str] = set(locations)
        found = {
            row[0] for row in (
                await db_session.execute(
                    select(Location.id).where(Location.id.in_(requested))
                )
            ).all()
        }
        if requested - found:
            raise HTTPException(
                status_code=422,
                detail=ErrorDetail(
                    code=ErrorCode.COPY_WEEK_INVALID_LOCATION,
                    message=ERROR_MESSAGES[ErrorCode.COPY_WEEK_INVALID_LOCATION],
                ).model_dump(),
            )

        # ── 2. Windows: source [-7 .. -1], target [0 .. +6] ───────────────
        src_from, src_to = day_range(
            week_start - timedelta(days=7), week_start - timedelta(days=1)
        )
        tgt_from, tgt_to = day_range(
            week_start, week_start + timedelta(days=6)
        )

        # ── 3. One internal source query + target dedup-key set ───────────
        # Left join masters: a missing extension row = «archived» master
        # (spec §5.3) and must reach the remap step, not vanish in the join.
        source_rows = (
            await db_session.execute(
                select(Activity, Master, Location)
                .join(Master, Activity.master_id == Master.staff_id, isouter=True)
                .join(Location, Activity.location_id == Location.id)
                .where(Activity.start >= src_from, Activity.start <= src_to)
            )
        ).all()
        target_keys = {
            row for row in (
                await db_session.execute(
                    select(
                        Activity.master_id, Activity.service_id,
                        Activity.start, Activity.duration,
                    )
                    .where(Activity.start >= tgt_from, Activity.start <= tgt_to)
                )
            ).all()
        }

        # Remap candidates: all active masters in canonical board order
        # (Staff.sort_order ASC, Staff.first_name ASC, Staff.id ASC — spec §5.3
        # D4; loaded once — the roster is small and this keeps the remap O(n)).
        board = (
            await db_session.execute(
                select(Master, Staff)
                .join(Staff, Master.staff_id == Staff.id)
                .where(Master.is_active.is_(True))
                .order_by(Staff.sort_order, Staff.first_name, Staff.id)
            )
        ).all()

        skipped_filtered = 0
        skipped_no_master = 0
        skipped_duplicates = 0
        candidates: list[tuple[Activity, str]] = []  # (source row, final master_id)
        run_keys: set[tuple[str, str, object, int]] = set()

        for activity, master, location in source_rows:
            # ── 4. Filters — spec §5.1 order: private → archived → list ──
            if activity.is_private:
                skipped_filtered += 1
                continue
            if not location.is_active:
                skipped_filtered += 1
                continue
            if location.id not in requested:
                continue  # unchecked in the popup — silently out (no counter)

            # ── 5. Remap of an archived master ────────────────────────────
            final_master_id = activity.master_id
            if master is None or not master.is_active:
                source_specialty = (
                    _split_specialty(master.specialty) if master is not None else set()
                )
                replacement = None
                for board_master, _ in board:
                    if source_specialty & _split_specialty(board_master.specialty):
                        replacement = board_master.staff_id
                        break
                if replacement is None:
                    skipped_no_master += 1
                    continue
                final_master_id = replacement

            # ── 6. Dedup vs target rows AND this run (key after +7d) ──────
            new_start = activity.start + timedelta(days=7)
            key = (final_master_id, activity.service_id, new_start, activity.duration)
            if key in target_keys or key in run_keys:
                skipped_duplicates += 1
                continue
            run_keys.add(key)
            candidates.append((activity, final_master_id))

        # ── 7. Volume cap — after dedup, no silent truncation (D3) ────────
        if len(candidates) > COPY_WEEK_MAX_INSERTS:
            raise HTTPException(
                status_code=422,
                detail=ErrorDetail(
                    code=ErrorCode.COPY_WEEK_SOURCE_TOO_LARGE,
                    message=ERROR_MESSAGES[ErrorCode.COPY_WEEK_SOURCE_TOO_LARGE],
                ).model_dump(),
            )
        if not candidates:
            return CopyWeekResult(
                copied=0,
                skipped_duplicates=skipped_duplicates,
                skipped_filtered=skipped_filtered,
                skipped_no_master=skipped_no_master,
            )

        # ── 8. Direct ORM inserts in ONE transaction (NOT create-per-row) ──
        instances = [
            Activity(
                master_id=final_master_id,
                service_id=activity.service_id,
                location_id=activity.location_id,
                start=activity.start + timedelta(days=7),
                duration=activity.duration,
                capacity=activity.capacity,
                is_private=False,  # private rows were filtered on input (§5.4)
                comment=activity.comment,
                record_info=activity.record_info,
            )
            for activity, final_master_id in candidates
        ]
        for instance in instances:
            db_session.add(instance)
        await db_session.flush()

        # ── 9. Tag links: explicit activity_tags join rows (§5.4) ─────────
        source_ids = [activity.id for activity, _ in candidates]
        tag_rows = (
            await db_session.execute(
                select(activity_tags.c.activity_id, activity_tags.c.tag_id)
                .where(activity_tags.c.activity_id.in_(source_ids))
            )
        ).all()
        if tag_rows:
            copy_id = {
                source_id: instance.id
                for source_id, instance in zip(source_ids, instances, strict=True)
            }
            await db_session.execute(
                activity_tags.insert().values([
                    {"activity_id": copy_id[source_id], "tag_id": tag_id}
                    for source_id, tag_id in tag_rows
                ])
            )
            mark_changed("tags")  # join rows created directly (§5.5)

        # ── 10. Counters; the activities SSE label is the decorator's auto-mark
        return CopyWeekResult(
            copied=len(instances),
            skipped_duplicates=skipped_duplicates,
            skipped_filtered=skipped_filtered,
            skipped_no_master=skipped_no_master,
        )


@lru_cache
def get_activity_service() -> ActivityService:
    """Returns a singleton ActivityService."""
    return ActivityService(get_base_repository(), Activity)


async def sum_active_seats_bulk(
    db_session: AsyncSession, activity_ids: list[str]
) -> dict[str, int]:
    """Return {activity_id: occupied_seats} for the given activities in ONE query.

    Corridor 3 free function (GH #217 Task 4, ADR 007 / canon rule 8 —
    behavior-for-behavior move of the former ``ActivityService`` method,
    removed with no residual shim): a dict-shaped batch enrichment —
    no page, no total — so it takes the session directly instead of
    riding the repository list mechanics. The name keeps the content
    verb (ADR 007 naming convention; ``view`` is reserved for table
    pages). The only caller is the GET /activities handler.

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
