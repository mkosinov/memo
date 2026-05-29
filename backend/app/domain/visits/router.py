"""FastAPI router for visit read and status update endpoints."""

from datetime import datetime
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.db import SessionDep
from src.schemas.visit import VisitResponse, VisitStatusUpdate
from app.domain.visits.service import VisitService, get_visit_service

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
        price=visit.price,
        status=visit.status,
        created_at=_dt_to_str(visit.created_at),
        updated_at=_dt_to_str(visit.updated_at),
        is_active=visit.is_active,
    )


@router.get("/{visit_id}", response_model=VisitResponse)
async def get_visit(
    visit_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> VisitResponse:
    """Return a single visit by ID."""
    visit = await service.get(db_session=session, visit_id=visit_id)
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    return _map_visit(visit)


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
        raise HTTPException(status_code=404, detail="Visit not found")
    return _map_visit(visit)
