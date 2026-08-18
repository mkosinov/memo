"""FastAPI router for tag CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import asc

from src.db import SessionDep
from src.domain.errors import BareListLimitExceededError
from src.errors import ErrorCode, ErrorDetail
from src.models.tag import Tag
from src.schemas.common import PaginatedResponse, SortOrder
from src.schemas.tag import TagCreate, TagPatch, TagResponse, TagSortBy
from src.services.tag import TagService, get_tag_service

router = APIRouter(tags=["tags"])


@lru_cache
def _get_tag_service() -> TagService:
    """Dependency factory returning a singleton TagService."""
    return get_tag_service()


_ServiceDep = Annotated[TagService, Depends(_get_tag_service)]

# Sort whitelist map: UI key → list of ORM columns (#205 Task 3, spec §4.5).
# Tags have a single sortable column: ``tag``.
_TAG_SORT_MAP: dict[str, list] = {
    "tag": [Tag.tag],
}


def _tag_order_by(sort_by: TagSortBy | None, sort_order: SortOrder) -> list:
    """Build the ``order_by`` list for GET /api/v1/tags.

    * ``sort_by=None`` → spec §4.4 default: ``tag ASC, id ASC`` (NEW —
      tags had no order_by before #205).
    * User sort → mapped columns with nulls-first (asc) / nulls-last (desc),
      then ``id ASC`` tiebreak (records idiom).
    """
    if sort_by is None:
        return [asc(Tag.tag), asc(Tag.id)]
    cols = _TAG_SORT_MAP[sort_by]
    ordered = [
        c.desc().nullslast() if sort_order == "desc" else c.asc().nullsfirst()
        for c in cols
    ]
    return [*ordered, asc(Tag.id)]


@router.get("", response_model=PaginatedResponse[TagResponse])
async def list_tags(
    service: _ServiceDep,
    session: SessionDep,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    sort_by: TagSortBy | None = Query(None),
    sort_order: SortOrder = Query("asc"),
) -> PaginatedResponse[TagResponse]:
    """Return all tags, paginated.

    ``sort_by`` selects a whitelisted sort key (spec §4.5); ``sort_order``
    is ``asc`` (default) or ``desc``. Unknown ``sort_by`` → 422 via Literal
    validation. ``sort_by=None`` → spec §4.4 default order (``tag ASC,
    id ASC``). Tags are non-archive (no ``status`` param).
    """
    return await service.list(
        db_session=session,
        page=page,
        per_page=per_page,
        order_by=_tag_order_by(sort_by, sort_order),
    )


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
