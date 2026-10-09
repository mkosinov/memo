"""Business logic for client CRUD operations."""

from __future__ import annotations

from datetime import datetime
from functools import lru_cache
from typing import TYPE_CHECKING, Any, TypeVar

from sqlalchemy import ColumnElement, ScalarSelect, delete, func, not_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.scope import mask_phone
from src.domain.sorting import SortKeyMap, SortKeySpec, apply_sort
from src.domain.visit_status import VisitStatus
from src.events.emitter import mark_changed
from src.models.activity import Activity
from src.models.client import Client
from src.models.enums import ArchiveStatus
from src.models.payment import Payment
from src.models.record import Record
from src.repositories.client import ClientRepository, get_client_repository
from src.repositories.search import SearchField, ids_in_predicate, search_predicate
from src.schemas.client import (
    ClientCreate,
    ClientListParams,
    ClientResponse,
    ClientUpdate,
    ClientViewResponse,
)
from src.schemas.common import PaginatedResponse
from src.services.generic import ArchiveService

if TYPE_CHECKING:
    from collections.abc import Sequence
    from uuid import UUID

    from src.domain.sorting import SortExpr

ResponseT = TypeVar("ResponseT", bound=ClientResponse)


def _client_scope_predicate(master_key: str) -> ColumnElement[bool]:
    """EXISTS «есть запись клиента к активности этого мастера» (D1).

    Records are hard-delete (``AbstractModel``, no ``is_active``) — every
    existing row is non-archived, so the predicate is a plain EXISTS over
    records → activities. Single implementation for BOTH consumer paths:
    ``ClientService`` (generic list / point get) and the manual
    ``list_clients_view`` builder.
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
    """Client service — the standard ``ArchiveService`` shape (GH #327).

    The unified DELETE execute branch no longer lives here: the
    ``usecases.clients.delete_client`` scenario owns the resolution
    cascade (nullify dispatch over ``NULLIFY_HANDLERS`` + the visitors
    cascade + this service's own-edge ``delete_row_with_tags``). The
    former ``_visitor_service`` DI existed ONLY for the dismantled
    ``_h_cascade_client_visitors`` handler and is gone with it — the
    scenario resolves the ``get_visitor_service()`` singleton itself,
    so tests that monkeypatch ``VisitorService._delete_cascade`` on
    the singleton still intercept (the patch point is unchanged).
    """

    def __init__(
        self,
        repository: ClientRepository,
        model: type[Client],
        response_schema: type[ClientResponse],
    ) -> None:
        super().__init__(repository, model, response_schema)
        # GH #327 Task 3: narrow the attribute type to the owner repo — the
        # own-edge bulk command (``delete_tags_by_client_id``) executes
        # through ``ClientRepository``, and the declared type lets mypy see
        # it without casts (precedent: PaymentService.__init__, GH #171 T1).
        # The repository stays stateless — the switch from the generic
        # ``ArchiveRepository`` singleton to the specialized one is
        # behavior-neutral for every inherited path.
        self._repository: ClientRepository = repository

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
        order_by: Sequence[SortExpr] | None = None,
        q: str | None = None,
        ids: Sequence[UUID] | None = None,
        status: ArchiveStatus = ArchiveStatus.ACTIVE,
        master_key: str | None = None,
        **filters: Any,
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
        honest (generic list contract). ``ids`` (GH #232 §3.1) rides the
        ``_list_stmt`` typed narrowing — the generic contract, no extra
        handling here.
        """
        phone = filters.pop("phone", None)
        stmt = self._list_stmt(ids=ids, status=status, **filters)
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

    # ── GH #171 Task 2 — scenario building block (no transaction) ───────

    async def get_or_create_by_phone(
        self,
        db_session: AsyncSession,
        phone: str,
        name: str | None = None,
    ) -> Client:
        """Find the client by exact phone, or create one — WITHOUT committing.

        Non-transactional scenario building block for the usecases layer
        (canon docs/domain-rules/service-layer.md rules 3-4) — moved
        BEHAVIOR-FOR-BEHAVIOR from ``RecordService._resolve_client_by_phone``
        (the future create_record scenario re-links it in Task 6):
        exact-phone lookup; on a miss a client is created with the
        caller-supplied display name (``None`` → "Гость" — the legacy
        empty-visit-name default) and the default channel "whatsapp",
        then flushed so ``id`` is populated. ``mark_changed("clients")``
        fires ONLY on the creation branch (GH #239 §3.3); outside an
        active transaction the mark is a no-op. Value-typed parameters
        (``phone``, ``name``) — no foreign ORM/schema objects.
        """
        result = await db_session.execute(
            select(Client).where(Client.phone == phone)
        )
        client = result.scalar_one_or_none()
        if not client:
            client = Client(
                phone=phone,
                name=name or "Гость",
                channel="whatsapp",
            )
            db_session.add(client)
            await db_session.flush()
            # GH #239 §3.3: conditional mark — only when actually created
            mark_changed("clients")
        return client

    # ── GH #327 Task 3 — own-edge delete building block (no transaction) ──

    async def delete_row_with_tags(self, db_session: AsyncSession, client_id: str) -> None:
        """Remove the client's OWN tag bundle + the client row — WITHOUT
        committing.

        GH #327 Task 3 scenario building block (no transaction; canon
        docs/domain-rules/service-layer.md rules 1, 3-4): the caller's
        scenario owns the transaction boundary and the commit. The
        ``client_tags`` join rows are the client's OWN child links without
        a lifecycle of their own (rule 1), so their bulk delete lives in
        the owner repository (``ClientRepository.delete_tags_by_client_id``
        — ONE set-based statement) and runs BEFORE the row (the join's
        FKs carry no ondelete action — #194). The row goes by a bulk
        ``DELETE ... WHERE id`` statement (no instance-delete switch);
        the whole cascade is orchestrated by the future
        ``usecases.clients.delete_client`` scenario (GH #327 Task 4).
        No event marks here — "clients"/"client_tags" are the scenario's
        own-entity and edge marks. Precedent:
        ``RecordService.delete_row_with_tags``.
        """
        await self._repository.delete_tags_by_client_id(db_session, client_id)
        await db_session.execute(delete(Client).where(Client.id == client_id))


@lru_cache
def get_client_service() -> ClientService:
    """Singleton ClientService over the specialized owner repository.

    GH #327: the ``_visitor_service`` DI injection is GONE — the client
    delete cascade lives in the ``usecases.clients.delete_client``
    scenario, which resolves the ``get_visitor_service()`` singleton
    itself on every call. Tests that monkeypatch
    ``VisitorService._delete_cascade`` patch that SAME singleton — the
    scenario sees the patched method (the atomicity test's point).

    GH #327 Task 3: the service sits on the specialized owner repository
    (``ClientRepository``) — the generic archive singleton gave way to the
    first own table command (``delete_tags_by_client_id``); every inherited
    path is behavior-neutral (the specialized repo adds commands, changes
    none).
    """
    return ClientService(
        get_client_repository(),
        Client,
        ClientResponse,
    )


# ─── GH #367 Task 6: module-level stat subquery builders + sort map ──────────
#
# Correlated scalar subqueries — one per stat, each reads ONE relation
# (no join-then-aggregate → cartesian product is structurally impossible).
# Module-level BUILDERS since Task 6: ``list_clients_view``'s labeled
# projection, the stats filters, and the sort map need INDEPENDENT
# subquery instances per clause position (one ``scalar_subquery()``
# object must not be planted into several clauses of one statement);
# builders give each consumer a fresh, content-identical object. The
# sort map below composes the same builders, making it importable at
# module level for the CI drift guard (tests/domain/test_sorting.py —
# Literal == map).
def _records_count_sq() -> ScalarSelect[Any]:
    return (
        select(func.count(Record.id))
        .where(Record.client_id == Client.id)
        .correlate(Client)
        .scalar_subquery()
    )


def _last_record_sq() -> ScalarSelect[Any]:
    return (
        select(func.max(Activity.start))
        .select_from(Record)
        .join(Activity, Record.activity_id == Activity.id)
        .where(Record.client_id == Client.id)
        .correlate(Client)
        .scalar_subquery()
    )


def _missed_records_sq() -> ScalarSelect[Any]:
    return (
        select(func.count(Record.id))
        .where(
            Record.client_id == Client.id,
            Record.status == VisitStatus.MISSED,
        )
        .correlate(Client)
        .scalar_subquery()
    )


def _total_paid_sq() -> ScalarSelect[Any]:
    return (
        select(func.coalesce(func.sum(Payment.amount), 0))
        .select_from(Payment)
        .join(Record, Payment.record_id == Record.id)
        .where(Record.client_id == Client.id)
        .correlate(Client)
        .scalar_subquery()
    )


# Sort map (GH #367 Task 3; hoisted module-level in Task 6 for the drift
# guard). Direct map indexing — the ``ClientSortBy`` Literal (schema, 422)
# guarantees a valid key; ``apply_sort``'s ``UnknownSortKeyError`` is the
# safety net for direct service calls. Nulls policy is ``canonical`` for
# ALL keys (asc → nullsfirst / desc → nullslast — exactly the pre-#367
# inline behavior; ``last_record`` is the only nullable key and keeps
# clients without records on top at asc).
_CLIENT_SORT_KEYS: SortKeyMap = {
    "name": SortKeySpec([Client.name]),
    "records_count": SortKeySpec([_records_count_sq()]),
    "last_record": SortKeySpec([_last_record_sq()]),
    "total_paid": SortKeySpec([_total_paid_sq()]),
    "missed_records": SortKeySpec([_missed_records_sq()]),
    "created_at": SortKeySpec([Client.created_at]),
    "updated_at": SortKeySpec([Client.updated_at]),
}


async def list_clients_view(
    db_session: AsyncSession,
    params: ClientListParams,
    master_key: str | None = None,
) -> PaginatedResponse[ClientViewResponse]:
    """Return paginated clients with aggregated record/payment stats.

    Table-page read function named per the ``list_<entity>_view``
    convention (GH #217 Task 5; naming decision — ADR 007 item 5;
    renamed from ``list_clients_with_stats``, internal name only).

    Accepted exception to repo-owned list (GH #206): non-ORM projection +
    separate count query excluding correlated stat subqueries. Stays
    service-owned with the hand-written cheap count — decision — ADR 007
    (item 3, documented exception; switching to ``list_custom`` requires
    a measurement on real data first).

    GH #263 T3 (D1/D3/D4): the per-master EXISTS scope narrows rows ONLY
    when the caller did NOT pass the ``phone`` digits-filter (phone
    search spans ALL active studio clients — D4); both predicates land
    before BOTH queries (``total`` honest). Masked contacts on every
    scoped (master) response — the second of the TWO Client assembly
    points (domain rules clients.md, «Two mapper paths»).
    """

    # 1. Correlated scalar subqueries — one per stat, each reads ONE relation
    #    (no join-then-aggregate → cartesian product is structurally impossible).
    #    GH #367 Task 6: built by the module-level builders (shared with
    #    ``_CLIENT_SORT_KEYS``, see above); fresh instances per call for the
    #    labeled projection and the stats filters below.
    records_count_sq = _records_count_sq()
    last_record_sq = _last_record_sq()
    missed_records_sq = _missed_records_sq()
    total_paid_sq = _total_paid_sq()

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

    # GH #232 §3.1: typed ``?id=`` set narrowing — the shared one-line
    # helper, applied AFTER the scope predicate (scope + D3 masking are
    # inherited: the narrowing only ever shrinks the already-scoped set)
    # and hitting BOTH queries so ``total`` stays honest. Must precede the
    # COUNT like every filter.
    id_pred = ids_in_predicate(Client.id, params.id)
    if id_pred is not None:
        query = query.where(id_pred)
        count_query = count_query.where(id_pred)

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

    # 7. Apply sorting (GH #367 Task 3: map as ``SortKeyMap`` + shared
    #    resolver with the ``Client.id`` tie-break, spec §4.2/§4.3; Task 6
    #    hoisted the map to module level — ``_CLIENT_SORT_KEYS``, the CI
    #    drift-guard import point). Nulls policy and tie-break notes live
    #    with the map.
    query = query.order_by(
        *apply_sort(_CLIENT_SORT_KEYS, params.sort_by, params.sort_order, Client.id)
    )

    # 8. Apply pagination
    offset = (params.page - 1) * params.per_page
    query = query.offset(offset).limit(params.per_page)

    # 9. Execute and map to Pydantic
    result = await db_session.execute(query)
    rows = result.all()

    items: list[ClientViewResponse] = []
    for row in rows:
        last_record = None
        if row.last_record:
            last_record = row.last_record.isoformat() if isinstance(row.last_record, datetime) else str(row.last_record)

        items.append(
            ClientViewResponse(
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
