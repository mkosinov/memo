"""Search endpoints for entity lookup (typeahead)."""

from fastapi import APIRouter, Query
from sqlalchemy import select

from src.db import SessionDep
from src.models.activity import Activity
from src.models.service import Service
from src.models.tag import Tag
from src.models.visitor import Visitor
from src.schemas.search import (
    ActivitySearchResult,
    ServiceSearchResult,
    TagSearchResult,
    VisitorSearchResult,
)

router = APIRouter(tags=["search"])


@router.get("/visitors", response_model=list[VisitorSearchResult])
async def search_visitors(
    q: str = Query(min_length=1, max_length=100),
    session: SessionDep = None,
) -> list[VisitorSearchResult]:
    """Search visitors by name (case-insensitive substring)."""
    pattern = f"%{q}%"
    result = await session.execute(
        select(Visitor)
        .where(Visitor.name.ilike(pattern), Visitor.is_active == True)  # noqa: E712
        .limit(10)
    )
    return [
        VisitorSearchResult(id=v.id, name=v.name, age=v.age)
        for v in result.scalars().all()
    ]


@router.get("/services", response_model=list[ServiceSearchResult])
async def search_services(
    q: str = Query(min_length=1, max_length=100),
    session: SessionDep = None,
) -> list[ServiceSearchResult]:
    """Search services by title (case-insensitive substring)."""
    pattern = f"%{q}%"
    result = await session.execute(
        select(Service)
        .where(Service.title.ilike(pattern), Service.is_active == True)  # noqa: E712
        .limit(10)
    )
    return [
        ServiceSearchResult(id=s.id, title=s.title)
        for s in result.scalars().all()
    ]


@router.get("/activities", response_model=list[ActivitySearchResult])
async def search_activities(
    q: str = Query(min_length=1, max_length=100),
    service_id: str | None = Query(None),
    session: SessionDep = None,
) -> list[ActivitySearchResult]:
    """Search activities by service title (case-insensitive substring)."""
    pattern = f"%{q}%"
    stmt = (
        select(Activity.id, Activity.start, Service.title.label("service_title"))
        .join(Service, Activity.service_id == Service.id)
        .where(
            Service.title.ilike(pattern),
            Activity.is_active == True,  # noqa: E712
        )
    )
    if service_id:
        stmt = stmt.where(Activity.service_id == service_id)
    result = await session.execute(stmt.limit(10))
    return [
        ActivitySearchResult(
            id=row.id,
            start=row.start.strftime("%H:%M %d.%m.%Y"),
            service_id=row.service_id,
            service_title=row.service_title,
        )
        for row in result.all()
    ]


@router.get("/tags", response_model=list[TagSearchResult])
async def search_tags(
    q: str = Query(min_length=1, max_length=100),
    session: SessionDep = None,
) -> list[TagSearchResult]:
    """Search tags by name (case-insensitive substring)."""
    pattern = f"%{q}%"
    result = await session.execute(
        select(Tag)
        .where(Tag.tag.ilike(pattern))
        .limit(10)
    )
    return [
        TagSearchResult(id=t.id, tag=t.tag)
        for t in result.scalars().all()
    ]
