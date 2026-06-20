"""FastAPI router for location CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import asc

from src.db import SessionDep
from src.errors import ErrorCode, ErrorDetail
from src.models.location import Location
from src.schemas.location import LocationCreate, LocationResponse, LocationUpdate, ReorderRequest
from src.services.generic import GenericService
from src.services.location import get_location_service

router = APIRouter(tags=["locations"])


@lru_cache
def _get_location_service() -> GenericService[LocationCreate, LocationUpdate, LocationResponse]:
    """Dependency factory returning a singleton LocationService."""
    return get_location_service()


_ServiceDep = Annotated[GenericService[LocationCreate, LocationUpdate, LocationResponse], Depends(_get_location_service)]


@router.get("", response_model=list[LocationResponse])
async def list_locations(
    service: _ServiceDep,
    session: SessionDep,
) -> list[LocationResponse]:
    """Return all active locations sorted by sort_order, then name."""
    return await service.list(
        db_session=session,
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


@router.delete("/{location_id}", status_code=204)
async def delete_location(
    location_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> None:
    """Soft-delete a location (set is_active=False)."""
    deleted = await service.delete(db_session=session, id=location_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.LOCATION_NOT_FOUND,
                message="Location not found",
            ).model_dump(),
        )
