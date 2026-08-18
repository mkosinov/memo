"""FastAPI router for service CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import asc, func, select

from src.db import SessionDep
from src.domain.deletion import ResolutionError, collect_dependencies
from src.domain.errors import BareListLimitExceededError
from src.errors import ErrorCode, ErrorDetail
from src.models.enums import ArchiveStatus
from src.models.service import Service
from src.models.tariff import Tariff
from src.schemas.common import PaginatedResponse, SortOrder
from src.schemas.pagination import PaginationParams
from src.schemas.service import ServiceCreate, ServicePatch, ServiceResponse, ServiceSortBy, ServiceUpdate
from src.services.service import ServiceService, get_service_service

router = APIRouter(tags=["services"])


@lru_cache
def _get_service_service() -> ServiceService:
    """Dependency factory returning a singleton ServiceService."""
    return get_service_service()


_ServiceDep = Annotated[ServiceService, Depends(_get_service_service)]

# Sort whitelist map: UI key → list of ORM columns / subqueries (#205 Task 3,
# spec §4.5). ``age`` → min_age; ``archived`` → is_active; ``tariffs`` →
# correlated COUNT subquery (records idiom for aggregate sort keys).
_SERVICE_SORT_MAP: dict[str, list] = {
    "title": [Service.title],
    "duration": [Service.duration],
    "age": [Service.min_age],
    "material_hint": [Service.material_hint],
    "tariffs": [
        select(func.count(Tariff.id))
        .where(Tariff.service_id == Service.id)
        .correlate(Service)
        .scalar_subquery()
    ],
    "specialty": [Service.specialty],
    "archived": [Service.is_active],
    "created_at": [Service.created_at],
}


def _service_order_by(sort_by: ServiceSortBy | None, sort_order: SortOrder) -> list:
    """Build the ``order_by`` list for GET /api/v1/services.

    * ``sort_by=None`` → spec §4.4 default: ``title ASC, id ASC`` (NEW —
      services had no order_by before #205).
    * User sort → mapped columns/subqueries with nulls-first (asc) /
      nulls-last (desc), then ``id ASC`` tiebreak (records idiom).
    """
    if sort_by is None:
        return [asc(Service.title), asc(Service.id)]
    cols = _SERVICE_SORT_MAP[sort_by]
    ordered = [
        c.desc().nullslast() if sort_order == "desc" else c.asc().nullsfirst()
        for c in cols
    ]
    return [*ordered, asc(Service.id)]


@router.get("", response_model=PaginatedResponse[ServiceResponse])
async def list_services(
    service: _ServiceDep,
    session: SessionDep,
    pagination: PaginationParams = Depends(),
    status: ArchiveStatus = Query(ArchiveStatus.ACTIVE),
    sort_by: ServiceSortBy | None = Query(None),
    sort_order: SortOrder = Query("asc"),
) -> PaginatedResponse[ServiceResponse]:
    """Return services filtered by archive status with tariffs and tags.

    ``status`` accepts ``active`` (default), ``archived``, or ``all`` — see
    ``ArchiveStatus``. Invalid values are rejected with 422 by FastAPI's
    enum validation.

    ``sort_by`` selects a whitelisted sort key (spec §4.5); ``sort_order``
    is ``asc`` (default) or ``desc``. Unknown ``sort_by`` → 422 via Literal
    validation. ``sort_by=None`` → spec §4.4 default order (``title ASC,
    id ASC``).
    """
    return await service.list(
        db_session=session,
        page=pagination.page,
        per_page=pagination.per_page,
        status=status,
        order_by=_service_order_by(sort_by, sort_order),
    )


@router.get("/all", response_model=list[ServiceResponse])
async def list_all_services(
    service: _ServiceDep,
    session: SessionDep,
    status: ArchiveStatus = Query(ArchiveStatus.ACTIVE),
) -> list[ServiceResponse]:
    """Return all services as a bare JSON array (GH #205).

    Unpaginated, capped by ``BARE_LIST_MAX_ROWS`` (1000). Sorted by
    ``title ASC, id ASC`` (spec §4.4). ``status`` mirrors the paginated
    list endpoint (active default / archived / all). Tariffs and tags are
    eagerly loaded (``ServiceService.list_all`` override).
    """
    try:
        return await service.list_all(
            db_session=session,
            status=status,
            order_by=[asc(Service.title), asc(Service.id)],
        )
    except BareListLimitExceededError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


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
