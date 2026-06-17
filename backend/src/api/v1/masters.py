"""FastAPI router for master CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import asc

from src.db import SessionDep
from src.models.master import Master
from src.schemas.master import MasterCreate, MasterResponse, MasterUpdate, ReorderRequest
from src.services.generic import GenericService
from src.services.master import get_master_service

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
    """Return all active masters sorted by sort_order, then name."""
    return await service.list(
        db_session=session,
        order_by=[asc(Master.sort_order), asc(Master.first_name)],
    )


@router.put("/reorder", response_model=list[MasterResponse])
async def reorder_masters(
    data: ReorderRequest,
    service: _ServiceDep,
    session: SessionDep,
) -> list[MasterResponse]:
    """Reorder masters by assigning sort_order from the provided ID list."""
    return await service.reorder(db_session=session, ids=data.ids)


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
    return master


@router.post("", response_model=MasterResponse, status_code=201)
async def create_master(
    data: MasterCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> MasterResponse:
    """Create a new master."""
    return await service.create(db_session=session, data=data)


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
    return master


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
