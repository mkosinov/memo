"""FastAPI router for service CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

from src.db import SessionDep
from src.domain.deletion import ResolutionError, collect_dependencies
from src.errors import ErrorCode, ErrorDetail
from src.models.enums import ArchiveStatus
from src.models.service import Service
from src.schemas.common import PaginatedResponse
from src.schemas.service import ServiceCreate, ServicePatch, ServiceResponse, ServiceUpdate
from src.services.service import ServiceService, get_service_service

router = APIRouter(tags=["services"])


@lru_cache
def _get_service_service() -> ServiceService:
    """Dependency factory returning a singleton ServiceService."""
    return get_service_service()


_ServiceDep = Annotated[ServiceService, Depends(_get_service_service)]


@router.get("", response_model=PaginatedResponse[ServiceResponse])
async def list_services(
    service: _ServiceDep,
    session: SessionDep,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status: ArchiveStatus = Query(ArchiveStatus.ACTIVE),
) -> PaginatedResponse[ServiceResponse]:
    """Return services filtered by archive status with tariffs and tags.

    ``status`` accepts ``active`` (default), ``archived``, or ``all`` — see
    ``ArchiveStatus``. Invalid values are rejected with 422 by FastAPI's
    enum validation.
    """
    return await service.list(db_session=session, page=page, per_page=per_page, status=status)


@router.get("/{service_id}", response_model=ServiceResponse)
async def get_service(
    service_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> ServiceResponse:
    """Return a single service by ID with tariffs and tags."""
    svc = await service.get(db_session=session, id=service_id)
    if not svc:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.SERVICE_NOT_FOUND,
                message="Service not found",
            ).model_dump(),
        )
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
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.SERVICE_NOT_FOUND,
                message="Service not found",
            ).model_dump(),
        )
    return ServiceResponse.model_validate(svc)


@router.patch("/{service_id}", response_model=ServiceResponse)
async def patch_service(
    service_id: str,
    data: ServicePatch,
    service: _ServiceDep,
    session: SessionDep,
) -> ServiceResponse:
    """Partial-update a service by ID (PATCH)."""
    svc = await service.patch(db_session=session, id=service_id, data=data)
    if not svc:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.SERVICE_NOT_FOUND,
                message="Service not found",
            ).model_dump(),
        )
    return ServiceResponse.model_validate(svc)


@router.delete("/{service_id}", status_code=204)
async def delete_service(
    service_id: str,
    service: _ServiceDep,
    session: SessionDep,
    resolutions: dict[str, str] | None = Body(default=None),
) -> None:
    """Unified DELETE — dry-run (no body) or execute (with body). Spec §2/§5/§6.

    * No body (dry-run): ``collect_dependencies`` → empty → hard delete (204);
      non-empty → 409 + dependency tree (no rows modified).
    * With body (execute): ``service.resolve_delete`` runs the resolution
      transaction (Task 10) → 204; ``ResolutionError`` → 422; missing → 404.
    """
    if resolutions is not None:
        try:
            ok = await service.resolve_delete(
                db_session=session, id=service_id, resolutions=resolutions
            )
        except ResolutionError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        if not ok:
            raise HTTPException(
                status_code=404,
                detail=ErrorDetail(
                    code=ErrorCode.SERVICE_NOT_FOUND,
                    message="Service not found",
                ).model_dump(),
            )
        return

    deps = await collect_dependencies(session, Service, service_id)
    if deps:
        return JSONResponse(
            status_code=409,
            content={
                "detail": "has_dependencies",
                "dependencies": [d.model_dump() for d in deps],
            },
        )
    deleted = await service.delete(db_session=session, id=service_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.SERVICE_NOT_FOUND,
                message="Service not found",
            ).model_dump(),
        )


@router.post("/{service_id}/archive", response_model=ServiceResponse)
async def archive_service(
    service_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> ServiceResponse:
    """Archive a service — flip ``is_active=False`` (spec §2/§14).

    Returns HTTP **200 with the re-fetched body** (``archived: true`` in the
    response schema) so the frontend updates the row without a refetch (spec
    §12 S5). Idempotent. Service has NO cross-entity cascade — only Master
    does (spec §4.2).
    """
    ok = await service.archive(db_session=session, id=service_id)
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.SERVICE_NOT_FOUND,
                message="Service not found",
            ).model_dump(),
        )
    return await _refetch_or_404(service, session, service_id)


@router.post("/{service_id}/restore", response_model=ServiceResponse)
async def restore_service(
    service_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> ServiceResponse:
    """Restore an archived service — flip ``is_active=True`` (spec §2/§14).

    Returns HTTP **200 with the re-fetched body** (``archived: false``). 404 if
    not found. Idempotent. No cross-entity cascade.
    """
    ok = await service.restore(db_session=session, id=service_id)
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.SERVICE_NOT_FOUND,
                message="Service not found",
            ).model_dump(),
        )
    return await _refetch_or_404(service, session, service_id)


async def _refetch_or_404(
    service: ServiceService, session: SessionDep, service_id: str
) -> ServiceResponse:
    """Re-fetch the service after a successful archive/restore (Task 11)."""
    svc = await service.get(db_session=session, id=service_id)
    if svc is None:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.SERVICE_NOT_FOUND,
                message="Service not found",
            ).model_dump(),
        )
    return ServiceResponse.model_validate(svc)
