"""FastAPI router for service CRUD endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db_session
from app.domain.services.schemas import ServiceCreate, ServiceResponse, ServiceUpdate
from app.domain.services.service import ServiceService

router = APIRouter(tags=["services"])

_SessionDep = Annotated[AsyncSession, Depends(get_db_session)]


def _get_service(session: _SessionDep) -> ServiceService:
    """Dependency factory for ServiceService."""
    return ServiceService(session)


_ServiceDep = Annotated[ServiceService, Depends(_get_service)]


@router.get("", response_model=list[ServiceResponse])
async def list_services(service: _ServiceDep) -> list[ServiceResponse]:
    """Return all active services with tariffs and tags."""
    services = await service.list_all()
    return [ServiceResponse.model_validate(s) for s in services]


@router.get("/{service_id}", response_model=ServiceResponse)
async def get_service(service_id: str, service: _ServiceDep) -> ServiceResponse:
    """Return a single service by ID with tariffs and tags."""
    svc = await service.get_by_id(service_id)
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    return ServiceResponse.model_validate(svc)


@router.post("", response_model=ServiceResponse, status_code=201)
async def create_service(data: ServiceCreate, service: _ServiceDep) -> ServiceResponse:
    """Create a new service with tariffs and tag links."""
    svc = await service.create(data)
    return ServiceResponse.model_validate(svc)


@router.put("/{service_id}", response_model=ServiceResponse)
async def update_service(
    service_id: str,
    data: ServiceUpdate,
    service: _ServiceDep,
) -> ServiceResponse:
    """Full-update a service by ID (PUT, not PATCH). Replaces tariffs and tag links."""
    svc = await service.update(service_id, data)
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    return ServiceResponse.model_validate(svc)


@router.delete("/{service_id}", status_code=204)
async def delete_service(service_id: str, service: _ServiceDep) -> None:
    """Soft-delete a service (set is_active=False)."""
    deleted = await service.delete(service_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Service not found")
