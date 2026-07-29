"""FastAPI router for visitor CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from src.db import SessionDep
from src.errors import ErrorCode, ErrorDetail
from src.schemas.common import PaginatedResponse
from src.schemas.visitor import VisitorCreate, VisitorPatch, VisitorResponse, VisitorUpdate
from src.services.visitor import get_visitor_service, VisitorService

router = APIRouter(tags=["visitors"])


@lru_cache
def _get_visitor_service() -> VisitorService:
    """Dependency factory returning a singleton VisitorService."""
    return get_visitor_service()


_ServiceDep = Annotated[VisitorService, Depends(_get_visitor_service)]


@router.get("", response_model=PaginatedResponse[VisitorResponse])
async def list_visitors(
    service: _ServiceDep,
    session: SessionDep,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
) -> PaginatedResponse[VisitorResponse]:
    """Return all active visitors, paginated."""
    return await service.list(db_session=session, page=page, per_page=per_page)


@router.get("/{visitor_id}", response_model=VisitorResponse)
async def get_visitor(
    visitor_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> VisitorResponse:
    """Return a single visitor by ID."""
    visitor = await service.get(db_session=session, id=visitor_id)
    if not visitor:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.VISITOR_NOT_FOUND,
                message="Visitor not found",
            ).model_dump(),
        )
    return visitor


@router.post("", response_model=VisitorResponse, status_code=201)
async def create_visitor(
    data: VisitorCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> VisitorResponse:
    """Create a new visitor."""
    return await service.create(db_session=session, data=data)


@router.put("/{visitor_id}", response_model=VisitorResponse)
async def update_visitor(
    visitor_id: str,
    data: VisitorUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> VisitorResponse:
    """Full-update a visitor by ID (PUT, not PATCH)."""
    visitor = await service.update(db_session=session, id=visitor_id, data=data)
    if not visitor:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.VISITOR_NOT_FOUND,
                message="Visitor not found",
            ).model_dump(),
        )
    return visitor


@router.patch("/{visitor_id}", response_model=VisitorResponse)
async def patch_visitor(
    visitor_id: str,
    data: VisitorPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> VisitorResponse:
    """Partial-update a visitor by ID (PATCH)."""
    visitor = await service.patch(db_session=session, id=visitor_id, data=data)
    if not visitor:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.VISITOR_NOT_FOUND,
                message="Visitor not found",
            ).model_dump(),
        )
    return visitor


@router.delete("/{visitor_id}", status_code=204)
async def delete_visitor(
    visitor_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> None:
    """Soft-delete a visitor (set is_active=False)."""
    deleted = await service.delete(db_session=session, id=visitor_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.VISITOR_NOT_FOUND,
                message="Visitor not found",
            ).model_dump(),
        )
