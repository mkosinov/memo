"""FastAPI router for location CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import asc

from src.db import SessionDep
from src.domain.deletion import ResolutionError, collect_dependencies
from src.domain.errors import BareListLimitExceededError
from src.errors import ErrorCode, ErrorDetail
from src.models.enums import ArchiveStatus
from src.models.location import Location
from src.schemas.common import PaginatedResponse, SortOrder
from src.schemas.location import (
    LocationCreate,
    LocationPatch,
    LocationResponse,
    LocationSortBy,
    LocationUpdate,
    ReorderRequest,
)
from src.schemas.pagination import PaginationParams
from src.services.location import LocationService, get_location_service

router = APIRouter(tags=["locations"])


@lru_cache
def _get_location_service() -> LocationService:
    """Dependency factory returning a singleton LocationService."""
    return get_location_service()


_ServiceDep = Annotated[LocationService, Depends(_get_location_service)]

# Sort whitelist map: UI key → list of ORM columns (#205 Task 3, spec §4.5).
# ``archived`` → is_active (asc = is_active ASC = archived-first).
_LOCATION_SORT_MAP: dict[str, list] = {
    "name": [Location.name],
    "short_title": [Location.short_title],
    "capacity": [Location.capacity],
    "address": [Location.address],
    "location_hint": [Location.location_hint],
    "description": [Location.description],
    "archived": [Location.is_active],
    "yandex_map_url": [Location.yandex_map_url],
    "created_at": [Location.created_at],
}


def _location_order_by(sort_by: LocationSortBy | None, sort_order: SortOrder) -> list:
    """Build the ``order_by`` list for GET /api/v1/locations.

    * ``sort_by=None`` → spec §4.4 default: ``sort_order ASC, name ASC, id ASC``.
    * User sort → mapped columns with nulls-first (asc) / nulls-last (desc),
      then ``id ASC`` tiebreak for cross-page stability (records idiom).
    """
    if sort_by is None:
        return [asc(Location.sort_order), asc(Location.name), asc(Location.id)]
    cols = _LOCATION_SORT_MAP[sort_by]
    ordered = [
        c.desc().nullslast() if sort_order == "desc" else c.asc().nullsfirst()
        for c in cols
    ]
    return [*ordered, asc(Location.id)]


@router.get("", response_model=PaginatedResponse[LocationResponse])
async def list_locations(
    service: _ServiceDep,
    session: SessionDep,
    pagination: PaginationParams = Depends(),
    status: ArchiveStatus = Query(ArchiveStatus.ACTIVE),
    sort_by: LocationSortBy | None = Query(None),
    sort_order: SortOrder = Query("asc"),
    q: str | None = Query(None, min_length=2, max_length=100),
) -> PaginatedResponse[LocationResponse]:
    """Return locations filtered by archive status (default: active),
    sorted by sort_order, then name.

    ``status`` accepts ``active`` (default), ``archived``, or ``all`` — see
    ``ArchiveStatus``. Invalid values are rejected with 422 by FastAPI's
    enum validation.

    ``sort_by`` selects a whitelisted sort key (spec §4.5); ``sort_order``
    is ``asc`` (default) or ``desc``. Unknown ``sort_by`` → 422 via Literal
    validation. ``sort_by=None`` → spec §4.4 default order with ``id ASC``
    tiebreak.

    ``q`` (GH #212): case-insensitive substring on ``name``/``short_title``/
    ``address``/``description`` OR exact equality on ``id`` (full UUID) or
    the URL fields (``yandex_map_url``/``review_url``/``image_url`` — full
    string only, partial URLs never match); ``total`` reflects the filtered
    count. len<2 / len>100 → 422 VALIDATION_ERROR.
    """
    return await service.list(
        db_session=session,
        page=pagination.page,
        per_page=pagination.per_page,
        status=status,
        order_by=_location_order_by(sort_by, sort_order),
        q=q,
    )


@router.get("/all", response_model=list[LocationResponse])
async def list_all_locations(
    service: _ServiceDep,
    session: SessionDep,
    status: ArchiveStatus = Query(ArchiveStatus.ACTIVE),
) -> list[LocationResponse]:
    """Return all locations as a bare JSON array (GH #205).

    Unpaginated, capped by ``BARE_LIST_MAX_ROWS`` (1000). Sorted by
    ``sort_order ASC, name ASC, id ASC`` (spec §4.4). ``status``
    mirrors the paginated list endpoint (active default / archived / all).
    """
    try:
        return await service.list_all(
            db_session=session,
            status=status,
            order_by=[asc(Location.sort_order), asc(Location.name), asc(Location.id)],
        )
    except BareListLimitExceededError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.put("/reorder", response_model=list[LocationResponse])
async def reorder_locations(
    data: ReorderRequest,
    service: _ServiceDep,
    session: SessionDep,
) -> list[LocationResponse]:
    """Reorder locations by assigning sort_order from the provided ID list."""
    return await service.reorder(db_session=session, ids=data.ids)


@router.get("/{location_id}", response_model=LocationResponse)
async def get_location(
    location_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> LocationResponse:
    """Return a single location by ID."""
    location = await service.get(db_session=session, id=location_id)
    if not location:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.LOCATION_NOT_FOUND,
                message="Location not found",
            ).model_dump(),
        )
    return location


@router.post("", response_model=LocationResponse, status_code=201)
async def create_location(
    data: LocationCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> LocationResponse:
    """Create a new location."""
    return await service.create(db_session=session, data=data)


@router.put("/{location_id}", response_model=LocationResponse)
async def update_location(
    location_id: str,
    data: LocationUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> LocationResponse:
    """Full-update a location by ID (PUT, not PATCH)."""
    location = await service.update(db_session=session, id=location_id, data=data)
    if not location:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.LOCATION_NOT_FOUND,
                message="Location not found",
            ).model_dump(),
        )
    return location


@router.patch("/{location_id}", response_model=LocationResponse)
async def patch_location(
    location_id: str,
    data: LocationPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> LocationResponse:
    """Partial-update a location by ID (PATCH)."""
    location = await service.patch(db_session=session, id=location_id, data=data)
    if not location:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.LOCATION_NOT_FOUND,
                message="Location not found",
            ).model_dump(),
        )
    return location


@router.delete("/{location_id}", status_code=204)
async def delete_location(
    location_id: str,
    service: _ServiceDep,
    session: SessionDep,
    resolutions: dict[str, str] | None = Body(default=None, embed=True),
) -> None:
    """Unified DELETE — dry-run (no body) or execute (with body). Spec §2/§5/§6.

    * No body (dry-run): ``collect_dependencies`` → empty → hard delete (204);
      non-empty → 409 + dependency tree (no rows modified).
    * With body (execute): ``{"resolutions": {...}}`` per spec §6 (§2 L24,
      §6 L161 — the ONLY accepted body form; the api-client ``resolveDeleteX``
      sends exactly this; ``embed=True`` rejects a bare dict as a dry-run
      shape). A wrapped empty ``{"resolutions": {}}`` still executes (S2 —
      all-auto deps). ``service.resolve_delete`` runs the resolution
      transaction (Task 10) → 204; ``ResolutionError`` → 422; missing → 404.
    """
    if resolutions is not None:
        try:
            ok = await service.resolve_delete(
                db_session=session, id=location_id, resolutions=resolutions
            )
        except ResolutionError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        if not ok:
            raise HTTPException(
                status_code=404,
                detail=ErrorDetail(
                    code=ErrorCode.LOCATION_NOT_FOUND,
                    message="Location not found",
                ).model_dump(),
            )
        return

    deps = await collect_dependencies(session, Location, location_id)
    if deps:
        return JSONResponse(
            status_code=409,
            content={
                "detail": "has_dependencies",
                "dependencies": [d.model_dump() for d in deps],
            },
        )
    deleted = await service.delete(db_session=session, id=location_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.LOCATION_NOT_FOUND,
                message="Location not found",
            ).model_dump(),
        )


@router.post("/{location_id}/archive", response_model=LocationResponse)
async def archive_location(
    location_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> LocationResponse:
    """Archive a location — flip ``is_active=False`` (spec §2/§14).

    Returns HTTP **200 with the re-fetched body** (``archived: true`` in the
    response schema) so the frontend updates the row without a refetch (spec
    §12 S5). Idempotent. Location has NO cross-entity cascade — only Master
    does (spec §4.2).
    """
    ok = await service.archive(db_session=session, id=location_id)
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.LOCATION_NOT_FOUND,
                message="Location not found",
            ).model_dump(),
        )
    return await _refetch_or_404(service, session, location_id)


@router.post("/{location_id}/restore", response_model=LocationResponse)
async def restore_location(
    location_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> LocationResponse:
    """Restore an archived location — flip ``is_active=True`` (spec §2/§14).

    Returns HTTP **200 with the re-fetched body** (``archived: false``). 404 if
    not found. Idempotent. No cross-entity cascade.
    """
    ok = await service.restore(db_session=session, id=location_id)
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.LOCATION_NOT_FOUND,
                message="Location not found",
            ).model_dump(),
        )
    return await _refetch_or_404(service, session, location_id)


async def _refetch_or_404(
    service: LocationService, session: SessionDep, location_id: str
) -> LocationResponse:
    """Re-fetch the location after a successful archive/restore (Task 11)."""
    location = await service.get(db_session=session, id=location_id)
    if location is None:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.LOCATION_NOT_FOUND,
                message="Location not found",
            ).model_dump(),
        )
    return location
