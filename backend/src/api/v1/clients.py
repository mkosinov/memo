"""FastAPI router for client CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from src.db import SessionDep
from src.schemas.client import ClientCreate, ClientResponse, ClientUpdate
from src.schemas.visitor import VisitorResponse
from src.services.client import get_client_service
from src.services.generic import GenericService
from src.services.visitor import get_visitor_service

router = APIRouter(tags=["clients"])


@lru_cache
def _get_client_service() -> GenericService[ClientCreate, ClientUpdate, ClientResponse]:
    """Dependency factory returning a singleton ClientService."""
    return get_client_service()


@lru_cache
def _get_visitor_service():
    """Dependency factory returning a singleton VisitorService."""
    return get_visitor_service()


_ServiceDep = Annotated[GenericService[ClientCreate, ClientUpdate, ClientResponse], Depends(_get_client_service)]
_VisitorServiceDep = Annotated[any, Depends(_get_visitor_service)]


@router.get("", response_model=list[ClientResponse])
async def list_clients(
    service: _ServiceDep,
    session: SessionDep,
) -> list[ClientResponse]:
    """Return all active clients."""
    clients = await service.list(db_session=session)
    return clients


@router.get("/{client_id}", response_model=ClientResponse)
async def get_client(
    client_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> ClientResponse:
    """Return a single client by ID."""
    client = await service.get(db_session=session, id=client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


@router.post("", response_model=ClientResponse, status_code=201)
async def create_client(
    data: ClientCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> ClientResponse:
    """Create a new client."""
    return await service.create(db_session=session, data=data)


@router.put("/{client_id}", response_model=ClientResponse)
async def update_client(
    client_id: str,
    data: ClientUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> ClientResponse:
    """Full-update a client by ID (PUT, not PATCH)."""
    client = await service.update(db_session=session, id=client_id, data=data)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


@router.delete("/{client_id}", status_code=204)
async def delete_client(
    client_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> None:
    """Soft-delete a client (set is_active=False)."""
    deleted = await service.delete(db_session=session, id=client_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Client not found")


@router.get("/{client_id}/visitors", response_model=list[VisitorResponse])
async def list_client_visitors(
    client_id: str,
    visitor_service: _VisitorServiceDep,
    session: SessionDep,
) -> list[VisitorResponse]:
    """Return all active visitors for a given client."""
    visitors = await visitor_service.list_by_client(db_session=session, client_id=client_id)
    return [VisitorResponse.model_validate(v) for v in visitors]
