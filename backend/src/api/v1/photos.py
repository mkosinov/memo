"""FastAPI router for photo CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select

from src.db import SessionDep
from src.models.photo import Photo
from src.schemas.photo import PhotoCreate, PhotoResponse, PhotoUpdate
from src.services.generic import GenericService
from src.services.photo import get_photo_service

router = APIRouter(tags=["photos"])


@lru_cache
def _get_photo_service() -> GenericService[PhotoCreate, PhotoUpdate, PhotoResponse]:
    return get_photo_service()


_ServiceDep = Annotated[GenericService[PhotoCreate, PhotoUpdate, PhotoResponse], Depends(_get_photo_service)]


@router.get("/web", response_model=list[PhotoResponse])
async def list_public_photos(
    session: SessionDep,
    activity_id: str | None = Query(None),
) -> list[PhotoResponse]:
    """Return public photos (is_public=true, is_active=true). Optionally filter by activity_id."""
    stmt = select(Photo).where(Photo.is_public == True, Photo.is_active == True)
    if activity_id:
        stmt = stmt.where(Photo.activity_id == activity_id)
    result = await session.execute(stmt)
    photos = result.scalars().all()
    return [PhotoResponse.model_validate(p) for p in photos]


@router.get("", response_model=list[PhotoResponse])
async def list_photos(
    service: _ServiceDep,
    session: SessionDep,
) -> list[PhotoResponse]:
    """Return all active photos (admin view)."""
    return await service.list(db_session=session)


@router.get("/{photo_id}", response_model=PhotoResponse)
async def get_photo(
    photo_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> PhotoResponse:
    """Return a single photo by ID."""
    photo = await service.get(db_session=session, id=photo_id)
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    return photo


@router.post("", response_model=PhotoResponse, status_code=201)
async def create_photo(
    data: PhotoCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> PhotoResponse:
    """Create a new photo."""
    return await service.create(db_session=session, data=data)


@router.put("/{photo_id}", response_model=PhotoResponse)
async def update_photo(
    photo_id: str,
    data: PhotoUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> PhotoResponse:
    """Full-update a photo by ID."""
    photo = await service.update(db_session=session, id=photo_id, data=data)
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    return photo


@router.delete("/{photo_id}", status_code=204)
async def delete_photo(
    photo_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> None:
    """Soft-delete a photo (set is_active=False)."""
    deleted = await service.delete(db_session=session, id=photo_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Photo not found")
