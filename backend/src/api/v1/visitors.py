"""FastAPI router for visitor CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from src.auth.permissions import require_permission, verify_fetch_metadata
from src.db import SessionDep
from src.errors import ErrorCode, ErrorDetail
from src.schemas.common import PaginatedResponse
from src.schemas.pagination import PaginationParams
from src.schemas.visitor import VisitorCreate, VisitorPatch, VisitorResponse, VisitorUpdate
from src.services.visitor import get_visitor_service, VisitorService

router = APIRouter(
    tags=["visitors"],
    # GH #247 spec §3.7: wholly-private router — read guard at router level.
    dependencies=[Depends(require_permission("visitors:read"))],
)


@lru_cache
def _get_visitor_service() -> VisitorService:
    """Dependency factory returning a singleton VisitorService."""
    return get_visitor_service()


_ServiceDep = Annotated[VisitorService, Depends(_get_visitor_service)]

# GH #247 (spec §3.7): every mutating route carries visitors:write plus the
# CSRF fetch-metadata secondary line (verify_fetch_metadata).
_WRITE_GUARD = [
    Depends(require_permission("visitors:write")),
    Depends(verify_fetch_metadata),
]


@router.get("", response_model=PaginatedResponse[VisitorResponse])
async def list_visitors(
    service: _ServiceDep,
    session: SessionDep,
    pagination: PaginationParams = Depends(),
    q: str | None = Query(None, min_length=2, max_length=100),
) -> PaginatedResponse[VisitorResponse]:
    """Return all visitors, paginated.

    ``q`` (GH #212): case-insensitive substring on ``name`` OR exact id
    equality for a full UUID; ``total`` reflects the filtered count.
    len<2 / len>100 → 422 VALIDATION_ERROR.
    """
    return await service.list(
        db_session=session,
        page=pagination.page,
        per_page=pagination.per_page,
        q=q,
    )


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


@router.post("", response_model=VisitorResponse, status_code=201,
             dependencies=_WRITE_GUARD)
async def create_visitor(
    data: VisitorCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> VisitorResponse:
    """Create a new visitor."""
    return await service.create(db_session=session, data=data)


@router.put("/{visitor_id}", response_model=VisitorResponse, dependencies=_WRITE_GUARD)
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


@router.patch("/{visitor_id}", response_model=VisitorResponse, dependencies=_WRITE_GUARD)
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


@router.delete("/{visitor_id}", status_code=204, dependencies=_WRITE_GUARD)
async def delete_visitor(
    visitor_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> None:
    """Delete a visitor (hard delete)."""
    deleted = await service.delete(db_session=session, id=visitor_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.VISITOR_NOT_FOUND,
                message="Visitor not found",
            ).model_dump(),
        )
