"""FastAPI router for material CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import asc

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
from src.models.material import Material
from src.schemas.common import PaginatedResponse, SortOrder
from src.schemas.material import (
    MaterialCreate,
    MaterialDeleteBody,
    MaterialPatch,
    MaterialResponse,
    MaterialSortBy,
    MaterialUpdate,
)
from src.schemas.pagination import PaginationParams
from src.services.material import MaterialService, get_material_service

router = APIRouter(
    tags=["materials"],
    # GH #247 spec §3.7: wholly-private router — read guard at router level.
    dependencies=[Depends(require_permission("materials:read"))],
)


@lru_cache
def _get_material_service() -> MaterialService:
    """Dependency factory returning a singleton MaterialService."""
    return get_material_service()


_ServiceDep = Annotated[MaterialService, Depends(_get_material_service)]

# GH #247 (spec §3.7): every mutating route carries materials:write plus the
# CSRF fetch-metadata secondary line (verify_fetch_metadata).
_WRITE_GUARD = [
    Depends(require_permission("materials:write")),
    Depends(verify_fetch_metadata),
]

# Sort whitelist map: UI key → spec (#205 Task 3, spec §4.5; GH #367
# Task 5: SortKeyMap + shared resolver). ``archived`` → is_active
# (asc = is_active ASC = archived-first). All keys are canonical
# (asc → nullsfirst / desc → nullslast); the ``sort_by=None`` fallback
# stays in the route (spec §4.3).
_MATERIAL_SORT_KEYS: SortKeyMap = {
    "title": SortKeySpec([Material.title]),
    "description": SortKeySpec([Material.description]),
    "archived": SortKeySpec([Material.is_active]),
    "created_at": SortKeySpec([Material.created_at]),
}


@router.get("", response_model=PaginatedResponse[MaterialResponse])
async def list_materials(
    service: _ServiceDep,
    session: SessionDep,
    pagination: PaginationParams = Depends(),
    status: ArchiveStatus = Query(ArchiveStatus.ACTIVE),
    sort_by: MaterialSortBy | None = Query(None),
    sort_order: SortOrder = Query("asc"),
    q: str | None = Query(None, min_length=2, max_length=100),
) -> PaginatedResponse[MaterialResponse]:
    """Return materials filtered by archive status (default: active).

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
    """
    if sort_by is None:
        # Spec §4.3/§4.4: entity fallback, never passed to the resolver;
        # ``sort_order`` is IGNORED without an explicit sort_by.
        order_by = [asc(Material.title), asc(Material.id)]
    else:
        order_by = apply_sort(_MATERIAL_SORT_KEYS, sort_by, sort_order, Material.id)
    return await service.list(
        db_session=session,
        page=pagination.page,
        per_page=pagination.per_page,
        status=status,
        order_by=order_by,
        q=q,
    )


@router.get("/all", response_model=list[MaterialResponse])
async def list_all_materials(
    service: _ServiceDep,
    session: SessionDep,
    status: ArchiveStatus = Query(ArchiveStatus.ACTIVE),
) -> list[MaterialResponse]:
    """Return all materials as a bare JSON array (GH #205).

    Unpaginated, capped by ``BARE_LIST_MAX_ROWS`` (1000). Sorted by
    ``title ASC, id ASC`` (spec §4.4). ``status`` mirrors the paginated
    list endpoint (active default / archived / all).
    """
    try:
        return await service.list_all(
            db_session=session,
            status=status,
            order_by=[asc(Material.title), asc(Material.id)],
        )
    except BareListLimitExceededError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/{material_id}", response_model=MaterialResponse)
async def get_material(
    material_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> MaterialResponse:
    """Return a single material by ID."""
    material = await service.get(db_session=session, id=material_id)
    if not material:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MATERIAL_NOT_FOUND,
                message="Material not found",
            ).model_dump(),
        )
    return material


@router.post("", response_model=MaterialResponse, status_code=201,
             dependencies=_WRITE_GUARD)
async def create_material(
    data: MaterialCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> MaterialResponse:
    """Create a new material."""
    return await service.create(db_session=session, data=data)


@router.put("/{material_id}", response_model=MaterialResponse, dependencies=_WRITE_GUARD)
async def update_material(
    material_id: str,
    data: MaterialUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> MaterialResponse:
    """Full-update a material by ID (PUT, not PATCH)."""
    material = await service.update(db_session=session, id=material_id, data=data)
    if not material:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MATERIAL_NOT_FOUND,
                message="Material not found",
            ).model_dump(),
        )
    return material


@router.patch("/{material_id}", response_model=MaterialResponse, dependencies=_WRITE_GUARD)
async def patch_material(
    material_id: str,
    data: MaterialPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> MaterialResponse:
    """Partial-update a material by ID (PATCH)."""
    material = await service.patch(db_session=session, id=material_id, data=data)
    if not material:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MATERIAL_NOT_FOUND,
                message="Material not found",
            ).model_dump(),
        )
    return material


@router.delete("/{material_id}", status_code=204, dependencies=_WRITE_GUARD)
async def delete_material(
    material_id: str,
    service: _ServiceDep,
    session: SessionDep,
    body: Annotated[MaterialDeleteBody | None, Body()] = None,
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
    REMOVED. Material deps per the FK matrix: ONE AUTO dep
    (``service_materials`` cascade — the informed-consent tree of the
    linked case); NO non-auto deps and no blocked state (§4.4), so the
    expected verification is always satisfied by ``{}`` and a commit
    never needs ``resolutions`` (the full branch is still honored for
    API consumers and races).

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
      verification (no non-auto deps — the check is vacuous for
      Material) → ``resolve_delete`` (validates resolutions —
      ``ResolutionError`` → 422 — then cascades the service_materials
      join rows and hard-deletes the material; the SERVICE rows
      survive, GH #223 §7) → 204; missing id → 404
      ``MATERIAL_NOT_FOUND``.
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
    material = await service.get(db_session=session, id=material_id)
    if not material:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MATERIAL_NOT_FOUND,
                message="Material not found",
            ).model_dump(),
        )

    if dry_run:
        deps = await collect_dependencies(session, Material, material_id)
        if deps:
            return _dependencies_response(deps, detail="has_dependencies")
        return  # 204 — preview only: no resolve_delete, no SSE marks.

    # Body branch: the commit of the deferred delete. Expected id-set
    # verification FIRST (fail-closed; vacuous for Material — no
    # non-auto deps — but kept as the shared family flow). Reads and
    # the @transactional executor share the request session — one
    # transaction (SQLite single-writer; #318 D2).
    deps = await collect_dependencies(session, Material, material_id)
    now_ids = await collect_dependency_ids(session, Material, material_id)
    if stale_expected_entities(Material, now_ids, expected or {}):
        return _dependencies_response(deps, detail="stale_dependencies")

    # Match → execution by the generic executor: re-collects deps,
    # validates resolutions (ResolutionError → 422), cascades the
    # service_materials join rows, hard-deletes the material row.
    try:
        ok = await service.resolve_delete(
            db_session=session, id=material_id, resolutions=resolutions or {},
        )
    except ResolutionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MATERIAL_NOT_FOUND,
                message="Material not found",
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
    non-optional fields always serialize.
    """
    return JSONResponse(
        status_code=409,
        content={
            "detail": detail,
            "dependencies": [d.model_dump(exclude_none=True) for d in deps],
        },
    )


@router.post("/{material_id}/archive", response_model=MaterialResponse, dependencies=_WRITE_GUARD)
async def archive_material(
    material_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> MaterialResponse:
    """Archive a material — flip ``is_active=False`` (spec §2/§14).

    Returns HTTP **200 with the re-fetched body** (``archived: true`` in the
    response schema) so the frontend updates the row without a refetch (spec
    §12 S5). Idempotent. Material has NO cross-entity cascade — only Master
    does (spec §4.2).
    """
    ok = await service.archive(db_session=session, id=material_id)
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MATERIAL_NOT_FOUND,
                message="Material not found",
            ).model_dump(),
        )
    return await _refetch_or_404(service, session, material_id)


@router.post("/{material_id}/restore", response_model=MaterialResponse, dependencies=_WRITE_GUARD)
async def restore_material(
    material_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> MaterialResponse:
    """Restore an archived material — flip ``is_active=True`` (spec §2/§14).

    Returns HTTP **200 with the re-fetched body** (``archived: false``). 404 if
    not found. Idempotent. No cross-entity cascade.
    """
    ok = await service.restore(db_session=session, id=material_id)
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MATERIAL_NOT_FOUND,
                message="Material not found",
            ).model_dump(),
        )
    return await _refetch_or_404(service, session, material_id)


async def _refetch_or_404(
    service: MaterialService, session: SessionDep, material_id: str
) -> MaterialResponse:
    """Re-fetch the material after a successful archive/restore (Task 11)."""
    material = await service.get(db_session=session, id=material_id)
    if material is None:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MATERIAL_NOT_FOUND,
                message="Material not found",
            ).model_dump(),
        )
    return material
