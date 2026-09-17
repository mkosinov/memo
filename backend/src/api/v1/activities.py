"""FastAPI router for activity CRUD endpoints with date filtering."""

from datetime import date
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.permissions import require_permission, verify_fetch_metadata
from src.auth.scope import ScopeContext, get_optional_scope
from src.db import SessionDep
from src.errors import ErrorCode, ErrorDetail
from src.schemas.activity import (
    ActivityCopyWeekRequest,
    ActivityCreate,
    ActivityPatch,
    ActivityResponse,
    ActivityUpdate,
    CopyWeekResult,
)
from src.schemas.common import PaginatedResponse
from src.schemas.pagination import PaginationParams
from src.services.activity import ActivityService, get_activity_service

router = APIRouter(tags=["activities"])


@lru_cache
def _get_activity_service() -> ActivityService:
    """Dependency factory returning a singleton ActivityService."""
    return get_activity_service()


_ServiceDep = Annotated[ActivityService, Depends(_get_activity_service)]

# GH #247 (spec §3.7): every mutating route carries activities:write plus the
# CSRF fetch-metadata secondary line (verify_fetch_metadata).
_WRITE_GUARD = [
    Depends(require_permission("activities:write")),
    Depends(verify_fetch_metadata),
]


async def _to_response(
    service: ActivityService,
    db_session: AsyncSession,
    activity,
) -> ActivityResponse:
    """Single-activity response (computes occupied via one SUM)."""
    occupied = await service.sum_active_seats(db_session=db_session, activity_id=activity.id)
    return _map_response(activity, occupied)


def _map_response(activity: ActivityResponse, occupied: int) -> ActivityResponse:
    """Set occupied on a validated ActivityResponse."""
    activity.occupied = occupied
    return activity


@router.get("", response_model=PaginatedResponse[ActivityResponse])
async def list_activities(
    service: _ServiceDep,
    session: SessionDep,
    pagination: PaginationParams = Depends(),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    q: str | None = Query(None, min_length=2, max_length=100),
    service_id: str | None = Query(None),
    # GH #263 T2 (D1): the route stays PUBLIC, but a logged-in master
    # sees only his own activities — master_key (or the empty-scope
    # sentinel) becomes the ``master_id`` equality kwarg; anonymous /
    # admin → master_key=None → no filter (unchanged behaviour).
    scope: ScopeContext = Depends(get_optional_scope),  # noqa: B008
) -> PaginatedResponse[ActivityResponse]:
    """Return all activities, optionally filtered by date range and service.

    ``q`` (GH #212): case-insensitive substring on the joined Service.title OR
    exact id equality for a full UUID; ``service_id`` narrows by service;
    ``total`` reflects the filtered count. len<2 / len>100 → 422
    VALIDATION_ERROR. List items carry ``service_title`` (single-item
    endpoints leave it None). Master role (GH #263): server-side scope —
    only ``master_id == master_key`` rows; empty scope → empty result.
    """
    result = await service.list(
        db_session=session, page=pagination.page, per_page=pagination.per_page,
        date_from=date_from, date_to=date_to, q=q, service_id=service_id,
        master_id=scope.master_key,
    )
    occupied_map = await service.sum_active_seats_bulk(
        db_session=session, activity_ids=[a.id for a in result.items]
    )
    return PaginatedResponse(
        items=[_map_response(a, occupied=occupied_map.get(a.id, 0)) for a in result.items],
        total=result.total,
        page=result.page,
        per_page=result.per_page,
    )


@router.get("/{activity_id}", response_model=ActivityResponse)
async def get_activity(
    activity_id: str,
    service: _ServiceDep,
    session: SessionDep,
    # GH #263 T2: public route + master narrowing (see list_activities).
    scope: ScopeContext = Depends(get_optional_scope),  # noqa: B008
) -> ActivityResponse:
    """Return a single activity by ID with computed occupied count.

    Scoped master + чужая активность → 404 (indistinguishable from
    «не существует»); single scope-aware query (404-fast-path, T7).
    """
    activity = await service.get_scoped(
        db_session=session, id=activity_id, master_key=scope.master_key
    )
    if not activity:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.ACTIVITY_NOT_FOUND,
                message="Activity not found",
            ).model_dump(),
        )
    return await _to_response(service, db_session=session, activity=activity)


@router.post("", response_model=ActivityResponse, status_code=201,
             dependencies=_WRITE_GUARD)
async def create_activity(
    data: ActivityCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> ActivityResponse:
    """Create a new activity."""
    activity = await service.create(db_session=session, data=data)
    return await _to_response(service, db_session=session, activity=activity)


# GH #242 (spec §4): no conflict with the /{activity_id} routes — there are no
# other POST-parameterized paths in this file.
@router.post("/copy-week", response_model=CopyWeekResult, dependencies=_WRITE_GUARD)
async def copy_week(
    data: ActivityCopyWeekRequest,
    service: _ServiceDep,
    session: SessionDep,
) -> CopyWeekResult:
    """Copy the previous week's activities into the target week (GH #242).

    ``week_start`` is the Monday of the TARGET week; ``locations`` is the
    explicit list of location ids checked in the popup. Validation errors
    (non-Monday / unknown location / volume cap) raise 422 with the
    COPY_WEEK_* codes; an empty source copies nothing (200 with zeros).
    """
    return await service.copy_week(
        db_session=session,
        week_start=data.week_start,
        locations=data.locations,
    )


@router.put("/{activity_id}", response_model=ActivityResponse, dependencies=_WRITE_GUARD)
async def update_activity(
    activity_id: str,
    data: ActivityUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> ActivityResponse:
    """Full-update an activity by ID (PUT, not PATCH)."""
    activity = await service.update(db_session=session, id=activity_id, data=data)
    if not activity:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.ACTIVITY_NOT_FOUND,
                message="Activity not found",
            ).model_dump(),
        )
    return await _to_response(service, db_session=session, activity=activity)


@router.patch("/{activity_id}", response_model=ActivityResponse, dependencies=_WRITE_GUARD)
async def partial_update_activity(
    activity_id: str,
    patch: ActivityPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> ActivityResponse:
    """Partially update an activity — only fields sent in the body are updated."""
    activity = await service.patch(db_session=session, id=activity_id, data=patch)
    if not activity:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.ACTIVITY_NOT_FOUND,
                message="Activity not found",
            ).model_dump(),
        )
    return await _to_response(service, db_session=session, activity=activity)


@router.delete("/{activity_id}", status_code=204, dependencies=_WRITE_GUARD)
async def delete_activity(
    activity_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> None:
    """Delete an activity (hard delete)."""
    deleted = await service.delete(db_session=session, id=activity_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.ACTIVITY_NOT_FOUND,
                message="Activity not found",
            ).model_dump(),
        )
