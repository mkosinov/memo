"""FastAPI router for master CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.db import SessionDep
from src.schemas.master import MasterCreate, MasterResponse, MasterUpdate
from app.domain.masters.service import get_master_service
from src.services.generic import GenericService
from app.db.models.master import Master

router = APIRouter(tags=["masters"])


@lru_cache
def _get_master_service() -> GenericService[MasterCreate, MasterUpdate, MasterResponse]:
    """Dependency factory returning a singleton MasterService."""
    return get_master_service()


_ServiceDep = Annotated[GenericService[MasterCreate, MasterUpdate, MasterResponse], Depends(_get_master_service)]


@router.get("", response_model=list[MasterResponse])
async def list_masters(
    service: _ServiceDep,
    session: SessionDep,
) -> list[MasterResponse]:
    """Return all active masters."""
    masters = await service.list(db_session=session)
    return [MasterResponse.model_validate(m) for m in masters]


@router.get("/{master_id}", response_model=MasterResponse)
async def get_master(
    master_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> MasterResponse:
    """Return a single master by ID."""
    master = await service.get(db_session=session, id=master_id)
    if not master:
        raise HTTPException(status_code=404, detail="Master not found")
    return MasterResponse.model_validate(master)


@router.post("", response_model=MasterResponse, status_code=201)
async def create_master(
    data: MasterCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> MasterResponse:
    """Create a new master."""
    master = await service.create(db_session=session, data=data)
    return MasterResponse.model_validate(master)


@router.put("/{master_id}", response_model=MasterResponse)
async def update_master(
    master_id: str,
    data: MasterUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> MasterResponse:
    """Full-update a master by ID (PUT, not PATCH)."""
    master = await service.update(db_session=session, id=master_id, data=data)
    if not master:
        raise HTTPException(status_code=404, detail="Master not found")
    return MasterResponse.model_validate(master)


@router.delete("/{master_id}", status_code=204)
async def delete_master(
    master_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> None:
    """Soft-delete a master (set is_active=False)."""
    deleted = await service.delete(db_session=session, id=master_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Master not found")
