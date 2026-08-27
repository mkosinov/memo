"""Business logic for record CRUD operations with nested visits."""

from datetime import UTC, datetime
from functools import lru_cache

from sqlalchemy import case, delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.repositories.generic import BaseRepository, get_base_repository
from src.repositories.search import SearchField, search_predicate
from src.domain.deletion import (
    BlockingDepsError,
    InvalidResolutionError,
    collect_dependencies,
    has_blocking_deps,
    validate_resolutions,
)
from src.domain.record_visits import (
    recompute_record_seats,
    recompute_record_status,
    check_activity_capacity,
)
from src.domain.dates import day_range
from src.models.activity import Activity
from src.models.client import Client
from src.models.location import Location
from src.models.master import Master
from src.models.payment import Payment
from src.models.record import Record
from src.models.service import Service
from src.models.tag import record_tags
from src.models.visit import Visit
from src.models.visitor import Visitor
from src.schemas.common import PaginatedResponse
from src.schemas.record import RecordCreate, RecordListParams, RecordPatch, RecordResponse, RecordUpdate
from src.services.generic import GenericService
from src.services.decorators import transactional


class RecordService(GenericService[RecordCreate, RecordUpdate, RecordResponse]):
    """Record service with nested visit management."""

    # GH #212 search matrix (spec §5.2 records row): substring over the
    # client's name/phone/email and the service title; exact record.id when
    # q parses as a full UUID. The search joins (Client / Service, both LEFT
    # OUTER — client_id is nullable) are added ONLY when q is present, so the
    # default query plan is unchanged.
    search_fields = [
        SearchField(Client.name),
        SearchField(Client.phone),
        SearchField(Client.email),
        SearchField(Service.title),
        SearchField(Record.id, kind="uuid"),
    ]

    def __init__(
        self, repository: BaseRepository, model: type[Record]
    ) -> None:
        super().__init__(repository, model, response_schema=RecordResponse)

    async def list(
        self, db_session: AsyncSession, params: RecordListParams
    ) -> PaginatedResponse:  # items are ORM Record instances
        """Return a paginated page of records (ORM items, visits eagerly loaded).

        Filter → Sort → Paginate, fully server-side (#191).
        Business filters are hand-written here (G1a principle); pagination/date
        mechanics are shared helpers (BaseRepository.list_custom, day_range).
        """
        stmt = (
            select(Record)
            .join(Activity, Record.activity_id == Activity.id)
            .options(selectinload(Record.visits))
        )
        # --- Filter ---
        from_dt, to_dt = day_range(params.date_from, params.date_to)
        if from_dt is not None:
            stmt = stmt.where(Activity.start >= from_dt)
        if to_dt is not None:
            stmt = stmt.where(Activity.start <= to_dt)
        if params.location_id is not None:
            stmt = stmt.where(Activity.location_id == params.location_id)
        if params.service_id is not None:
            stmt = stmt.where(Activity.service_id == params.service_id)
        if params.master_id is not None:
            stmt = stmt.where(Activity.master_id == params.master_id)
        if params.status is not None:
            stmt = stmt.where(Record.status == params.status)
        if params.client_id is not None:
            stmt = stmt.where(Record.client_id == params.client_id)
        if params.activity_id is not None:
            stmt = stmt.where(Record.activity_id == params.activity_id)
        # --- Search (GH #212) — joins only when q present ---
        # The stmt already joins Activity (inner, for date/filters/sorts); the
        # Service outerjoin reuses it — Activity is never double-joined.
        if params.q:
            stmt = (
                stmt.outerjoin(Client, Record.client_id == Client.id)
                    .outerjoin(Service, Activity.service_id == Service.id)
                    .where(search_predicate(params.q, self.search_fields))
            )
        # --- Sort (whitelist map) + Paginate (COUNT before ORDER BY) ---
        items, total = await self._repository.list_custom(
            db_session,
            stmt,
            order_by=self._sort_columns(params),
            limit=params.per_page,
            offset=(params.page - 1) * params.per_page,
        )
        return PaginatedResponse.model_construct(
            items=items, total=total, page=params.page, per_page=params.per_page
        )

    @staticmethod
    def _sort_columns(params: RecordListParams) -> list:
        """Whitelist sort map → ORDER BY expressions (#191, mirrors the deleted
        client-side comparator; collation note: SQLite BINARY ≠ localeCompare)."""
        client_name = (
            select(Client.name).where(Client.id == Record.client_id).scalar_subquery()
        )
        service_title = (
            select(Service.title).where(Service.id == Activity.service_id).scalar_subquery()
        )
        master_last = (
            select(Master.last_name).where(Master.id == Activity.master_id).scalar_subquery()
        )
        master_first = (
            select(Master.first_name).where(Master.id == Activity.master_id).scalar_subquery()
        )
        location_name = (
            select(Location.name).where(Location.id == Activity.location_id).scalar_subquery()
        )
        total_price = (
            select(func.coalesce(func.sum(Visit.price), 0))
            .where(Visit.record_id == Record.id)
            .scalar_subquery()
        )
        paid_sum = (
            select(func.coalesce(func.sum(Payment.amount), 0))
            .where(Payment.record_id == Record.id)
            .scalar_subquery()
        )
        payment_bucket = case(
            (paid_sum >= total_price, 0),
            (paid_sum > 0, 1),
            else_=2,
        )
        sort_map: dict[str, list] = {
            "date": [Activity.start],
            "client": [client_name],
            "service": [service_title],
            "master": [master_last, master_first],
            "location": [location_name],
            "guests": [Record.seats - Record.anonym_visits],  # == live visits count
            "status": [Record.status],
            "total": [total_price],
            "payment": [payment_bucket],
        }
        columns = sort_map[params.sort_by]  # Literal-validated upstream; KeyError impossible
        if params.sort_order == "desc":
            ordered = [c.desc().nullslast() for c in columns]
        else:
            ordered = [c.asc().nullsfirst() for c in columns]
        return [*ordered, Record.id.asc()]  # deterministic tiebreak — cross-page stability

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
        """Hard-delete a record and its visits, payments, and record_tags join rows.

        All cascade deletes run as explicit SQL inside this single
        ``@transactional`` transaction (no per-record commit) so the
        unit is atomic: if any statement fails, nothing persists. The
        dependent rows (visits, payments) are removed BEFORE the record
        so no FK constraint can fire. The record_tags join table has FKs
        with NO ondelete action, so its rows are removed BEFORE the
        record — otherwise the DB raises IntegrityError (FK on) or
        leaves orphan rows (FK off) (#194).
        """
        record = await self._repository.get(db_session, Record, id)
        if not record:
            return False

        await db_session.execute(delete(Visit).where(Visit.record_id == id))
        await db_session.execute(delete(Payment).where(Payment.record_id == id))
        await db_session.execute(delete(record_tags).where(record_tags.c.record_id == id))
        await db_session.execute(delete(Record).where(Record.id == id))
        return True

    async def resolve_delete(
        self,
        db_session: AsyncSession,
        id: str,
        resolutions: dict[str, str],
    ) -> bool:
        """Execute the unified DELETE-with-body resolution for records (GH #139).

        Mirrors ``ArchiveService.resolve_delete``'s validation flow but
        EXECUTES via ``self.delete`` (the existing ``@transactional``
        cascade visits → payments → record_tags → record) instead of
        dispatching through ``CASCADE_HANDLERS`` — no Record handlers are
        registered in the deletion layer; the cascade intentionally lives
        in ``RecordService.delete`` (Addendum 13 ruling).

        Flow:
          1. Existence check — ``False`` if record missing (route → 404).
          2. Collect FK deps (``collect_dependencies``).
          3. ``has_blocking_deps`` → raise ``BlockingDepsError`` (route → 422).
             Record deps are never blocking (``allowed_actions`` always
             non-empty), but the check stays for defensive consistency.
          4. ``validate_resolutions`` → raise ``InvalidResolutionError`` if
             errors (route → 422 with detail).
          5. Execute via ``self.delete`` (the ``@transactional`` cascade
             commits the session — no separate ``@transactional`` needed
             here).

        Returns ``True`` on success, ``False`` if the record was missing.
        Raises ``ResolutionError`` subtypes for 422 paths (caught in the
        router).
        """
        # 1. Existence check.
        record = await self._repository.get(db_session, Record, id)
        if record is None:
            return False

        # 2. Collect deps.
        deps = await collect_dependencies(db_session, Record, id)

        # 3. Blocked deps → 422 (won't happen for Record — all deps are cascade).
        if has_blocking_deps(deps):
            raise BlockingDepsError(
                "Entity has blocking dependencies — archive instead"
            )

        # 4. Validate resolutions body against the matrix.
        issues = validate_resolutions(Record, deps, resolutions)
        if issues:
            msg = "; ".join(f"{i.relation}: {i.message}" for i in issues)
            raise InvalidResolutionError(msg)

        # 5. Execute via the existing @transactional cascade.
        await self.delete(db_session, id)
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
    return RecordService(get_base_repository(), Record)
