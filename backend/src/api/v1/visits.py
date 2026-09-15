"""FastAPI router for visit CRUD + status endpoints."""

from datetime import datetime
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.permissions import require_permission, verify_fetch_metadata
from src.auth.scope import ScopeContext, get_scope
from src.db import SessionDep
from src.errors import ErrorCode, ErrorDetail
from src.schemas.common import PaginatedResponse
from src.schemas.pagination import PaginationParams
from src.schemas.visit import (
    VisitCreate,
    VisitPatch,
    VisitResponse,
    VisitStatusUpdate,
    VisitUpdate,
)
from src.services.visit import VisitService, get_visit_service

router = APIRouter(
    tags=["visits"],
    # GH #247 spec §3.7: wholly-private router — read guard at router level.
    dependencies=[Depends(require_permission("visits:read"))],
)


@lru_cache
def _get_visit_service() -> VisitService:
    """Dependency factory returning a singleton VisitService."""
    return get_visit_service()


_ServiceDep = Annotated[VisitService, Depends(_get_visit_service)]

# GH #247 (spec §3.7): every mutating route carries visits:write plus the
# CSRF fetch-metadata secondary line (verify_fetch_metadata).
_WRITE_GUARD = [
    Depends(require_permission("visits:write")),
    Depends(verify_fetch_metadata),
]


def _map_visit(visit) -> VisitResponse:
    """Map a Visit ORM object to VisitResponse."""

    def _dt_to_str(dt: datetime | None) -> str:
        if dt is None:
            return ""
        return dt.isoformat()

    return VisitResponse(
        id=visit.id,
        record_id=visit.record_id,
        visitor_id=visit.visitor_id,
        tariff_id=visit.tariff_id,
        price=visit.price,
        custom_price=visit.custom_price,
        status=visit.status,
        created_at=_dt_to_str(visit.created_at),
        updated_at=_dt_to_str(visit.updated_at),
    )


async def _visit_scoped_or_404(
    service: VisitService,
    session: AsyncSession,
    visit_id: str,
    scope: ScopeContext,
) -> None:
    """GH #263 T2 — shared point-op owner gate for visit mutations.

    ONE scope-aware query (visit → record → activity); a scoped master
    whose visit is foreign gets the same 404 as a missing visit
    (404-fast-path). Admin (``master_key=None``) passes untouched.
    """
    visit = await service.get_scoped(
        db_session=session, visit_id=visit_id, master_key=scope.master_key
    )
    if not visit:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.VISIT_NOT_FOUND,
                message="Visit not found",
            ).model_dump(),
        )


# ─── CRUD handlers ─────────────────────────────────────────────────────────


@router.get("", response_model=PaginatedResponse[VisitResponse])
async def list_visits(
    service: _ServiceDep,
    session: SessionDep,
    pagination: PaginationParams = Depends(),
    record_id: str | None = None,
    # GH #263 T2: scope via visit → record → activity («всё через записи»);
    # conjunctive with the record_id param. Admin → no filter.
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> PaginatedResponse[VisitResponse]:
    """List active visits, optionally filtered by record_id."""
    return await service.list(
        db_session=session, page=pagination.page, per_page=pagination.per_page,
        record_id=record_id, master_key=scope.master_key,
    )


@router.get("/{visit_id}", response_model=VisitResponse)
async def get_visit(
    visit_id: str,
    service: _ServiceDep,
    session: SessionDep,
    # GH #263 T2: чужой визит → 404 (single scope-aware query).
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> VisitResponse:
    """Return a single visit by ID."""
    visit = await service.get_scoped(
        db_session=session, visit_id=visit_id, master_key=scope.master_key
    )
    if not visit:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.VISIT_NOT_FOUND,
                message="Visit not found",
            ).model_dump(),
        )
    return _map_visit(visit)


@router.post("", response_model=VisitResponse, status_code=201,
             dependencies=_WRITE_GUARD)
async def create_visit(
    data: VisitCreate,
    service: _ServiceDep,
    session: SessionDep,
    # GH #263 T2: a master may add visits only to his own records — the
    # parent record's activity must be his (чужая → 404, same code as
    # «родитель не найден»).
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> VisitResponse:
    """Create a new visit, cascade status + seats to parent record."""
    if scope.master_key is not None:
        parent = await service.get_record_scoped(
            db_session=session, record_id=data.record_id, master_key=scope.master_key
        )
        if not parent:
            raise HTTPException(
                status_code=404,
                detail=ErrorDetail(
                    code=ErrorCode.RECORD_NOT_FOUND,
                    message="Parent record not found",
                ).model_dump(),
            )
    visit = await service.create(db_session=session, data=data)
    if not visit:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.RECORD_NOT_FOUND,
                message="Parent record not found",
            ).model_dump(),
        )
    return _map_visit(visit)


@router.put("/{visit_id}", response_model=VisitResponse, dependencies=_WRITE_GUARD)
async def update_visit(
    visit_id: str,
    data: VisitUpdate,
    service: _ServiceDep,
    session: SessionDep,
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> VisitResponse:
    """Full-replace update of a visit, cascade status to parent record."""
    await _visit_scoped_or_404(service, session, visit_id, scope)
    visit = await service.update(db_session=session, visit_id=visit_id, data=data)
    if not visit:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.VISIT_NOT_FOUND,
                message="Visit not found",
            ).model_dump(),
        )
    return _map_visit(visit)


@router.patch("/{visit_id}", response_model=VisitResponse, dependencies=_WRITE_GUARD)
async def patch_visit(
    visit_id: str,
    data: VisitPatch,
    service: _ServiceDep,
    session: SessionDep,
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> VisitResponse:
    """Partial update of a visit, cascade status to parent record."""
    await _visit_scoped_or_404(service, session, visit_id, scope)
    visit = await service.patch(db_session=session, visit_id=visit_id, data=data)
    if not visit:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.VISIT_NOT_FOUND,
                message="Visit not found",
            ).model_dump(),
        )
    return _map_visit(visit)


@router.delete("/{visit_id}", status_code=204, dependencies=_WRITE_GUARD)
async def delete_visit(
    visit_id: str,
    service: _ServiceDep,
    session: SessionDep,
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> None:
    """Hard-delete a visit, cascade status + seats to parent record."""
    await _visit_scoped_or_404(service, session, visit_id, scope)
    deleted = await service.delete(db_session=session, visit_id=visit_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.VISIT_NOT_FOUND,
                message="Visit not found",
            ).model_dump(),
        )


@router.put("/{visit_id}/status", response_model=VisitResponse, dependencies=_WRITE_GUARD)
async def update_visit_status(
    visit_id: str,
    data: VisitStatusUpdate,
    service: _ServiceDep,
    session: SessionDep,
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> VisitResponse:
    """Update a visit's status only."""
    await _visit_scoped_or_404(service, session, visit_id, scope)
    visit = await service.update_status(db_session=session, visit_id=visit_id, status=data.status)
    if not visit:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.VISIT_NOT_FOUND,
                message="Visit not found",
            ).model_dump(),
        )
    return _map_visit(visit)
