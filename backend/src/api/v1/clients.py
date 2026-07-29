"""FastAPI router for client CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from src.db import SessionDep
from src.errors import ErrorCode, ErrorDetail
from src.schemas.client import (
    ClientCreate,
    ClientListParams,
    ClientListResponse,
    ClientPatch,
    ClientResponse,
    ClientUpdate,
)
from src.schemas.visitor import VisitorResponse
from src.services.client import ClientService, get_client_service, list_clients_with_stats
from src.services.visitor import get_visitor_service

router = APIRouter(tags=["clients"])


@lru_cache
def _get_client_service() -> ClientService:
    """Dependency factory returning a singleton ClientService."""
    return get_client_service()


@lru_cache
def _get_visitor_service():
    """Dependency factory returning a singleton VisitorService."""
    return get_visitor_service()


_ServiceDep = Annotated[ClientService, Depends(_get_client_service)]
_VisitorServiceDep = Annotated[any, Depends(_get_visitor_service)]


@router.get("/search", response_model=ClientResponse)
async def search_client_by_phone(
    service: _ServiceDep,
    session: SessionDep,
    phone: str = Query(..., min_length=3),
) -> ClientResponse:
    """Search for an active client by phone number."""
    result = await service.list(db_session=session, phone=phone)
    if not result.items:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.CLIENT_NOT_FOUND,
                message="Client not found",
            ).model_dump(),
        )
    return result.items[0]


@router.get("", response_model=ClientListResponse)
async def list_clients(
    session: SessionDep,
    params: ClientListParams = Depends(),
) -> ClientListResponse:
    """Return paginated clients with stats aggregation, filtering, and sorting."""
    return await list_clients_with_stats(db_session=session, params=params)


@router.get("/{client_id}", response_model=ClientResponse)
async def get_client(
    client_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> ClientResponse:
    """Return a single client by ID."""
    client = await service.get(db_session=session, id=client_id)
    if not client:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.CLIENT_NOT_FOUND,
                message="Client not found",
            ).model_dump(),
        )
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
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.CLIENT_NOT_FOUND,
                message="Client not found",
            ).model_dump(),
        )
    return client


@router.patch("/{client_id}", response_model=ClientResponse)
async def patch_client(
    client_id: str,
    data: ClientPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> ClientResponse:
    """Partial-update a client by ID (PATCH)."""
    client = await service.patch(db_session=session, id=client_id, data=data)
    if not client:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.CLIENT_NOT_FOUND,
                message="Client not found",
            ).model_dump(),
        )
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
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.CLIENT_NOT_FOUND,
                message="Client not found",
            ).model_dump(),
        )


@router.get("/{client_id}/visitors", response_model=list[VisitorResponse])
async def list_client_visitors(
    client_id: str,
    visitor_service: _VisitorServiceDep,
    session: SessionDep,
) -> list[VisitorResponse]:
    """Return all active visitors for a given client."""
    visitors = await visitor_service.list_by_client(db_session=session, client_id=client_id)
    return [VisitorResponse.model_validate(v) for v in visitors]
