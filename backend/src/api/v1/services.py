"""FastAPI router for service CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from src.db import SessionDep
from src.schemas.service import ServiceCreate, ServiceResponse, ServiceUpdate
from src.services.service import ServiceService, get_service_service

router = APIRouter(tags=["services"])


@lru_cache
def _get_service_service() -> ServiceService:
    """Dependency factory returning a singleton ServiceService."""
    return get_service_service()


_ServiceDep = Annotated[ServiceService, Depends(_get_service_service)]


@router.get("", response_model=list[ServiceResponse])
async def list_services(
    service: _ServiceDep,
    session: SessionDep,
) -> list[ServiceResponse]:
    """Return all active services with tariffs and tags."""
    services = await service.list(db_session=session)
    return [ServiceResponse.model_validate(s) for s in services]


@router.get("/{service_id}", response_model=ServiceResponse)
async def get_service(
    service_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> ServiceResponse:
    """Return a single service by ID with tariffs and tags."""
    svc = await service.get(db_session=session, id=service_id)
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    return ServiceResponse.model_validate(svc)


@router.post("", response_model=ServiceResponse, status_code=201)
async def create_service(
    data: ServiceCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> ServiceResponse:
    """Create a new service with tariffs and tag links."""
    svc = await service.create(db_session=session, data=data)
    return ServiceResponse.model_validate(svc)


@router.put("/{service_id}", response_model=ServiceResponse)
async def update_service(
    service_id: str,
    data: ServiceUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> ServiceResponse:
    """Full-update a service by ID (PUT, not PATCH). Replaces tariffs and tag links."""
    svc = await service.update(db_session=session, id=service_id, data=data)
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    return ServiceResponse.model_validate(svc)


@router.delete("/{service_id}", status_code=204)
async def delete_service(
    service_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> None:
    """Soft-delete a service (set is_active=False)."""
    deleted = await service.delete(db_session=session, id=service_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Service not found")
