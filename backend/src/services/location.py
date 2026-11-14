"""Business logic for location CRUD operations."""

from functools import lru_cache

from sqlalchemy import asc, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.domain.errors import BareListLimitExceededError
from src.models.location import Location
from src.repositories.generic import get_archive_repository
from src.repositories.search import SearchField
from src.schemas.location import (
    LocationCreate,
    LocationPublicResponse,
    LocationResponse,
    LocationUpdate,
)
from src.services.generic import BARE_LIST_MAX_ROWS, ArchiveService


class LocationService(ArchiveService[LocationCreate, LocationUpdate, LocationResponse]):
    """Location service with NOT NULL field protection on PATCH."""

    # GH #601: is_public is NOT NULL — a PATCH null means 'don't change'.
    NOT_NULL_FIELDS = {"title", "capacity", "sort_order", "is_public"}

    # GH #212 search matrix (spec §5.2): substring on the 4 text fields;
    # id is exact-uuid (deep-link prerequisite #216); the 3 URL fields are
    # EXACT full-string equality only — a pasted full Yandex-map/review/
    # image URL finds the location, partial URLs never match (spec §5.2
    # note: no ilike on URL columns).
    search_fields = [
        SearchField(Location.title),
        SearchField(Location.short_title),
        SearchField(Location.address),
        SearchField(Location.description),
        SearchField(Location.id, kind="uuid"),
        SearchField(Location.yandex_map_url, kind="exact"),
        SearchField(Location.review_url, kind="exact"),
        SearchField(Location.image_url, kind="exact"),
    ]


@lru_cache
def get_location_service() -> LocationService:
    return LocationService(get_archive_repository(), Location, LocationResponse)


async def list_public_locations_view(
    db_session: AsyncSession,
) -> list[LocationPublicResponse]:
    """``/api/v1/public/locations`` anonymous dictionary (ADR-015, #601).

    Modeled on ``list_public_activities_view`` (the #600 precedent): a
    module-level free function behind the anonymous route, with a
    per-audience schema and FORCED visibility — only rows that are
    BOTH not archived (``is_active``) and shown on the site
    (``is_public``, NOT NULL since the #601 migration) leave the
    server; a hidden or archived location is invisible to the web,
    never a client-side concern. The shared ``LocationService.list`` /
    ``list_all`` are NOT touched (the admin grid and dropdowns ride
    them — hidden stays fully working inside the admin).

    Bare array canon of ``/all`` (spec §2.2): no parameters, no
    envelope, pinned order ``sort_order ASC, title ASC, id ASC`` (the
    deterministic dictionary default), the ``BARE_LIST_MAX_ROWS``
    ceiling via the same LIMIT+1 probe (the 1001st row raises
    ``BareListLimitExceededError`` → 422 in the router).
    """
    stmt = (
        select(Location)
        .where(Location.is_active.is_(True), Location.is_public.is_(True))
        .order_by(asc(Location.sort_order), asc(Location.title), asc(Location.id))
        .limit(BARE_LIST_MAX_ROWS + 1)
    )
    result = await db_session.execute(stmt)
    rows = list(result.scalars().all())
    if len(rows) > BARE_LIST_MAX_ROWS:
        raise BareListLimitExceededError(Location.__tablename__, BARE_LIST_MAX_ROWS)
    return [LocationPublicResponse.model_validate(row) for row in rows]
