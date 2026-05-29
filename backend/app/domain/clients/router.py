"""FastAPI router for client CRUD endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db_session
from app.domain.clients.schemas import ClientCreate, ClientResponse, ClientUpdate
from app.domain.clients.service import ClientService
from app.domain.visitors.schemas import VisitorResponse
from app.domain.visitors.service import VisitorService

router = APIRouter(tags=["clients"])

_SessionDep = Annotated[AsyncSession, Depends(get_db_session)]


def _get_service(session: _SessionDep) -> ClientService:
    """Dependency factory for ClientService."""
    return ClientService(session)


def _get_visitor_service(session: _SessionDep) -> VisitorService:
    """Dependency factory for VisitorService."""
    return VisitorService(session)


_ServiceDep = Annotated[ClientService, Depends(_get_service)]
_VisitorServiceDep = Annotated[VisitorService, Depends(_get_visitor_service)]


@router.get("", response_model=list[ClientResponse])
async def list_clients(service: _ServiceDep) -> list[ClientResponse]:
    """Return all active clients."""
    clients = await service.list_all()
    return [ClientResponse.model_validate(c) for c in clients]


@router.get("/{client_id}", response_model=ClientResponse)
async def get_client(client_id: str, service: _ServiceDep) -> ClientResponse:
    """Return a single client by ID."""
    client = await service.get_by_id(client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return ClientResponse.model_validate(client)


@router.post("", response_model=ClientResponse, status_code=201)
async def create_client(data: ClientCreate, service: _ServiceDep) -> ClientResponse:
    """Create a new client."""
    client = await service.create(data)
    return ClientResponse.model_validate(client)


@router.put("/{client_id}", response_model=ClientResponse)
async def update_client(
    client_id: str,
    data: ClientUpdate,
    service: _ServiceDep,
) -> ClientResponse:
    """Full-update a client by ID (PUT, not PATCH)."""
    client = await service.update(client_id, data)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return ClientResponse.model_validate(client)


@router.delete("/{client_id}", status_code=204)
async def delete_client(client_id: str, service: _ServiceDep) -> None:
    """Soft-delete a client (set is_active=False)."""
    deleted = await service.delete(client_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Client not found")


@router.get("/{client_id}/visitors", response_model=list[VisitorResponse])
async def list_client_visitors(
    client_id: str,
    visitor_service: _VisitorServiceDep,
) -> list[VisitorResponse]:
    """Return all active visitors for a given client."""
    visitors = await visitor_service.list_by_client(client_id)
    return [VisitorResponse.model_validate(v) for v in visitors]
