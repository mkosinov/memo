"""FastAPI router for location CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from src.db import SessionDep
from src.schemas.location import LocationCreate, LocationResponse, LocationUpdate
from src.services.generic import GenericService
from src.services.location_service import get_location_service

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
    """Return all active locations."""
    return await service.list(db_session=session)


@router.get("/{location_id}", response_model=LocationResponse)
async def get_location(
    location_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> LocationResponse:
    """Return a single location by ID."""
    location = await service.get(db_session=session, id=location_id)
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
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
        raise HTTPException(status_code=404, detail="Location not found")
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
        raise HTTPException(status_code=404, detail="Location not found")
