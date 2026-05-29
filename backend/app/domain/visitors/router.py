"""FastAPI router for visitor CRUD endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db_session
from app.domain.visitors.schemas import VisitorCreate, VisitorResponse, VisitorUpdate
from app.domain.visitors.service import VisitorService

router = APIRouter(tags=["visitors"])

_SessionDep = Annotated[AsyncSession, Depends(get_db_session)]


def _get_service(session: _SessionDep) -> VisitorService:
    """Dependency factory for VisitorService."""
    return VisitorService(session)


_ServiceDep = Annotated[VisitorService, Depends(_get_service)]


@router.get("/{visitor_id}", response_model=VisitorResponse)
async def get_visitor(visitor_id: str, service: _ServiceDep) -> VisitorResponse:
    """Return a single visitor by ID."""
    visitor = await service.get_by_id(visitor_id)
    if not visitor:
        raise HTTPException(status_code=404, detail="Visitor not found")
    return VisitorResponse.model_validate(visitor)


@router.post("", response_model=VisitorResponse, status_code=201)
async def create_visitor(
    data: VisitorCreate,
    service: _ServiceDep,
) -> VisitorResponse:
    """Create a new visitor."""
    visitor = await service.create(data)
    return VisitorResponse.model_validate(visitor)


@router.put("/{visitor_id}", response_model=VisitorResponse)
async def update_visitor(
    visitor_id: str,
    data: VisitorUpdate,
    service: _ServiceDep,
) -> VisitorResponse:
    """Full-update a visitor by ID (PUT, not PATCH)."""
    visitor = await service.update(visitor_id, data)
    if not visitor:
        raise HTTPException(status_code=404, detail="Visitor not found")
    return VisitorResponse.model_validate(visitor)


@router.delete("/{visitor_id}", status_code=204)
async def delete_visitor(visitor_id: str, service: _ServiceDep) -> None:
    """Soft-delete a visitor (set is_active=False)."""
    deleted = await service.delete(visitor_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Visitor not found")
