"""FastAPI router for tag CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from src.db import SessionDep
from src.errors import ErrorCode, ErrorDetail
from src.schemas.tag import TagCreate, TagResponse
from src.services.generic import GenericService
from src.services.tag import get_tag_service

router = APIRouter(tags=["tags"])


@lru_cache
def _get_tag_service() -> GenericService[TagCreate, TagCreate, TagResponse]:
    """Dependency factory returning a singleton TagService."""
    return get_tag_service()


_ServiceDep = Annotated[GenericService[TagCreate, TagCreate, TagResponse], Depends(_get_tag_service)]


@router.get("", response_model=list[TagResponse])
async def list_tags(
    service: _ServiceDep,
    session: SessionDep,
) -> list[TagResponse]:
    """Return all active tags."""
    return await service.list(db_session=session)


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
