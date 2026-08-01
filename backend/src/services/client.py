"""Business logic for client CRUD operations."""

from __future__ import annotations

from datetime import datetime
from functools import lru_cache

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.activity import Activity
from src.models.client import Client
from src.models.payment import Payment
from src.models.record import Record
from src.repositories.generic import get_soft_delete_repository
from src.schemas.client import (
    ClientCreate,
    ClientListParams,
    ClientListResponse,
    ClientResponse,
    ClientUpdate,
    ClientWithStats,
)
from src.services.generic import GenericService


class ClientService(GenericService[ClientCreate, ClientUpdate, ClientResponse]):
    """Client service — стандартный GenericService без NOT NULL полей."""


@lru_cache
def get_client_service() -> ClientService:
    return ClientService(get_soft_delete_repository(), Client, ClientResponse)


async def list_clients_with_stats(
    db_session: AsyncSession,
    params: ClientListParams,
) -> ClientListResponse:
    """Return paginated clients with aggregated record/payment stats."""

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
            Record.status == "missed",
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

    # 5. Apply is_active filter: default to True (active only) when not specified
    is_active_filter = params.is_active if params.is_active is not None else True
    query = query.where(Client.is_active == is_active_filter)
    count_query = count_query.where(Client.is_active == is_active_filter)

    # 6. Apply other filters
    if params.search:
        search_pattern = f"%{params.search}%"
        query = query.where(
            (Client.name.ilike(search_pattern)) | (Client.phone.ilike(search_pattern))
        )
        count_query = count_query.where(
            (Client.name.ilike(search_pattern)) | (Client.phone.ilike(search_pattern))
        )

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

    return ClientListResponse(
        items=items,
        total=total,
        page=params.page,
        per_page=params.per_page,
    )
