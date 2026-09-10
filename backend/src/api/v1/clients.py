"""FastAPI router for client CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

from src.auth.permissions import require_permission, verify_fetch_metadata
from src.db import SessionDep
from src.domain.deletion import ResolutionError, collect_dependencies
from src.errors import ErrorCode, ErrorDetail
from src.models.client import Client
from src.schemas.client import (
    ClientCreate,
    ClientListParams,
    ClientPatch,
    ClientResponse,
    ClientUpdate,
    ClientWithStats,
)
from src.schemas.common import PaginatedResponse
from src.schemas.visitor import VisitorResponse
from src.services.client import ClientService, get_client_service, list_clients_with_stats
from src.services.visitor import get_visitor_service

router = APIRouter(
    tags=["clients"],
    # GH #247 spec §3.7: wholly-private router — read guard at router level.
    dependencies=[Depends(require_permission("clients:read"))],
)


@lru_cache
def _get_client_service() -> ClientService:
    """Dependency factory returning a singleton ClientService."""
    return get_client_service()


@lru_cache
def _get_visitor_service():
    """Dependency factory returning a singleton VisitorService."""
    return get_visitor_service()


_ServiceDep = Annotated[ClientService, Depends(_get_client_service)]

# GH #247 (spec §3.7): every mutating route carries clients:write plus the
# CSRF fetch-metadata secondary line (verify_fetch_metadata).
_WRITE_GUARD = [
    Depends(require_permission("clients:write")),
    Depends(verify_fetch_metadata),
]
_VisitorServiceDep = Annotated[any, Depends(_get_visitor_service)]


@router.get("/get", response_model=ClientResponse)
async def get_client_by_phone(
    service: _ServiceDep,
    session: SessionDep,
    phone: str = Query(..., min_length=3),
) -> ClientResponse:
    """Get an active client by exact phone (GH #212; was /clients/search)."""
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


@router.get("", response_model=PaginatedResponse[ClientWithStats])
async def list_clients(
    session: SessionDep,
    params: ClientListParams = Depends(),
) -> PaginatedResponse[ClientWithStats]:
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


@router.post("", response_model=ClientResponse, status_code=201,
             dependencies=_WRITE_GUARD)
async def create_client(
    data: ClientCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> ClientResponse:
    """Create a new client."""
    return await service.create(db_session=session, data=data)


@router.put("/{client_id}", response_model=ClientResponse, dependencies=_WRITE_GUARD)
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


@router.patch("/{client_id}", response_model=ClientResponse, dependencies=_WRITE_GUARD)
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


@router.delete("/{client_id}", status_code=204, dependencies=_WRITE_GUARD)
async def delete_client(
    client_id: str,
    service: _ServiceDep,
    session: SessionDep,
    resolutions: dict[str, str] | None = Body(default=None, embed=True),
) -> None:
    """Unified DELETE — dry-run (no body) or execute (with body). Spec §2/§5/§6.

    * No body (dry-run): ``collect_dependencies`` → empty → hard delete (204);
      non-empty → 409 + dependency tree (no rows modified).
    * With body (execute): ``{"resolutions": {...}}`` per spec §6 (§2 L24,
      §6 L161 — the ONLY accepted body form; the api-client ``resolveDeleteX``
      sends exactly this; ``embed=True`` rejects a bare dict as a dry-run
      shape). A wrapped empty ``{"resolutions": {}}`` still executes (S2 —
      all-auto deps). ``service.resolve_delete`` runs the resolution
      transaction (Task 10) → 204; ``ResolutionError`` → 422; missing → 404.
    """
    if resolutions is not None:
        try:
            ok = await service.resolve_delete(
                db_session=session, id=client_id, resolutions=resolutions
            )
        except ResolutionError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        if not ok:
            raise HTTPException(
                status_code=404,
                detail=ErrorDetail(
                    code=ErrorCode.CLIENT_NOT_FOUND,
                    message="Client not found",
                ).model_dump(),
            )
        return

    deps = await collect_dependencies(session, Client, client_id)
    if deps:
        return JSONResponse(
            status_code=409,
            content={
                "detail": "has_dependencies",
                "dependencies": [d.model_dump() for d in deps],
            },
        )
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
    """Return all visitors for a given client."""
    visitors = await visitor_service.list_by_client(db_session=session, client_id=client_id)
    return [VisitorResponse.model_validate(v) for v in visitors]


@router.post("/{client_id}/archive", response_model=ClientResponse, dependencies=_WRITE_GUARD)
async def archive_client(
    client_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> ClientResponse:
    """Archive a client — flip ``is_active=False`` (spec §2/§14).

    Returns HTTP **200 with the re-fetched body** (``archived: true`` in the
    response schema) so the frontend updates the row without a refetch (spec
    §12 S5). Idempotent. Closes #198 (Client restore parity). Client has NO
    cross-entity cascade — only Master does (spec §4.2).
    """
    ok = await service.archive(db_session=session, id=client_id)
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.CLIENT_NOT_FOUND,
                message="Client not found",
            ).model_dump(),
        )
    return await _refetch_or_404(service, session, client_id)


@router.post("/{client_id}/restore", response_model=ClientResponse, dependencies=_WRITE_GUARD)
async def restore_client(
    client_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> ClientResponse:
    """Restore an archived client — flip ``is_active=True`` (spec §2/§14).

    Returns HTTP **200 with the re-fetched body** (``archived: false``). 404 if
    not found. Idempotent. No cross-entity cascade.
    """
    ok = await service.restore(db_session=session, id=client_id)
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.CLIENT_NOT_FOUND,
                message="Client not found",
            ).model_dump(),
        )
    return await _refetch_or_404(service, session, client_id)


async def _refetch_or_404(
    service: ClientService, session: SessionDep, client_id: str
) -> ClientResponse:
    """Re-fetch the client after a successful archive/restore (Task 11)."""
    client = await service.get(db_session=session, id=client_id)
    if client is None:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.CLIENT_NOT_FOUND,
                message="Client not found",
            ).model_dump(),
        )
    return client
