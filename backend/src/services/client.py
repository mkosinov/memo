"""Business logic for client CRUD operations."""

from __future__ import annotations

from datetime import datetime
from functools import lru_cache
from typing import TypeVar

from sqlalchemy import ColumnElement, func, not_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.scope import mask_phone
from src.domain.visit_status import VisitStatus
from src.models.activity import Activity
from src.models.client import Client
from src.models.enums import ArchiveStatus
from src.models.payment import Payment
from src.models.record import Record
from src.repositories.generic import ArchiveRepository, get_archive_repository
from src.repositories.search import SearchField, search_predicate
from src.schemas.client import (
    ClientCreate,
    ClientListParams,
    ClientResponse,
    ClientUpdate,
    ClientWithStats,
)
from src.schemas.common import PaginatedResponse
from src.services.generic import ArchiveService
from src.services.visitor import VisitorService, get_visitor_service

ResponseT = TypeVar("ResponseT", bound=ClientResponse)


def _client_scope_predicate(master_key: str) -> ColumnElement[bool]:
    """EXISTS «есть запись клиента к активности этого мастера» (D1).

    Records are hard-delete (``AbstractModel``, no ``is_active``) — every
    existing row is non-archived, so the predicate is a plain EXISTS over
    records → activities. Single implementation for BOTH consumer paths:
    ``ClientService`` (generic list / point get) and the manual
    ``list_clients_with_stats`` builder.
    """
    return (
        select(Record.id)
        .join(Activity, Record.activity_id == Activity.id)
        .where(
            Record.client_id == Client.id,
            Activity.master_id == master_key,
        )
        .exists()
    )


def _mask_client_contacts(item: ResponseT) -> ResponseT:
    """GH #263 D3 — contact mask on a client-bearing response (master).

    ``phone`` → ``mask_phone`` (last 4 digits visible), ``email`` →
    ``None``; name/channel stay as-is. Applied ONLY on read paths —
    mutations keep the full number (the master just typed it, WYSIWYG
    #221). In-place on the Pydantic model; returned for chaining.
    """
    item.phone = mask_phone(item.phone)
    item.email = None
    return item


class ClientService(ArchiveService[ClientCreate, ClientUpdate, ClientResponse]):
    """Client service — standard ``ArchiveService`` PLUS the Client→visitors cascade.

    The unified DELETE executor (``ArchiveService.resolve_delete``) dispatches
    on ``(self._model, dep.entity)`` via :data:`CASCADE_HANDLERS` in
    ``src.domain.deletion``. The Client→visitors handler
    (``_h_cascade_client_visitors``) is the ONLY dep in the §4 matrix that
    needs an external-service reference — it loops the non-decorated
    ``VisitorService._delete_cascade`` per visitor on the SHARED outer
    session (atomic with the Client resolve_delete transaction — spec §8
    BLOCKER-class: NO per-visitor commit).

    To keep the executor free of ``if model is Client`` branches, the handler
    is injected via the service instance: ``self._visitor_service``. The base
    ``ArchiveService`` has no such attr; ``ClientService`` is the ONLY subclass
    that adds one (via the DI factory below). Other services (Master/Location/
    Service/Material) dispatch through the matrix's free-function handlers —
    no service injection needed there.
    """

    def __init__(
        self,
        repository: ArchiveRepository,
        model: type[Client],
        response_schema: type[ClientResponse],
        visitor_service: VisitorService,
    ) -> None:
        super().__init__(repository, model, response_schema)
        self._visitor_service = visitor_service

    # GH #212 search matrix (spec §5.2): substring over name/phone/email,
    # exact id equality when q parses as a full UUID (deep-link #216).
    search_fields = [
        SearchField(Client.name),
        SearchField(Client.phone),
        SearchField(Client.email),
        SearchField(Client.id, kind="uuid"),
    ]

    # ── GH #263 T3 — per-master scope + contact mask (D1/D3/D4) ─────────

    @staticmethod
    def _visibility_predicate(master_key: str | None) -> ColumnElement[bool] | None:
        """Client scope predicate (D1, «всё через записи»).

        A client is visible to a scoped master iff he has at least one
        record on one of the master's activities. ``None`` (admin) → no
        predicate. Shared implementation — see
        :func:`_client_scope_predicate`.
        """
        if master_key is None:
            return None
        return _client_scope_predicate(master_key)

    async def list(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 20,
        order_by=None,
        status: ArchiveStatus = ArchiveStatus.ACTIVE,
        q: str | None = None,
        master_key: str | None = None,
        **filters,
    ) -> PaginatedResponse[ClientResponse]:
        """Paginated clients with the master scope + contact mask (T3).

        Scope rule (D1/D4): the EXISTS visibility predicate applies ONLY
        when the caller did NOT pass a ``phone`` filter — the phone
        typeahead (``service.list(phone=...)`` behind
        ``GET /clients/get?phone=`` and the digits-mode list filter)
        searches ALL active studio clients. Mask (D3) applies whenever
        the request is scoped (``master_key is not None``) — search
        results included: the full number is a search KEY, never response
        data. Both predicates land BEFORE the COUNT, so ``total`` stays
        honest (generic list contract).
        """
        phone = filters.pop("phone", None)
        stmt = self._list_stmt(status=status, **filters)
        if phone is not None:
            stmt = stmt.where(Client.phone == phone)
        if phone is None:
            predicate = self._visibility_predicate(master_key)
            if predicate is not None:
                stmt = stmt.where(predicate)
        if q:
            stmt = stmt.where(search_predicate(q, self.search_fields or []))
        if order_by is not None:
            stmt = stmt.order_by(*order_by)
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = (await db_session.execute(count_stmt)).scalar_one()
        rows = await db_session.execute(
            stmt.limit(per_page).offset((page - 1) * per_page)
        )
        items_orm = list(rows.scalars().all())
        items = [self._response_schema.model_validate(o) for o in items_orm]
        if master_key is not None:
            items = [_mask_client_contacts(i) for i in items]
        return PaginatedResponse(items=items, total=total, page=page, per_page=per_page)

    async def get_scoped(
        self, db_session: AsyncSession, id: str, master_key: str | None
    ) -> ClientResponse | None:
        """Point get with the per-master scope in ONE query (T3).

        The EXISTS visibility predicate folds into the same SELECT —
        чужой client is indistinguishable from missing (``None`` → the
        route renders 404; 404-fast-path, plan T7). Scoped responses are
        masked (D3); ``master_key=None`` (admin) → unfiltered, unmasked.
        """
        stmt = select(Client).where(Client.id == id)
        predicate = self._visibility_predicate(master_key)
        if predicate is not None:
            stmt = stmt.where(predicate)
        client = (await db_session.execute(stmt)).scalar_one_or_none()
        if client is None:
            return None
        item = ClientResponse.model_validate(client)
        if master_key is not None:
            return _mask_client_contacts(item)
        return item


@lru_cache
def get_client_service() -> ClientService:
    """Singleton ClientService — injects the VisitorService singleton.

    Both singletons are ``@lru_cache``d, so tests that monkey-patch
    ``VisitorService._delete_cascade`` (the atomicity test) patch the SAME
    instance the ClientService holds — the executor sees the patched method.
    """
    return ClientService(
        get_archive_repository(),
        Client,
        ClientResponse,
        get_visitor_service(),
    )


async def list_clients_with_stats(
    db_session: AsyncSession,
    params: ClientListParams,
    master_key: str | None = None,
) -> PaginatedResponse[ClientWithStats]:
    """Return paginated clients with aggregated record/payment stats.

    Accepted exception to repo-owned list (GH #206): non-ORM projection +
    separate count query excluding correlated stat subqueries. Stays
    service-owned; CQRS read-side evaluation tracked in GH #217.

    GH #263 T3 (D1/D3/D4): the per-master EXISTS scope narrows rows ONLY
    when the caller did NOT pass the ``phone`` digits-filter (phone
    search spans ALL active studio clients — D4); both predicates land
    before BOTH queries (``total`` honest). Masked contacts on every
    scoped (master) response — the second of the TWO Client assembly
    points (domain rules clients.md, «Two mapper paths»).
    """

    # 1. Correlated scalar subqueries — one per stat, each reads ONE relation
    #    (no join-then-aggregate → cartesian product is structurally impossible).
    records_count_sq = (
        select(func.count(Record.id))
        .where(Record.client_id == Client.id)
        .correlate(Client)
        .scalar_subquery()
    )
    last_record_sq = (
        select(func.max(Activity.start))
        .select_from(Record)
        .join(Activity, Record.activity_id == Activity.id)
        .where(Record.client_id == Client.id)
        .correlate(Client)
        .scalar_subquery()
    )
    missed_records_sq = (
        select(func.count(Record.id))
        .where(
            Record.client_id == Client.id,
            Record.status == VisitStatus.MISSED,
        )
        .correlate(Client)
        .scalar_subquery()
    )
    total_paid_sq = (
        select(func.coalesce(func.sum(Payment.amount), 0))
        .select_from(Payment)
        .join(Record, Payment.record_id == Record.id)
        .where(Record.client_id == Client.id)
        .correlate(Client)
        .scalar_subquery()
    )

    records_count_col = records_count_sq.label("records_count")
    last_record_col = last_record_sq.label("last_record")
    missed_records_col = missed_records_sq.label("missed_records")
    total_paid_col = total_paid_sq.label("total_paid")

    # 2. Select Client columns + the four stat scalar subqueries
    base_cols = [
        Client.id,
        Client.name,
        Client.phone,
        Client.email,
        Client.channel,
        Client.created_at,
        Client.updated_at,
        Client.is_active,
        records_count_col,
        last_record_col,
        total_paid_col,
        missed_records_col,
    ]

    # 3. Count query (total matching clients) — independent of stats
    count_query = select(func.count(Client.id))

    # 4. Main query — no outerjoin to stat subqueries; scalar subqueries are inline
    query = select(*base_cols)

    # 5. Apply archive status filter (default: active only; ALL = no filter)
    if params.status == ArchiveStatus.ACTIVE:
        query = query.where(Client.is_active)
        count_query = count_query.where(Client.is_active)
    elif params.status == ArchiveStatus.ARCHIVED:
        query = query.where(not_(Client.is_active))
        count_query = count_query.where(not_(Client.is_active))

    # 5b. GH #263 T3 — per-master scope (D1/D4): EXISTS «есть запись
    #     клиента к своей активности», UNLESS this is a phone search —
    #     ``?phone=`` spans ALL active studio clients (D4). Lands on BOTH
    #     queries so ``total`` reflects the scoped set.
    if master_key is not None and params.phone is None:
        scope_pred = _client_scope_predicate(master_key)
        query = query.where(scope_pred)
        count_query = count_query.where(scope_pred)

    # 6. Apply other filters
    # GH #212: shared search predicate (was hand-rolled search ilike) — must
    # hit BOTH queries so `total` stays honest (spec §7 case 8).
    if params.q:
        pred = search_predicate(params.q, ClientService.search_fields)
        query = query.where(pred)
        count_query = count_query.where(pred)

    # GH #221 §4: digits-mode phone filter — national-digit substring via the
    # memo_phone_national SQLite UDF (T1). Validator guarantees digits-only,
    # so no LIKE-wildcard escaping (deliberately NOT search_predicate — the
    # literal `q` seam stays separate). Must hit BOTH queries so `total`
    # reflects the filtered set, same invariant as `q`.
    if params.phone:
        phone_cond = func.memo_phone_national(Client.phone).like(f"%{params.phone}%")
        query = query.where(phone_cond)
        count_query = count_query.where(phone_cond)

    if params.created_from:
        cond = Client.created_at >= datetime.combine(params.created_from, datetime.min.time())
        query = query.where(cond)
        count_query = count_query.where(cond)

    if params.created_to:
        cond = Client.created_at <= datetime.combine(params.created_to, datetime.max.time())
        query = query.where(cond)
        count_query = count_query.where(cond)

    if params.updated_from:
        cond = Client.updated_at >= datetime.combine(params.updated_from, datetime.min.time())
        query = query.where(cond)
        count_query = count_query.where(cond)

    if params.updated_to:
        cond = Client.updated_at <= datetime.combine(params.updated_to, datetime.max.time())
        query = query.where(cond)
        count_query = count_query.where(cond)

    # Stats-based filters (applied to both queries)
    stats_filter_map = {
        "min_records": records_count_sq,
        "max_records": records_count_sq,
        "min_paid": total_paid_sq,
        "max_paid": total_paid_sq,
        "missed_from": missed_records_sq,
        "missed_to": missed_records_sq,
    }
    ops_map = {
        "min_records": lambda col, val: col >= val,
        "max_records": lambda col, val: col <= val,
        "min_paid": lambda col, val: col >= val,
        "max_paid": lambda col, val: col <= val,
        "missed_from": lambda col, val: col >= val,
        "missed_to": lambda col, val: col <= val,
    }
    for param_name in stats_filter_map:
        value = getattr(params, param_name)
        if value is not None:
            col = stats_filter_map[param_name]
            condition = ops_map[param_name](col, value)
            query = query.where(condition)
            count_query = count_query.where(condition)

    # 6. Get total count
    total_result = await db_session.execute(count_query)
    total = total_result.scalar() or 0

    # 7. Apply sorting
    sort_column_map = {
        "name": Client.name,
        "records_count": records_count_sq,
        "last_record": last_record_sq,
        "total_paid": total_paid_sq,
        "missed_records": missed_records_sq,
        "created_at": Client.created_at,
        "updated_at": Client.updated_at,
    }
    sort_col = sort_column_map.get(params.sort_by, Client.name)
    if params.sort_order == "desc":
        query = query.order_by(sort_col.desc().nullslast())
    else:
        query = query.order_by(sort_col.asc().nullsfirst())

    # 8. Apply pagination
    offset = (params.page - 1) * params.per_page
    query = query.offset(offset).limit(params.per_page)

    # 9. Execute and map to Pydantic
    result = await db_session.execute(query)
    rows = result.all()

    items: list[ClientWithStats] = []
    for row in rows:
        last_record = None
        if row.last_record:
            last_record = row.last_record.isoformat() if isinstance(row.last_record, datetime) else str(row.last_record)

        items.append(
            ClientWithStats(
                id=row.id,
                name=row.name,
                phone=row.phone,
                email=row.email,
                channel=row.channel,
                created_at=row.created_at,
                updated_at=row.updated_at,
                is_active=row.is_active,
                records_count=row.records_count or 0,
                last_record=last_record,
                total_paid=row.total_paid or 0,
                missed_records=row.missed_records or 0,
            )
        )

    # GH #263 T3 (D3): contact mask on the scoped (master) response —
    # applied AFTER assembly so the stats builder stays schema-first.
    if master_key is not None:
        items = [_mask_client_contacts(i) for i in items]

    return PaginatedResponse(
        items=items,
        total=total,
        page=params.page,
        per_page=params.per_page,
    )
