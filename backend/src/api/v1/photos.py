"""FastAPI router for photo CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.auth.permissions import require_permission, verify_fetch_metadata
from src.db import SessionDep
from src.errors import ErrorCode, ErrorDetail
from src.models.photo import Photo
from src.schemas.common import PaginatedResponse
from src.schemas.photo import (
    PhotoCreate,
    PhotoListParams,
    PhotoPatch,
    PhotoResponse,
    PhotoUpdate,
)
from src.services.photo import PhotoService, get_photo_service

router = APIRouter(tags=["photos"])


@lru_cache
def _get_photo_service() -> PhotoService:
    return get_photo_service()


_ServiceDep = Annotated[PhotoService, Depends(_get_photo_service)]

# GH #247 (spec §3.7): every mutating route carries photos:write plus the
# CSRF fetch-metadata secondary line (verify_fetch_metadata).
_WRITE_GUARD = [
    Depends(require_permission("photos:write")),
    Depends(verify_fetch_metadata),
]


@router.get("/web", response_model=list[PhotoResponse])
async def list_public_photos(
    session: SessionDep,
    activity_id: str | None = Query(None),
) -> list[PhotoResponse]:
    """Return public photos (is_public=true). Optionally filter by activity_id."""
    stmt = (
        select(Photo)
        .where(Photo.is_public == True)
        .options(selectinload(Photo.tags))
    )
    if activity_id:
        stmt = stmt.where(Photo.activity_id == activity_id)
    result = await session.execute(stmt)
    photos = result.scalars().all()
    return [PhotoResponse.model_validate(p) for p in photos]


@router.get("", response_model=PaginatedResponse[PhotoResponse])
async def list_photos(
    service: _ServiceDep,
    session: SessionDep,
    params: Annotated[PhotoListParams, Query()],
) -> PaginatedResponse[PhotoResponse]:
    """Return a paginated page of photos (admin view, GH #211).

    ``params`` (page/per_page/q/filters/sort) is validated at the router
    level; filtering/sorting/pagination and the denormalized
    ``client_name`` live in ``PhotoService.list`` (accepted exception to
    repo-owned list, GH #206 — spec #211 §6.5).
    """
    items, total = await service.list(db_session=session, params=params)
    return PaginatedResponse(
        items=items, total=total, page=params.page, per_page=params.per_page
    )


@router.get("/{photo_id}", response_model=PhotoResponse)
async def get_photo(
    photo_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> PhotoResponse:
    """Return a single photo by ID."""
    photo = await service.get(db_session=session, id=photo_id)
    if not photo:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.PHOTO_NOT_FOUND,
                message="Photo not found",
            ).model_dump(),
        )
    return photo


@router.post("", response_model=PhotoResponse, status_code=201,
             dependencies=_WRITE_GUARD)
async def create_photo(
    data: PhotoCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> PhotoResponse:
    """Create a new photo."""
    return await service.create(db_session=session, data=data)


@router.put("/{photo_id}", response_model=PhotoResponse, dependencies=_WRITE_GUARD)
async def update_photo(
    photo_id: str,
    data: PhotoUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> PhotoResponse:
    """Full-update a photo by ID."""
    photo = await service.update(db_session=session, id=photo_id, data=data)
    if not photo:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.PHOTO_NOT_FOUND,
                message="Photo not found",
            ).model_dump(),
        )
    return photo


@router.patch("/{photo_id}", response_model=PhotoResponse, dependencies=_WRITE_GUARD)
async def patch_photo(
    photo_id: str,
    data: PhotoPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> PhotoResponse:
    """Partial-update a photo by ID (PATCH)."""
    photo = await service.patch(db_session=session, id=photo_id, data=data)
    if not photo:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.PHOTO_NOT_FOUND,
                message="Photo not found",
            ).model_dump(),
        )
    return photo


@router.delete("/{photo_id}", status_code=204, dependencies=_WRITE_GUARD)
async def delete_photo(
    photo_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> None:
    """Delete a photo (hard delete)."""
    deleted = await service.delete(db_session=session, id=photo_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.PHOTO_NOT_FOUND,
                message="Photo not found",
            ).model_dump(),
        )
