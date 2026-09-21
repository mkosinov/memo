"""Record reads (list, view, point get, scope) and record-row operations.

GH #171 Task 6: the multi-entity write flows (create / update / patch /
delete chains) live in the ``usecases.records`` scenarios (Corridor 2 —
canon docs/domain-rules/service-layer.md rule 2); this service is the
narrow owner of the record table:

- reads: ``list`` / ``list_view`` (Corridor 3-style display composites —
  foreign tables are read in ONE query, rule 8), ``get`` / ``get_scoped``;
- record-row operations: ``create_row`` / ``update_row`` / ``patch_row``
  (no commit — the caller's scenario owns the transaction) and
  ``delete_row_with_tags`` (the owner's own-edge cleanup — ``record_tags``
  bundles + the record row).

No cache marks and no foreign-ORM writes here: visits/payments/clients/
visitors are handled by their owner services behind the scenarios.
"""

from datetime import UTC, datetime
from functools import lru_cache
from typing import cast

from pydantic import TypeAdapter
from sqlalchemy import Select, case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.domain.dates import day_range
from src.models.activity import Activity
from src.models.client import Client
from src.models.location import Location
from src.models.master import Master
from src.models.payment import Payment
from src.models.record import Record
from src.models.service import Service
from src.models.staff import Staff
from src.models.visit import Visit
from src.repositories.record import RecordRepository, get_record_repository
from src.repositories.search import SearchField, ids_in_predicate, search_predicate
from src.schemas.common import PaginatedResponse
from src.schemas.record import (
    RecordCreate,
    RecordListParams,
    RecordResponse,
    RecordUpdate,
    RecordViewResponse,
    VisitResponse,
)
from src.services.generic import GenericService

# Serializes a datetime EXACTLY as a Pydantic ``datetime`` model field does
# (pydantic emits ``Z`` for UTC-aware values where bare ``isoformat()``
# would emit ``+00:00``) — used for ``activity_start`` byte-parity with
# ``ActivityResponse.start`` (GH #213 §4).
_DT_JSON = TypeAdapter(datetime)


def _dt_json(value: datetime | None) -> str | None:
    """Pydantic-faithful datetime → ISO string (None → None)."""
    if value is None:
        return None
    return cast("str", _DT_JSON.dump_python(value, mode="json"))


def map_record(record: Record) -> RecordResponse:
    """Map a Record ORM object to RecordResponse with nested visits.

    Service-owned mapping (photos precedent, GH #213): the records router
    imports this, and ``RecordService.list_view`` reuses it for the base
    fields of each view row (``visits`` already loaded via selectinload).
    """

    def _dt_to_str(dt: datetime | None) -> str:
        if dt is None:
            return ""
        return dt.isoformat()

    visits = [
        VisitResponse(
            id=v.id,
            record_id=v.record_id,
            visitor_id=v.visitor_id,
            tariff_id=v.tariff_id,
            price=v.price,
            custom_price=v.custom_price,
            status=v.status,
            created_at=_dt_to_str(v.created_at),
            updated_at=_dt_to_str(v.updated_at),
        )
        for v in record.visits
    ]

    return RecordResponse(
        id=record.id,
        activity_id=record.activity_id,
        client_id=record.client_id,
        status=record.status,
        seats=record.seats,
        comment=record.comment,
        custom_price=record.custom_price,
        created_at=_dt_to_str(record.created_at),
        updated_at=_dt_to_str(record.updated_at),
        visits=visits,
    )


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
        self,
        repository: RecordRepository,
        model: type[Record],
    ) -> None:
        super().__init__(repository, model, response_schema=RecordResponse)

    def _build_list_stmt(
        self, params: RecordListParams, master_key: str | None = None,
    ) -> Select[tuple[Record]]:
        """Assemble the shared records-list query (GH #213 DRY-glue).

        Activity INNER join + business filters + ``q`` predicates (Client /
        Service LEFT OUTER joins ONLY when ``q`` is present) + eager visits.
        ``list()`` and ``list_view()`` share this builder — the view is the
        same query plus extra labeled display columns (§5).

        GH #263 T2 (D2): ``master_key`` (the requester's scope) ANDs
        conjunctively with the client-supplied ``params.master_id`` — a
        master filtering by someone else's key gets an EMPTY result, never
        the other master's rows; ``None`` (admin) adds nothing.
        """
        stmt = (
            select(Record)
            .join(Activity, Record.activity_id == Activity.id)
            .options(selectinload(Record.visits))
        )
        # --- Server scope (GH #263) — conjunctive with everything below ---
        if master_key is not None:
            stmt = stmt.where(Activity.master_id == master_key)
        # GH #232 §3.1: typed ``?id=`` set narrowing — AFTER the scope
        # predicate (scope inherited), shared helper, one line.
        id_pred = ids_in_predicate(Record.id, params.id)
        if id_pred is not None:
            stmt = stmt.where(id_pred)
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
        return stmt

    async def list(
        self, db_session: AsyncSession, params: RecordListParams,
        master_key: str | None = None,
    ) -> PaginatedResponse:  # items are ORM Record instances
        """Return a paginated page of records (ORM items, visits eagerly loaded).

        Filter → Sort → Paginate, fully server-side (#191).
        Business filters are hand-written in ``_build_list_stmt`` (G1a
        principle); pagination/date mechanics are shared helpers
        (BaseRepository.list_entity, day_range). ``master_key`` — the
        per-master scope (GH #263); see the builder.
        """
        stmt = self._build_list_stmt(params, master_key=master_key)
        # --- Sort (whitelist map) + Paginate (COUNT before ORDER BY) ---
        items, total = await self._repository.list_entity(
            db_session,
            stmt,
            order_by=self._sort_columns(params),
            limit=params.per_page,
            offset=(params.page - 1) * params.per_page,
        )
        return PaginatedResponse.model_construct(
            items=items, total=total, page=params.page, per_page=params.per_page
        )

    async def list_view(
        self, db_session: AsyncSession, params: RecordListParams,
        master_key: str | None = None,
    ) -> PaginatedResponse[RecordViewResponse]:
        """Return a records page enriched with display fields (GH #213 §5).

        Same query as ``list()`` — shared ``_build_list_stmt`` + shared
        ``_sort_columns`` whitelist (US-5/US-6 parity) — plus 8 labeled
        display columns, riding the repo ``list_custom`` row-tuple core.
        Display resolution carries NO ``is_active`` filters: archived
        entities resolve their names (US-3). Rows map via ``map_record``
        on the ORM entity in ``row[0]`` (visits included — selectinload
        populates them regardless of extra select columns) + named-label
        unpacking for the display fields.
        """
        # Explicit correlate() pins each subquery to correlate ONLY against
        # its outer table (Record / Activity): auto-correlation would also
        # strip the dictionary table (clients/services/...) from the FROM
        # whenever the ``q`` outerjoins add it to the enclosing query —
        # leaving the subquery with no FROM → InvalidRequestError (GH #213).
        client_name = (
            select(Client.name)
            .where(Record.client_id == Client.id)
            .correlate(Record)
            .scalar_subquery()
        )
        service_title = (
            select(Service.title)
            .where(Activity.service_id == Service.id)
            .correlate(Activity)
            .scalar_subquery()
        )
        # GH #266 (D9): master display fields survive the restructuring —
        # Activity.master_id now targets masters.staff_id (the extension
        # row), while the person's names moved to the staff card. The
        # scalar-subquery shape is kept: names resolve via the extension →
        # staff join, color straight off the extension. No is_active
        # filters (US-3: archived cards still resolve).
        master_name = (
            select(Staff.last_name + " " + Staff.first_name)
            .join(Master, Master.staff_id == Staff.id)
            .where(Activity.master_id == Master.staff_id)
            .correlate(Activity)
            .scalar_subquery()
        )
        location_name = (
            select(Location.title)
            .where(Activity.location_id == Location.id)
            .correlate(Activity)
            .scalar_subquery()
        )
        master_color = (
            select(Master.color)
            .where(Activity.master_id == Master.staff_id)
            .correlate(Activity)
            .scalar_subquery()
        )
        paid = (
            select(func.coalesce(func.sum(Payment.amount), 0))
            .where(Payment.record_id == Record.id)
            .correlate(Record)
            .scalar_subquery()
        )
        stmt = self._build_list_stmt(params, master_key=master_key).add_columns(
            client_name.label("client_name"),
            Activity.start.label("activity_start"),
            Activity.is_private.label("is_private"),
            service_title.label("service_title"),
            master_name.label("master_name"),
            location_name.label("location_name"),
            master_color.label("master_color"),
            paid.label("paid"),
        )
        rows, total = await self._repository.list_custom(
            db_session,
            stmt,
            order_by=self._sort_columns(params),
            limit=params.per_page,
            offset=(params.page - 1) * params.per_page,
        )
        items: list[RecordViewResponse] = []
        for row in rows:
            view = RecordViewResponse.model_validate(map_record(row[0]))
            view.client_name = row.client_name
            view.activity_start = _dt_json(row.activity_start)
            view.service_title = row.service_title
            view.master_name = row.master_name
            view.location_name = row.location_name
            view.master_color = row.master_color
            view.is_private = bool(row.is_private)
            view.paid = row.paid
            items.append(view)
        return PaginatedResponse.model_construct(
            items=items, total=total, page=params.page, per_page=params.per_page
        )

    @staticmethod
    def _sort_columns(params: RecordListParams) -> list:
        """Whitelist sort map → ORDER BY expressions (#191, mirrors the deleted
        client-side comparator; collation note: SQLite BINARY ≠ localeCompare).

        The Client/Service name subqueries carry explicit ``correlate()``:
        when ``q`` outerjoins those tables into the enclosing query,
        auto-correlation would strip them from the subquery FROM → no FROM
        left → InvalidRequestError (500) on ``q`` + client/service sorts
        (GH #213 regression pin — same treatment as the list_view display
        columns)."""
        client_name = (
            select(Client.name)
            .where(Client.id == Record.client_id)
            .correlate(Record)
            .scalar_subquery()
        )
        service_title = (
            select(Service.title)
            .where(Service.id == Activity.service_id)
            .correlate(Activity)
            .scalar_subquery()
        )
        # GH #266: master name sorts resolve through the extension → card
        # join (names live on Staff; Master keeps only staff_id PK).
        master_last = (
            select(Staff.last_name)
            .join(Master, Master.staff_id == Staff.id)
            .where(Activity.master_id == Master.staff_id)
            .scalar_subquery()
        )
        master_first = (
            select(Staff.first_name)
            .join(Master, Master.staff_id == Staff.id)
            .where(Activity.master_id == Master.staff_id)
            .scalar_subquery()
        )
        location_name = (
            select(Location.title).where(Location.id == Activity.location_id).scalar_subquery()
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
        # Named (non-anonymous) visit count as a correlated subquery — the
        # list is paginated, so guests-sorting must live in SQL. Under the
        # unified model (#257) this is the exact continuation of the old
        # ``seats - anonym_visits`` (== live visits count): ALL named visits
        # count as "guests" regardless of status; anonymous visits
        # (visitor_id IS NULL) don't.
        named_visits_count = (
            select(func.count()).select_from(Visit)
            .where(Visit.record_id == Record.id, Visit.visitor_id.is_not(None))
            .correlate(Record).scalar_subquery()
        )
        sort_map: dict[str, list] = {
            "date": [Activity.start],
            "client": [client_name],
            "service": [service_title],
            "master": [master_last, master_first],
            "location": [location_name],
            "guests": [named_visits_count],
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

    async def get_scoped(
        self, db_session: AsyncSession, id: str, master_key: str | None
    ) -> Record | None:
        """Point get with the per-master scope in ONE query (GH #263 T2).

        Join record → activity and fold ``Activity.master_id == master_key``
        into the same SELECT (visits eagerly loaded) — a scoped master gets
        ``None`` for чужие records, indistinguishable from missing (route
        renders 404; 404-fast-path, plan T7). ``master_key=None`` (admin)
        → unfiltered.
        """
        stmt = (
            select(Record)
            .join(Activity, Record.activity_id == Activity.id)
            .where(Record.id == id)
            .options(selectinload(Record.visits))
        )
        if master_key is not None:
            stmt = stmt.where(Activity.master_id == master_key)
        return (await db_session.execute(stmt)).scalar_one_or_none()

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

    async def delete_row_with_tags(self, db_session: AsyncSession, record_id: str) -> None:
        """Remove a record's OWN tag bundles + the record row — WITHOUT committing.

        GH #171 Task 5 scenario building block (no transaction; canon
        docs/domain-rules/service-layer.md rules 1, 3-4): the caller's
        scenario owns the transaction boundary and the commit. The
        ``record_tags`` join rows are the record's OWN child links without
        a lifecycle of their own (rule 1), so their bulk delete lives in
        the owner repository (``RecordRepository.delete_tags_by_record_id``
        — ONE set-based statement, #171 Task 1) and runs BEFORE the row
        (the join's FKs carry no ondelete action — #194). The row goes by
        a bulk ``DELETE ... WHERE id`` statement (no instance-delete
        switch); the whole cascade is orchestrated by the
        ``usecases.records.delete_record`` scenario (GH #171 Task 5).
        No event marks here — "records" is the scenario's own-entity mark.
        """
        await self._repository.delete_tags_by_record_id(db_session, record_id)
        await db_session.execute(delete(Record).where(Record.id == record_id))

    async def create_row(
        self,
        db_session: AsyncSession,
        *,
        activity_id: str,
        client_id: str | None,
        seats: int,
        comment: str | None = None,
        custom_price: int | None = None,
    ) -> Record:
        """Insert ONE record row — WITHOUT committing, no recalculation.

        GH #171 Task 3: the row-level remainder of the former
        ``RecordService.create`` — the find-or-create / visit-insert /
        recalculation orchestration moved to the ``create_record``
        scenario (usecases, Corridor 2 — canon
        docs/domain-rules/service-layer.md rules 2, 5, 6). This is the
        owner service's own-entity row op (rule 1): add + flush so the
        caller's scenario gets a populated ``id``; the transaction
        boundary, the visit batch, and the recalculation timing belong
        to the scenario. Value-typed parameters — no foreign
        ORM/schema objects.
        """
        record = Record(
            activity_id=activity_id,
            client_id=client_id,
            status="pending",
            seats=seats,
            comment=comment,
            custom_price=custom_price,
        )
        db_session.add(record)
        await db_session.flush()
        return record

    async def update_row(
        self,
        db_session: AsyncSession,
        id: str,
        *,
        activity_id: str,
        client_id: str | None,
        comment: str | None,
        custom_price: int | None,
    ) -> Record | None:
        """Apply the scalar field writes of a full update — WITHOUT
        committing, no visit handling, no recalculation.

        GH #171 Task 4: the row-level remainder of the former
        ``RecordService.update`` — the visit delete/recompute/capacity/
        re-insert orchestration moved to the ``update_record`` scenario
        (usecases, Corridor 2 — canon docs/domain-rules/service-layer.md
        rules 2, 5). This is the owner service's own-entity row op
        (rule 1): load (missing → None), write the PUT scalar fields +
        ``updated_at``, flush. The transaction boundary, the visit
        batch, and the recalculation timing belong to the scenario.
        Value-typed parameters — no foreign ORM/schema objects.
        """
        record = await self.get(db_session, id)
        if not record:
            return None

        record.activity_id = activity_id
        record.client_id = client_id
        record.comment = comment
        record.custom_price = custom_price
        record.updated_at = datetime.now(UTC)
        await db_session.flush()
        return record

    async def patch_row(
        self,
        db_session: AsyncSession,
        id: str,
        fields: dict[str, str | int | None],
    ) -> Record | None:
        """Apply the EXPLICITLY-SENT scalar fields of a partial update —
        WITHOUT committing, no visit handling, no recalculation.

        GH #171 Task 4: the row-level remainder of the former
        ``RecordService.patch`` — the seats_changed visit orchestration
        moved to the ``patch_record`` scenario (usecases, Corridor 2 —
        canon rules 2, 5). ``fields`` is the caller's
        ``model_dump(exclude_unset=True)`` restricted to the scalar keys
        (``comment`` / ``custom_price``) — only those are written, plus
        ``updated_at``. Missing id → None. Value-typed input only.
        """
        record = await self.get(db_session, id)
        if not record:
            return None

        if "comment" in fields:
            record.comment = fields["comment"]
        if "custom_price" in fields:
            record.custom_price = fields["custom_price"]
        record.updated_at = datetime.now(UTC)
        await db_session.flush()
        return record


@lru_cache
def get_record_service() -> RecordService:
    """Returns a singleton RecordService over the OWNER repository (GH #171 T1).

    The specialized ``RecordRepository`` subclasses ``BaseRepository``, so
    the generic CRUD surface is unchanged — and the service's own-edge
    commands (``delete_tags_by_record_id``) execute through the owner repo.
    """
    return RecordService(get_record_repository(), Record)
