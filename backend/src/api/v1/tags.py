"""FastAPI router for tag CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import asc

from src.db import SessionDep
from src.domain.errors import BareListLimitExceededError
from src.errors import ErrorCode, ErrorDetail
from src.models.tag import Tag
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
    """Return all tags, paginated."""
    return await service.list(db_session=session, page=page, per_page=per_page)


@router.get("/all", response_model=list[TagResponse])
async def list_all_tags(
    service: _ServiceDep,
    session: SessionDep,
) -> list[TagResponse]:
    """Return all tags as a bare JSON array (GH #205).

    Unpaginated, capped by ``BARE_LIST_MAX_ROWS`` (1000). Sorted by
    ``tag ASC, id ASC`` (spec §4.4). Tags are non-archive (hard-delete
    only) — no ``status`` param.
    """
    try:
        return await service.list_all(
            db_session=session,
            order_by=[asc(Tag.tag), asc(Tag.id)],
        )
    except BareListLimitExceededError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


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
    """Delete a tag (hard delete)."""
    deleted = await service.delete(db_session=session, id=tag_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.TAG_NOT_FOUND,
                message="Tag not found",
            ).model_dump(),
        )
