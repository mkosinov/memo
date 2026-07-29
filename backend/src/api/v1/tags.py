"""FastAPI router for tag CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from src.db import SessionDep
from src.errors import ErrorCode, ErrorDetail
from src.schemas.common import PaginatedResponse
from src.schemas.tag import TagCreate, TagPatch, TagResponse
from src.services.tag import TagService, get_tag_service

router = APIRouter(tags=["tags"])


@lru_cache
def _get_tag_service() -> TagService:
    """Dependency factory returning a singleton TagService."""
    return get_tag_service()


_ServiceDep = Annotated[TagService, Depends(_get_tag_service)]


@router.get("", response_model=PaginatedResponse[TagResponse])
async def list_tags(
    service: _ServiceDep,
    session: SessionDep,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
) -> PaginatedResponse[TagResponse]:
    """Return all active tags."""
    return await service.list(db_session=session, page=page, per_page=per_page)


@router.get("/{tag_id}", response_model=TagResponse)
async def get_tag(
    tag_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> TagResponse:
    """Return a single tag by ID."""
    tag = await service.get(db_session=session, id=tag_id)
    if not tag:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.TAG_NOT_FOUND,
                message="Tag not found",
            ).model_dump(),
        )
    return tag


@router.post("", response_model=TagResponse, status_code=201)
async def create_tag(
    data: TagCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> TagResponse:
    """Create a new tag."""
    return await service.create(db_session=session, data=data)


@router.put("/{tag_id}", response_model=TagResponse)
async def update_tag(
    tag_id: str,
    data: TagCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> TagResponse:
    """Full-update a tag by ID."""
    tag = await service.update(db_session=session, id=tag_id, data=data)
    if not tag:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.TAG_NOT_FOUND,
                message="Tag not found",
            ).model_dump(),
        )
    return tag


@router.patch("/{tag_id}", response_model=TagResponse)
async def patch_tag(
    tag_id: str,
    data: TagPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> TagResponse:
    """Partial-update a tag by ID (PATCH)."""
    tag = await service.patch(db_session=session, id=tag_id, data=data)
    if not tag:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.TAG_NOT_FOUND,
                message="Tag not found",
            ).model_dump(),
        )
    return tag


@router.delete("/{tag_id}", status_code=204)
async def delete_tag(
    tag_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> None:
    """Soft-delete a tag (set is_active=False)."""
    deleted = await service.delete(db_session=session, id=tag_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.TAG_NOT_FOUND,
                message="Tag not found",
            ).model_dump(),
        )
