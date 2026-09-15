"""Business logic for payment CRUD operations.

GH #263 T4 (D5): у оплаты нет своей колонки мастера — скоуп роли
``master`` только через ``payment → record → activity.master_id``
(«всё через записи»). Список строится сервисным stmt-биллдером через
штатную точку расширения generic-механизма (образец — записи/фото,
паттерн #213): сервис собирает stmt, repo-кор (``list_entity``)
делает счёт/сортировку/пагинацию.
"""

from datetime import datetime
from functools import lru_cache

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.activity import Activity
from src.models.payment import Payment
from src.models.record import Record
from src.repositories.generic import get_base_repository
from src.repositories.search import search_predicate
from src.schemas.common import PaginatedResponse
from src.schemas.payment import PaymentCreate, PaymentResponse, PaymentUpdate
from src.services.generic import GenericService
from src.services.decorators import transactional


class PaymentService(GenericService[PaymentCreate, PaymentUpdate, PaymentResponse]):
    """Payment service. Strips null for NOT NULL fields (amount) in PATCH.

    Overrides ``create`` to apply an explicit business rule for the optional
    ``created_at`` field: when the client omits it (``None``), the service
    sets it to the current UTC time before delegating to the generic path.
    When the client supplies a value, it is passed through unchanged.

    ``list`` is overridden (GH #263 T4): a scoped master gets only the
    payments of HIS records — the stmt joins payment → record → activity
    and filters ``activities.master_id``; ``master_key=None`` (admin)
    keeps the generic path's plain equality-filter behaviour.
    """

    NOT_NULL_FIELDS = {"amount"}

    def _build_list_stmt(
        self,
        master_key: str | None = None,
        **filters,
    ):
        """Assemble the payments-list query (GH #263 T4, pattern #213).

        Server scope first: ``master_key`` (the requester's scope) joins
        payment → record → activity and filters ``activities.master_id`` —
        an own-column-less payment is visible only through its record
        (D5). ``None`` (admin) adds no join and no filter. The generic
        equality filters (``**filters``, e.g. ``record_id=``/``id=`` from
        the shared contract) AND conjunctively with the scope — the base
        ``GenericService._list_stmt`` semantics are preserved.
        """
        stmt = select(Payment)
        if master_key is not None:
            stmt = (
                stmt.join(Record, Payment.record_id == Record.id)
                .join(Activity, Record.activity_id == Activity.id)
                .where(Activity.master_id == master_key)
            )
        for key, value in filters.items():
            if value is not None:
                stmt = stmt.where(getattr(Payment, key) == value)
        return stmt

    async def list(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 20,
        order_by=None,
        q: str | None = None,
        master_key: str | None = None,
        **filters,
    ) -> PaginatedResponse[PaymentResponse]:
        """Return a paginated page of payments, optionally filtered.

        GH #263 T4: scoped stmt from ``_build_list_stmt``; the repo core
        (``BaseRepository.list_entity``) owns count / order / limit-offset
        (count runs on the unordered stmt, per #213). ``master_key=None``
        (admin) → no join, no scope filter. The base-generic surface is
        kept intact: ``order_by`` sorts after the count, ``q`` narrows via
        ``search_fields`` (fail-fast like the base repo when a field-less
        q arrives), and any ``**filters`` (``id=``, ``record_id=``, …)
        apply as equality predicates conjunctive with the scope.
        """
        stmt = self._build_list_stmt(master_key=master_key, **filters)
        if q is not None:
            if not self.search_fields:
                raise ValueError("q received without search_fields (fail-fast)")
            stmt = stmt.where(search_predicate(q, self.search_fields))
        items_orm, total = await self._repository.list_entity(
            db_session,
            stmt,
            order_by=order_by,
            limit=per_page,
            offset=(page - 1) * per_page,
        )
        items = [self._response_schema.model_validate(o) for o in items_orm]
        return PaginatedResponse(items=items, total=total, page=page, per_page=per_page)

    async def get_scoped(
        self, db_session: AsyncSession, id: str, master_key: str | None
    ) -> Payment | None:
        """Point get with the per-master scope in ONE query (GH #263 T4).

        Scope chain: payment → record → activity — чужой payment is
        indistinguishable from missing (``None`` → route renders 404;
        404-fast-path, plan T7). ``master_key=None`` (admin) → unfiltered.
        """
        stmt = (
            select(Payment)
            .join(Record, Payment.record_id == Record.id)
            .join(Activity, Record.activity_id == Activity.id)
            .where(Payment.id == id)
        )
        if master_key is not None:
            stmt = stmt.where(Activity.master_id == master_key)
        return (await db_session.execute(stmt)).scalar_one_or_none()

    async def get_record_scoped(
        self, db_session: AsyncSession, record_id: str, master_key: str | None
    ) -> Record | None:
        """Parent-record owner gate for payment create (GH #263 T4).

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

    @transactional
    async def create(
        self, db_session: AsyncSession, data: PaymentCreate
    ) -> PaymentResponse:
        """Create a payment with an explicit ``created_at`` default rule.

        Business rule: if the client does not supply ``created_at``, the
        service sets it to ``datetime.utcnow()`` (matching the ORM column
        default on ``AbstractModel``).  After this decision, ``created_at``
        is always present on *data*, so the generic create path handles
        persistence without any special-casing.
        """
        if data.created_at is None:
            data = data.model_copy(update={"created_at": datetime.utcnow()})
        return await super().create(db_session, data)


@lru_cache
def get_payment_service() -> PaymentService:
    return PaymentService(get_base_repository(), Payment, PaymentResponse)


async def get_payment_totals(
    db_session: AsyncSession,
    record_ids: list[str],
    master_key: str | None = None,
) -> dict[str, int]:
    """Return {record_id: sum(amount)} for the given record IDs.

    Payments are hard-deleted — no is_active filter needed.

    GH #263 T4: a scoped master's ``record_ids`` are filtered to HIS OWN
    records BEFORE the aggregation (ONE query: record → activity,
    ``activities.master_id == master_key``) — чужие IDs are silently
    excluded; all-foreign (or filtered-to-empty) → ``{}``. The response
    contract is unchanged; ``master_key=None`` (admin) → no filtering.
    """
    if not record_ids:
        return {}
    if master_key is not None:
        own_rows = await db_session.execute(
            select(Record.id)
            .join(Activity, Record.activity_id == Activity.id)
            .where(Record.id.in_(record_ids), Activity.master_id == master_key)
        )
        own_ids = list(own_rows.scalars().all())
        if not own_ids:
            return {}
        record_ids = own_ids
    stmt = (
        select(Payment.record_id, func.sum(Payment.amount))
        .where(Payment.record_id.in_(record_ids))
        .group_by(Payment.record_id)
    )
    result = await db_session.execute(stmt)
    return {row[0]: row[1] for row in result.all()}
