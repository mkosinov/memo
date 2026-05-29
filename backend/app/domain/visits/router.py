"""FastAPI router for visit read and status update endpoints."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db_session
from app.domain.visits.schemas import VisitResponse, VisitStatusUpdate
from app.domain.visits.service import VisitService

router = APIRouter(tags=["visits"])

_SessionDep = Annotated[AsyncSession, Depends(get_db_session)]


def _get_service(session: _SessionDep) -> VisitService:
    """Dependency factory for VisitService."""
    return VisitService(session)


_ServiceDep = Annotated[VisitService, Depends(_get_service)]


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
async def get_visit(visit_id: str, service: _ServiceDep) -> VisitResponse:
    """Return a single visit by ID."""
    visit = await service.get_by_id(visit_id)
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    return _map_visit(visit)


@router.put("/{visit_id}/status", response_model=VisitResponse)
async def update_visit_status(
    visit_id: str,
    data: VisitStatusUpdate,
    service: _ServiceDep,
) -> VisitResponse:
    """Update a visit's status only."""
    visit = await service.update_status(visit_id, data.status)
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    return _map_visit(visit)
