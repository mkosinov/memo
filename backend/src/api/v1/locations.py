"""FastAPI router for location CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import asc

from src.db import SessionDep
from src.domain.deletion import ResolutionError, collect_dependencies
from src.errors import ErrorCode, ErrorDetail
from src.models.enums import ArchiveStatus
from src.models.location import Location
from src.schemas.common import PaginatedResponse
from src.schemas.location import (
    LocationCreate,
    LocationPatch,
    LocationResponse,
    LocationUpdate,
    ReorderRequest,
)
from src.services.location import LocationService, get_location_service

router = APIRouter(tags=["locations"])


@lru_cache
def _get_location_service() -> LocationService:
    """Dependency factory returning a singleton LocationService."""
    return get_location_service()


_ServiceDep = Annotated[LocationService, Depends(_get_location_service)]


@router.get("", response_model=PaginatedResponse[LocationResponse])
async def list_locations(
    service: _ServiceDep,
    session: SessionDep,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status: ArchiveStatus = Query(ArchiveStatus.ACTIVE),
) -> PaginatedResponse[LocationResponse]:
    """Return locations filtered by archive status (default: active),
    sorted by sort_order, then name.

    ``status`` accepts ``active`` (default), ``archived``, or ``all`` — see
    ``ArchiveStatus``. Invalid values are rejected with 422 by FastAPI's
    enum validation.
    """
    return await service.list(
        db_session=session,
        page=page,
        per_page=per_page,
        status=status,
        order_by=[asc(Location.sort_order), asc(Location.name)],
    )


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
    resolutions: dict[str, str] | None = Body(default=None),
) -> None:
    """Unified DELETE — dry-run (no body) or execute (with body). Spec §2/§5/§6.

    * No body (dry-run): ``collect_dependencies`` → empty → hard delete (204);
      non-empty → 409 + dependency tree (no rows modified).
    * With body (execute): ``service.resolve_delete`` runs the resolution
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
