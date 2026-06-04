"""Business logic for client CRUD operations."""

from __future__ import annotations

from datetime import datetime
from functools import lru_cache

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.client import Client
from src.models.payment import Payment
from src.models.record import Record
from src.models.visit import Visit
from src.repositories.generic import get_generic_repository
from src.schemas.client import (
    ClientCreate,
    ClientListParams,
    ClientListResponse,
    ClientResponse,
    ClientUpdate,
    ClientWithStats,
)
from src.services.generic import GenericService


@lru_cache
def get_client_service() -> GenericService[ClientCreate, ClientUpdate, ClientResponse]:
    return GenericService(get_generic_repository(), Client, ClientResponse)


async def list_clients_with_stats(
    db_session: AsyncSession,
    params: ClientListParams,
) -> ClientListResponse:
    """Return paginated clients with aggregated visit/payment stats."""

    # 1. Build stats subquery
    stats_subq = (
        select(
            Record.client_id,
            func.count(Visit.id).label("visits_count"),
            func.max(Visit.created_at).label("last_visit"),
            func.coalesce(func.sum(Payment.amount), 0).label("total_paid"),
            func.sum(case((Visit.status == "missed", 1), else_=0)).label(
                "missed_visits"
            ),
        )
        .join(Visit, Visit.record_id == Record.id)
        .outerjoin(Payment, Payment.record_id == Record.id)
        .where(Record.is_active == True)  # noqa: E712
        .group_by(Record.client_id)
        .subquery()
    )

    # 2. Select specific columns from both Client and stats subquery
    base_cols = [
        Client.id,
        Client.name,
        Client.phone,
        Client.email,
        Client.channel,
        Client.created_at,
        Client.updated_at,
        Client.is_active,
        stats_subq.c.visits_count,
        stats_subq.c.last_visit,
        stats_subq.c.total_paid,
        stats_subq.c.missed_visits,
    ]

    # 3. Count query (total matching clients)
    count_query = (
        select(func.count(Client.id))
        .outerjoin(stats_subq, Client.id == stats_subq.c.client_id)
        .where(Client.is_active == True)  # noqa: E712
    )

    # 4. Main query
    query = (
        select(*base_cols)
        .outerjoin(stats_subq, Client.id == stats_subq.c.client_id)
        .where(Client.is_active == True)  # noqa: E712
    )

    # 5. Apply filters
    if params.search:
        search_pattern = f"%{params.search}%"
        query = query.where(
            (Client.name.ilike(search_pattern)) | (Client.phone.ilike(search_pattern))
        )
        count_query = count_query.where(
            (Client.name.ilike(search_pattern)) | (Client.phone.ilike(search_pattern))
        )

    if params.is_active is not None:
        query = query.where(Client.is_active == params.is_active)
        count_query = count_query.where(Client.is_active == params.is_active)

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
        "min_visits": stats_subq.c.visits_count,
        "max_visits": stats_subq.c.visits_count,
        "min_paid": stats_subq.c.total_paid,
        "max_paid": stats_subq.c.total_paid,
        "missed_from": stats_subq.c.missed_visits,
        "missed_to": stats_subq.c.missed_visits,
    }
    ops_map = {
        "min_visits": lambda col, val: col >= val,
        "max_visits": lambda col, val: col <= val,
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
        "visits_count": stats_subq.c.visits_count,
        "last_visit": stats_subq.c.last_visit,
        "total_paid": stats_subq.c.total_paid,
        "missed_visits": stats_subq.c.missed_visits,
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
        last_visit = None
        if row.last_visit:
            last_visit = row.last_visit.isoformat() if isinstance(row.last_visit, datetime) else str(row.last_visit)

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
                visits_count=row.visits_count or 0,
                last_visit=last_visit,
                total_paid=row.total_paid or 0,
                missed_visits=row.missed_visits or 0,
            )
        )

    return ClientListResponse(
        items=items,
        total=total,
        page=params.page,
        per_page=params.per_page,
    )
