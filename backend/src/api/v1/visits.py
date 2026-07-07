"""FastAPI router for visit CRUD + status endpoints."""

from datetime import datetime
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from src.db import SessionDep
from src.errors import ErrorCode, ErrorDetail
from src.schemas.visit import (
    VisitCreate,
    VisitPatch,
    VisitResponse,
    VisitStatusUpdate,
    VisitUpdate,
)
from src.services.visit import VisitService, get_visit_service

router = APIRouter(tags=["visits"])


@lru_cache
def _get_visit_service() -> VisitService:
    """Dependency factory returning a singleton VisitService."""
    return get_visit_service()


_ServiceDep = Annotated[VisitService, Depends(_get_visit_service)]


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


# ─── CRUD handlers ─────────────────────────────────────────────────────────


@router.get("", response_model=list[VisitResponse])
async def list_visits(
    service: _ServiceDep,
    session: SessionDep,
    record_id: str | None = None,
) -> list[VisitResponse]:
    """List active visits, optionally filtered by record_id."""
    visits = await service.list(db_session=session, record_id=record_id)
    return [_map_visit(v) for v in visits]


@router.get("/{visit_id}", response_model=VisitResponse)
async def get_visit(
    visit_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> VisitResponse:
    """Return a single visit by ID."""
    visit = await service.get(db_session=session, visit_id=visit_id)
    if not visit:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.VISIT_NOT_FOUND,
                message="Visit not found",
            ).model_dump(),
        )
    return _map_visit(visit)


@router.post("", response_model=VisitResponse, status_code=201)
async def create_visit(
    data: VisitCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> VisitResponse:
    """Create a new visit, cascade status + seats to parent record."""
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


@router.put("/{visit_id}", response_model=VisitResponse)
async def update_visit(
    visit_id: str,
    data: VisitUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> VisitResponse:
    """Full-replace update of a visit, cascade status to parent record."""
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


@router.patch("/{visit_id}", response_model=VisitResponse)
async def patch_visit(
    visit_id: str,
    data: VisitPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> VisitResponse:
    """Partial update of a visit, cascade status to parent record."""
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


@router.delete("/{visit_id}", status_code=204)
async def delete_visit(
    visit_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> None:
    """Hard-delete a visit, cascade status + seats to parent record."""
    deleted = await service.delete(db_session=session, visit_id=visit_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.VISIT_NOT_FOUND,
                message="Visit not found",
            ).model_dump(),
        )


@router.put("/{visit_id}/status", response_model=VisitResponse)
async def update_visit_status(
    visit_id: str,
    data: VisitStatusUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> VisitResponse:
    """Update a visit's status only."""
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
