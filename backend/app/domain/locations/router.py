"""FastAPI router for location CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.db.database import SessionDep
from app.domain.locations.schemas import LocationCreate, LocationResponse, LocationUpdate
from app.domain.locations.service import LocationService, get_location_service

router = APIRouter(tags=["locations"])


@lru_cache
def _get_location_service() -> LocationService:
    """Dependency factory returning a singleton LocationService."""
    return get_location_service()


_ServiceDep = Annotated[LocationService, Depends(_get_location_service)]


@router.get("", response_model=list[LocationResponse])
async def list_locations(
    service: _ServiceDep,
    session: SessionDep,
) -> list[LocationResponse]:
    """Return all active locations."""
    locations = await service.list_all(db_session=session)
    return [LocationResponse.model_validate(loc) for loc in locations]


@router.get("/{location_id}", response_model=LocationResponse)
async def get_location(
    location_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> LocationResponse:
    """Return a single location by ID."""
    location = await service.get_by_id(db_session=session, location_id=location_id)
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    return LocationResponse.model_validate(location)


@router.post("", response_model=LocationResponse, status_code=201)
async def create_location(
    data: LocationCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> LocationResponse:
    """Create a new location."""
    location = await service.create(db_session=session, data=data)
    return LocationResponse.model_validate(location)


@router.put("/{location_id}", response_model=LocationResponse)
async def update_location(
    location_id: str,
    data: LocationUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> LocationResponse:
    """Full-update a location by ID (PUT, not PATCH)."""
    location = await service.update(db_session=session, location_id=location_id, data=data)
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    return LocationResponse.model_validate(location)


@router.delete("/{location_id}", status_code=204)
async def delete_location(
    location_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> None:
    """Soft-delete a location (set is_active=False)."""
    deleted = await service.delete(db_session=session, location_id=location_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Location not found")
