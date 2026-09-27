"""FastAPI router for service CRUD endpoints."""

from functools import lru_cache
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import asc, func, select

from src.auth.permissions import require_permission, verify_fetch_metadata
from src.db import SessionDep
from src.domain.deletion import (
    ResolutionError,
    collect_dependencies,
    collect_dependency_ids,
    stale_expected_entities,
)
from src.domain.errors import BareListLimitExceededError
from src.domain.sorting import SortKeyMap, SortKeySpec, apply_sort
from src.errors import ErrorCode, ErrorDetail
from src.models.enums import ArchiveStatus
from src.models.service import Service
from src.models.tariff import Tariff
from src.schemas.common import PaginatedResponse, SortOrder
from src.schemas.pagination import PaginationParams
from src.schemas.service import (
    ServiceCreate,
    ServiceDeleteBody,
    ServicePatch,
    ServiceResponse,
    ServiceSortBy,
    ServiceUpdate,
)
from src.services.service import ServiceService, get_service_service

router = APIRouter(tags=["services"])


@lru_cache
def _get_service_service() -> ServiceService:
    """Dependency factory returning a singleton ServiceService."""
    return get_service_service()


_ServiceDep = Annotated[ServiceService, Depends(_get_service_service)]

# GH #247 (spec §3.7): every mutating route carries services:write plus the
# CSRF fetch-metadata secondary line (verify_fetch_metadata).
_WRITE_GUARD = [
    Depends(require_permission("services:write")),
    Depends(verify_fetch_metadata),
]
_READ_GUARD = [Depends(require_permission("services:read"))]

# Sort whitelist map: UI key → spec (#205 Task 3, spec §4.5; GH #367
# Task 5: SortKeyMap + shared resolver). ``age`` → min_age; ``archived``
# → is_active; ``tariffs`` → correlated COUNT subquery (records idiom
# for aggregate sort keys — #213 pin: content moves AS-IS, ``.correlate()``
# preserved). ``material_hint`` removed by GH #223 Task 13 (spec §10).
# All keys are canonical (asc → nullsfirst / desc → nullslast); the
# ``sort_by=None`` fallback stays in the route (spec §4.3).
_SERVICE_SORT_KEYS: SortKeyMap = {
    "title": SortKeySpec([Service.title]),
    "duration": SortKeySpec([Service.duration]),
    "age": SortKeySpec([Service.min_age]),
    "tariffs": SortKeySpec([
        select(func.count(Tariff.id))
        .where(Tariff.service_id == Service.id)
        .correlate(Service)
        .scalar_subquery()
    ]),
    "specialty": SortKeySpec([Service.specialty]),
    "archived": SortKeySpec([Service.is_active]),
    "created_at": SortKeySpec([Service.created_at]),
}


@router.get("", response_model=PaginatedResponse[ServiceResponse])
async def list_services(
    service: _ServiceDep,
    session: SessionDep,
    pagination: PaginationParams = Depends(),
    status: ArchiveStatus = Query(ArchiveStatus.ACTIVE),
    sort_by: ServiceSortBy | None = Query(None),
    sort_order: SortOrder = Query("asc"),
    q: str | None = Query(None, min_length=2, max_length=100),
    material_id: UUID | None = Query(None),
) -> PaginatedResponse[ServiceResponse]:
    """Return services filtered by archive status with tariffs and tags.

    ``status`` accepts ``active`` (default), ``archived``, or ``all`` — see
    ``ArchiveStatus``. Invalid values are rejected with 422 by FastAPI's
    enum validation.

    ``sort_by`` selects a whitelisted sort key (spec §4.5); ``sort_order``
    is ``asc`` (default) or ``desc``. Unknown ``sort_by`` → 422 via Literal
    validation. ``sort_by=None`` → spec §4.4 default order (``title ASC,
    id ASC``).

    ``q`` (GH #212): case-insensitive substring on ``title`` OR
    ``description`` OR exact id equality for a full UUID; ``total``
    reflects the filtered count. len<2 / len>100 → 422 VALIDATION_ERROR.

    ``material_id`` (GH #223 spec §5): filter to services linked to the
    material via ``service_materials``. Invalid UUID → 422 (param type
    validation); valid-but-unknown → 200 with an empty page (filter
    semantics — the same shape as a ``q`` no-match).
    """
    if sort_by is None:
        # Spec §4.3/§4.4: entity fallback, never passed to the resolver;
        # ``sort_order`` is IGNORED without an explicit sort_by.
        order_by = [asc(Service.title), asc(Service.id)]
    else:
        order_by = apply_sort(_SERVICE_SORT_KEYS, sort_by, sort_order, Service.id)
    return await service.list(
        db_session=session,
        page=pagination.page,
        per_page=pagination.per_page,
        status=status,
        order_by=order_by,
        q=q,
        material_id=str(material_id) if material_id is not None else None,
    )


@router.get("/all", response_model=list[ServiceResponse], dependencies=_READ_GUARD)
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


@router.post("", response_model=ServiceResponse, status_code=201,
             dependencies=_WRITE_GUARD)
async def create_service(
    data: ServiceCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> ServiceResponse:
    """Create a new service with tariffs and tag links."""
    svc = await service.create(db_session=session, data=data)
    return ServiceResponse.model_validate(svc)


@router.put("/{service_id}", response_model=ServiceResponse, dependencies=_WRITE_GUARD)
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


@router.patch("/{service_id}", response_model=ServiceResponse, dependencies=_WRITE_GUARD)
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


@router.delete("/{service_id}", status_code=204, dependencies=_WRITE_GUARD)
async def delete_service(
    service_id: str,
    service: _ServiceDep,
    session: SessionDep,
    body: Annotated[ServiceDeleteBody | None, Body()] = None,
    dry_run: Annotated[
        bool | None,
        Query(
            description=(
                "Non-destructive preview: returns 204 without deleting "
                "(no deps) or 409 with the dependency tree; never "
                "modifies rows"
            )
        ),
    ] = None,
) -> None:
    """Unified delete contract — dry-run preview flag / commit body
    (GH #345 §4.1, one-to-one mirror of the tags route / #318 D2).

    The legacy no-body DELETE (execute-if-clean / silent dry-run) is
    REMOVED. Service deps per the FK matrix: ``activities`` (blocked,
    NON-auto — the race gate: its id-set joins the expected check even
    though the node is never confirmed), plus 4 AUTO deps (tariffs,
    photos, service_tags, service_materials — resolved automatically,
    exempt from the check).

    * ``?dry_run=true`` — PURE preview (never touches rows, no SSE):
      existence probe → missing → 404; present → ``collect_dependencies``
      → empty → 204 WITHOUT deleting; non-empty → 409 + dependency tree.
      Combined with a ``resolutions`` body → 422
      ``dry_run_with_resolutions_forbidden`` (checked before the
      existence probe); an expected-only body is silently ignored.
    * No body, no flag → 422 ``{"detail": "expected_state_required"}``:
      every real deletion must declare its state; rejected before any
      DB access — the form check precedes the probe, so an unknown id
      still gets 422, not 404. Same for a body whose ``expected`` is
      absent (``{"resolutions": {...}}`` alone — the rejected legacy
      shape).
    * Body ``{resolutions?, expected}`` — the deferred-delete commit:
      existence probe → ``collect_dependencies`` → expected id-set
      verification (subset semantics: ``set(now_ids) ⊆
      set(expected[entity])`` for the non-auto dep activities — a dep
      that disappeared in the undo window does not block, one that
      APPEARED does) → mismatch → 409 ``stale_dependencies`` + current
      tree. Only on a match → ``resolve_delete`` (validates resolutions
      — blocked activities → 422 "archive instead", ``ResolutionError``
      → 422 — then nullifies photos, cascades tariffs/service_tags/
      service_materials and hard-deletes the service) → 204; missing id
      → 404 ``SERVICE_NOT_FOUND``.

    Per the §4.4 matrix a successful commit with ``resolutions`` is
    unreachable for Service (activities is blocked, the rest are auto) —
    the branch is still honored in full: it is the contract for
    API consumers and mid-window races.
    """
    resolutions = body.resolutions if body is not None else None
    expected = body.expected if body is not None else None

    # Rev7 (#285) mirror: bare DELETE without the flag is a contract
    # violation — reject the request shape before any DB access. Literal
    # string detail (same flat shape as the 409 preview) → JSONResponse,
    # not raised: the global HTTPException handler wraps string details
    # into {code, message} — not the pinned contract.
    if not dry_run and expected is None:
        return JSONResponse(
            status_code=422,
            content={"detail": "expected_state_required"},
        )
    # Pure preview never carries resolutions — forbidden combination.
    # (An expected-only body IS allowed: silently ignored below.)
    if dry_run and resolutions is not None:
        return JSONResponse(
            status_code=422,
            content={"detail": "dry_run_with_resolutions_forbidden"},
        )

    # Existence probe. The dry-run branch MUST 404 on a missing id
    # instead of previewing an empty tree.
    svc = await service.get(db_session=session, id=service_id)
    if not svc:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.SERVICE_NOT_FOUND,
                message="Service not found",
            ).model_dump(),
        )

    if dry_run:
        deps = await collect_dependencies(session, Service, service_id)
        if deps:
            return _dependencies_response(deps, detail="has_dependencies")
        return  # 204 — preview only: no resolve_delete, no SSE marks.

    # Body branch: the commit of the deferred delete. Expected id-set
    # verification FIRST (fail-closed) — a stale commit must 409 BEFORE
    # the resolutions validation inside resolve_delete could turn it
    # into a 422, and before any row is touched. Reads and the
    # @transactional executor share the request session — one
    # transaction (SQLite single-writer; #318 D2).
    deps = await collect_dependencies(session, Service, service_id)
    now_ids = await collect_dependency_ids(session, Service, service_id)
    if stale_expected_entities(Service, now_ids, expected or {}):
        return _dependencies_response(deps, detail="stale_dependencies")

    # Match → execution by the generic executor: re-collects deps,
    # validates resolutions (blocked activities → 422,
    # ResolutionError → 422), nullifies photos, cascades tariffs /
    # service_tags / service_materials, hard-deletes the service row.
    try:
        ok = await service.resolve_delete(
            db_session=session, id=service_id, resolutions=resolutions or {},
        )
    except ResolutionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.SERVICE_NOT_FOUND,
                message="Service not found",
            ).model_dump(),
        )


def _dependencies_response(deps: list, detail: str) -> JSONResponse:
    """The unified 409 preview payload: ``{detail, dependencies}``.

    Mirror of the tags/records/activities routes' builder (#285/#286/
    #318; same pinned shape). ``detail`` distinguishes the two 409s of
    the deferred-delete contract (GH #345 §4.1): ``has_dependencies``
    (dry-run preview) and ``stale_dependencies`` (commit-time expected
    mismatch). The ``dependencies`` array is ``DependencyNode`` dumps —
    optional-None node fields are OMITTED (``exclude_none``),
    non-optional fields always serialize (the Service tree shows
    counters for all deps; items stay absent — §4.3 fixed boundary).
    """
    return JSONResponse(
        status_code=409,
        content={
            "detail": detail,
            "dependencies": [d.model_dump(exclude_none=True) for d in deps],
        },
    )


@router.post("/{service_id}/archive", response_model=ServiceResponse, dependencies=_WRITE_GUARD)
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


@router.post("/{service_id}/restore", response_model=ServiceResponse, dependencies=_WRITE_GUARD)
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
