"""FastAPI router for location CRUD endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db_session
from app.domain.locations.schemas import LocationCreate, LocationResponse, LocationUpdate
from app.domain.locations.service import LocationService

router = APIRouter(tags=["locations"])

_SessionDep = Annotated[AsyncSession, Depends(get_db_session)]


def _get_service(session: _SessionDep) -> LocationService:
    """Dependency factory for LocationService."""
    return LocationService(session)


_ServiceDep = Annotated[LocationService, Depends(_get_service)]


@router.get("", response_model=list[LocationResponse])
async def list_locations(service: _ServiceDep) -> list[LocationResponse]:
    """Return all active locations."""
    locations = await service.list_all()
    return [LocationResponse.model_validate(loc) for loc in locations]


@router.get("/{location_id}", response_model=LocationResponse)
async def get_location(location_id: str, service: _ServiceDep) -> LocationResponse:
    """Return a single location by ID."""
    location = await service.get_by_id(location_id)
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    return LocationResponse.model_validate(location)


@router.post("", response_model=LocationResponse, status_code=201)
async def create_location(data: LocationCreate, service: _ServiceDep) -> LocationResponse:
    """Create a new location."""
    location = await service.create(data)
    return LocationResponse.model_validate(location)


@router.put("/{location_id}", response_model=LocationResponse)
async def update_location(
    location_id: str,
    data: LocationUpdate,
    service: _ServiceDep,
) -> LocationResponse:
    """Full-update a location by ID (PUT, not PATCH)."""
    location = await service.update(location_id, data)
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    return LocationResponse.model_validate(location)


@router.delete("/{location_id}", status_code=204)
async def delete_location(location_id: str, service: _ServiceDep) -> None:
    """Soft-delete a location (set is_active=False)."""
    deleted = await service.delete(location_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Location not found")
