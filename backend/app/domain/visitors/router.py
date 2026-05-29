"""FastAPI router for visitor CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.db.database import SessionDep
from app.domain.visitors.schemas import VisitorCreate, VisitorResponse, VisitorUpdate
from app.domain.visitors.service import get_visitor_service
from app.domain.visitors.service import VisitorService

router = APIRouter(tags=["visitors"])


@lru_cache
def _get_visitor_service() -> VisitorService:
    """Dependency factory returning a singleton VisitorService."""
    return get_visitor_service()


_ServiceDep = Annotated[VisitorService, Depends(_get_visitor_service)]


@router.get("/{visitor_id}", response_model=VisitorResponse)
async def get_visitor(
    visitor_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> VisitorResponse:
    """Return a single visitor by ID."""
    visitor = await service.get(db_session=session, id=visitor_id)
    if not visitor:
        raise HTTPException(status_code=404, detail="Visitor not found")
    return VisitorResponse.model_validate(visitor)


@router.post("", response_model=VisitorResponse, status_code=201)
async def create_visitor(
    data: VisitorCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> VisitorResponse:
    """Create a new visitor."""
    visitor = await service.create(db_session=session, data=data)
    return VisitorResponse.model_validate(visitor)


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
        raise HTTPException(status_code=404, detail="Visitor not found")
    return VisitorResponse.model_validate(visitor)


@router.delete("/{visitor_id}", status_code=204)
async def delete_visitor(
    visitor_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> None:
    """Soft-delete a visitor (set is_active=False)."""
    deleted = await service.delete(db_session=session, id=visitor_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Visitor not found")
