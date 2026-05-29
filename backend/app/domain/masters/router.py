"""FastAPI router for master CRUD endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db_session
from app.domain.masters.schemas import MasterCreate, MasterResponse, MasterUpdate
from app.domain.masters.service import MasterService

router = APIRouter(tags=["masters"])

_SessionDep = Annotated[AsyncSession, Depends(get_db_session)]


def _get_service(session: _SessionDep) -> MasterService:
    """Dependency factory for MasterService."""
    return MasterService(session)


_ServiceDep = Annotated[MasterService, Depends(_get_service)]


@router.get("", response_model=list[MasterResponse])
async def list_masters(service: _ServiceDep) -> list[MasterResponse]:
    """Return all active masters."""
    masters = await service.list_all()
    return [MasterResponse.model_validate(m) for m in masters]


@router.get("/{master_id}", response_model=MasterResponse)
async def get_master(master_id: str, service: _ServiceDep) -> MasterResponse:
    """Return a single master by ID."""
    master = await service.get_by_id(master_id)
    if not master:
        raise HTTPException(status_code=404, detail="Master not found")
    return MasterResponse.model_validate(master)


@router.post("", response_model=MasterResponse, status_code=201)
async def create_master(data: MasterCreate, service: _ServiceDep) -> MasterResponse:
    """Create a new master."""
    master = await service.create(data)
    return MasterResponse.model_validate(master)


@router.put("/{master_id}", response_model=MasterResponse)
async def update_master(
    master_id: str,
    data: MasterUpdate,
    service: _ServiceDep,
) -> MasterResponse:
    """Full-update a master by ID (PUT, not PATCH)."""
    master = await service.update(master_id, data)
    if not master:
        raise HTTPException(status_code=404, detail="Master not found")
    return MasterResponse.model_validate(master)


@router.delete("/{master_id}", status_code=204)
async def delete_master(master_id: str, service: _ServiceDep) -> None:
    """Soft-delete a master (set is_active=False)."""
    deleted = await service.delete(master_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Master not found")
