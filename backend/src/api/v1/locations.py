"""FastAPI router for location CRUD endpoints."""

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
from src.domain.sorting import SortExpr, SortKeyMap, SortKeySpec, apply_sort
from src.errors import ErrorCode, ErrorDetail
from src.models.enums import ArchiveStatus
from src.models.location import Location
from src.schemas.common import PaginatedResponse, SortOrder
from src.schemas.location import (
    LocationCreate,
    LocationDeleteBody,
    LocationPatch,
    LocationResponse,
    LocationSortBy,
    LocationUpdate,
    ReorderRequest,
)
from src.schemas.pagination import IdQueryParam, PaginationParams
from src.services.location import LocationService, get_location_service

router = APIRouter(tags=["locations"])


@lru_cache
def _get_location_service() -> LocationService:
    """Dependency factory returning a singleton LocationService."""
    return get_location_service()


_ServiceDep = Annotated[LocationService, Depends(_get_location_service)]

# GH #247 (spec §3.7): every mutating route carries locations:write plus the
# CSRF fetch-metadata secondary line (verify_fetch_metadata).
_WRITE_GUARD = [
    Depends(require_permission("locations:write")),
    Depends(verify_fetch_metadata),
]
_READ_GUARD = [Depends(require_permission("locations:read"))]

# Sort whitelist map: UI key → spec (#205 Task 3, spec §4.5; #172:
# ``name`` → ``title``; GH #367 Task 5: SortKeyMap + shared resolver).
# ``archived`` → is_active (asc = is_active ASC = archived-first).
# All keys are canonical (asc → nullsfirst / desc → nullslast); the
# ``sort_by=None`` fallback stays in the route (spec §4.3).
_LOCATION_SORT_KEYS: SortKeyMap = {
    "title": SortKeySpec([Location.title]),
    "short_title": SortKeySpec([Location.short_title]),
    "capacity": SortKeySpec([Location.capacity]),
    "address": SortKeySpec([Location.address]),
    "location_hint": SortKeySpec([Location.location_hint]),
    "description": SortKeySpec([Location.description]),
    "archived": SortKeySpec([Location.is_active]),
    "yandex_map_url": SortKeySpec([Location.yandex_map_url]),
    "created_at": SortKeySpec([Location.created_at]),
}


# GH #232 §3.1: typed ``?id=`` list for the locations list — the shared
# canonical contract (``IdQueryParam`` in schemas/pagination.py: UUID-only,
# MAX_LIST_IDS ceiling, dedup of repeats BEFORE the cap). The sibling-param
# shape is required by upstream fastapi #12481 (scalar query params mixed
# with the Depends() pagination model forbid the ``Annotated[Model,
# Query()]`` form) — only the CONTRACT is shared, not the injection shape.
IdListQuery = IdQueryParam


@router.get("", response_model=PaginatedResponse[LocationResponse])
async def list_locations(
    service: _ServiceDep,
    session: SessionDep,
    pagination: PaginationParams = Depends(),
    status: ArchiveStatus = Query(ArchiveStatus.ACTIVE),
    sort_by: LocationSortBy | None = Query(None),
    sort_order: SortOrder = Query("asc"),
    q: str | None = Query(None, min_length=2, max_length=100),
    # GH #232 §3.1: the Depends() pagination model silently drops
    # list-typed fields (FastAPI body-classification quirk), so the ``id``
    # set rides a sibling scalar-style Query param — the shared
    # IdListQuery contract (UUID-only, dedup of repeats BEFORE the
    # ≤MAX_LIST_IDS cap; row-level dedup follows from SQL IN).
    id: IdListQuery = None,
) -> PaginatedResponse[LocationResponse]:
    """Return locations filtered by archive status (default: active),
    sorted by sort_order, then title.

    ``status`` accepts ``active`` (default), ``archived``, or ``all`` — see
    ``ArchiveStatus``. Invalid values are rejected with 422 by FastAPI's
    enum validation.

    ``sort_by`` selects a whitelisted sort key (spec §4.5); ``sort_order``
    is ``asc`` (default) or ``desc``. Unknown ``sort_by`` → 422 via Literal
    validation. ``sort_by=None`` → spec §4.4 default order with ``id ASC``
    tiebreak.

    ``q`` (GH #212): case-insensitive substring on ``title``/``short_title``/
    ``address``/``description`` OR exact equality on ``id`` (full UUID) or
    the URL fields (``yandex_map_url``/``review_url``/``image_url`` — full
    string only, partial URLs never match); ``total`` reflects the filtered
    count. len<2 / len>100 → 422 VALIDATION_ERROR.

    ``?id=`` (GH #232 §3.1): typed set narrowing through the universal
    ``ArchiveService`` path. NOTE: the Depends() pagination model cannot
    carry list-typed query fields (FastAPI drops them as body params), so
    the ``id`` list is read via the router-level ``Query`` alias
    (``IdListQuery`` above) — the pagination model keeps page/per_page
    (scalar mixing, fastapi #12481, prevents the Annotated[Model, Query()]
    shape here).
    """
    # Annotated for the SortExpr union: the mixed asc() fallback joins to
    # ``list[object]`` otherwise, and ``ArchiveService.list`` takes
    # ``Sequence[SortExpr] | None``.
    order_by: list[SortExpr] | None
    if sort_by is None:
        # Spec §4.3/§4.4: entity fallback, never passed to the resolver;
        # ``sort_order`` is IGNORED without an explicit sort_by.
        order_by = [asc(Location.sort_order), asc(Location.title), asc(Location.id)]
    else:
        order_by = apply_sort(_LOCATION_SORT_KEYS, sort_by, sort_order, Location.id)
    return await service.list(
        db_session=session,
        page=pagination.page,
        per_page=pagination.per_page,
        status=status,
        order_by=order_by,
        q=q,
        ids=id,
    )


@router.get("/all", response_model=list[LocationResponse], dependencies=_READ_GUARD)
async def list_all_locations(
    service: _ServiceDep,
    session: SessionDep,
    status: ArchiveStatus = Query(ArchiveStatus.ACTIVE),
) -> list[LocationResponse]:
    """Return all locations as a bare JSON array (GH #205).

    Unpaginated, capped by ``BARE_LIST_MAX_ROWS`` (1000). Sorted by
    ``sort_order ASC, title ASC, id ASC`` (spec §4.4). ``status``
    mirrors the paginated list endpoint (active default / archived / all).
    """
    try:
        return await service.list_all(
            db_session=session,
            status=status,
            order_by=[asc(Location.sort_order), asc(Location.title), asc(Location.id)],
        )
    except BareListLimitExceededError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.put("/reorder", response_model=list[LocationResponse],
            dependencies=_WRITE_GUARD)
async def reorder_locations(
    data: ReorderRequest,
    service: _ServiceDep,
    session: SessionDep,
) -> list[LocationResponse]:
    """Reorder locations by assigning sort_order from the provided ID list."""
    return await service.reorder(db_session=session, ids=data.ids)


@router.get("/{location_id}", response_model=LocationResponse)
async def get_location(
    location_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> LocationResponse:
    """Return a single location by ID."""
    location = await service.get(db_session=session, id=location_id)
    if not location:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.LOCATION_NOT_FOUND,
                message="Location not found",
            ).model_dump(),
        )
    return location


@router.post("", response_model=LocationResponse, status_code=201,
             dependencies=_WRITE_GUARD)
async def create_location(
    data: LocationCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> LocationResponse:
    """Create a new location."""
    return await service.create(db_session=session, data=data)


@router.put("/{location_id}", response_model=LocationResponse, dependencies=_WRITE_GUARD)
async def update_location(
    location_id: str,
    data: LocationUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> LocationResponse:
    """Full-update a location by ID (PUT, not PATCH)."""
    location = await service.update(db_session=session, id=location_id, data=data)
    if not location:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.LOCATION_NOT_FOUND,
                message="Location not found",
            ).model_dump(),
        )
    return location


@router.patch("/{location_id}", response_model=LocationResponse, dependencies=_WRITE_GUARD)
async def patch_location(
    location_id: str,
    data: LocationPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> LocationResponse:
    """Partial-update a location by ID (PATCH)."""
    location = await service.patch(db_session=session, id=location_id, data=data)
    if not location:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.LOCATION_NOT_FOUND,
                message="Location not found",
            ).model_dump(),
        )
    return location


@router.delete("/{location_id}", status_code=204, dependencies=_WRITE_GUARD)
async def delete_location(
    location_id: str,
    service: _ServiceDep,
    session: SessionDep,
    body: Annotated[LocationDeleteBody | None, Body()] = None,
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
    REMOVED. Location deps per the FK matrix: ``activities`` (blocked,
    NON-auto — the race gate: its id-set joins the expected check even
    though the node is never confirmed), plus 2 AUTO deps
    (location_tags cascade, photos nullify — resolved automatically,
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
      verification (subset semantics for the non-auto dep activities —
      a dep that disappeared in the undo window does not block, one
      that APPEARED does) → mismatch → 409 ``stale_dependencies`` +
      current tree. Only on a match → ``resolve_delete`` (validates
      resolutions — blocked activities → 422 "archive instead",
      ``ResolutionError`` → 422 — then cascades location_tags,
      nullifies photos and hard-deletes the location) → 204; missing
      id → 404 ``LOCATION_NOT_FOUND``.

    Per the §4.4 matrix a successful commit with ``resolutions`` is
    unreachable for Location (activities is blocked, the rest are
    auto) — the branch is still honored in full: it is the contract
    for API consumers and mid-window races.
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
    loc = await service.get(db_session=session, id=location_id)
    if not loc:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.LOCATION_NOT_FOUND,
                message="Location not found",
            ).model_dump(),
        )

    if dry_run:
        deps = await collect_dependencies(session, Location, location_id)
        if deps:
            return _dependencies_response(deps, detail="has_dependencies")
        return  # 204 — preview only: no resolve_delete, no SSE marks.

    # Body branch: the commit of the deferred delete. Expected id-set
    # verification FIRST (fail-closed) — a stale commit must 409 BEFORE
    # the resolutions validation inside resolve_delete could turn it
    # into a 422, and before any row is touched. Reads and the
    # @transactional executor share the request session — one
    # transaction (SQLite single-writer; #318 D2).
    deps = await collect_dependencies(session, Location, location_id)
    now_ids = await collect_dependency_ids(session, Location, location_id)
    if stale_expected_entities(Location, now_ids, expected or {}):
        return _dependencies_response(deps, detail="stale_dependencies")

    # Match → execution by the generic executor: re-collects deps,
    # validates resolutions (blocked activities → 422,
    # ResolutionError → 422), cascades location_tags, nullifies
    # photos, hard-deletes the location row.
    try:
        ok = await service.resolve_delete(
            db_session=session, id=location_id, resolutions=resolutions or {},
        )
    except ResolutionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.LOCATION_NOT_FOUND,
                message="Location not found",
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
    non-optional fields always serialize (the Location tree shows
    counters for all deps; items stay absent — §4.3 fixed boundary).
    """
    return JSONResponse(
        status_code=409,
        content={
            "detail": detail,
            "dependencies": [d.model_dump(exclude_none=True) for d in deps],
        },
    )


@router.post("/{location_id}/archive", response_model=LocationResponse, dependencies=_WRITE_GUARD)
async def archive_location(
    location_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> LocationResponse:
    """Archive a location — flip ``is_active=False`` (spec §2/§14).

    Returns HTTP **200 with the re-fetched body** (``archived: true`` in the
    response schema) so the frontend updates the row without a refetch (spec
    §12 S5). Idempotent. Location has NO cross-entity cascade — only Master
    does (spec §4.2).
    """
    ok = await service.archive(db_session=session, id=location_id)
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.LOCATION_NOT_FOUND,
                message="Location not found",
            ).model_dump(),
        )
    return await _refetch_or_404(service, session, location_id)


@router.post("/{location_id}/restore", response_model=LocationResponse, dependencies=_WRITE_GUARD)
async def restore_location(
    location_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> LocationResponse:
    """Restore an archived location — flip ``is_active=True`` (spec §2/§14).

    Returns HTTP **200 with the re-fetched body** (``archived: false``). 404 if
    not found. Idempotent. No cross-entity cascade.
    """
    ok = await service.restore(db_session=session, id=location_id)
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.LOCATION_NOT_FOUND,
                message="Location not found",
            ).model_dump(),
        )
    return await _refetch_or_404(service, session, location_id)


async def _refetch_or_404(
    service: LocationService, session: SessionDep, location_id: str
) -> LocationResponse:
    """Re-fetch the location after a successful archive/restore (Task 11)."""
    location = await service.get(db_session=session, id=location_id)
    if location is None:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.LOCATION_NOT_FOUND,
                message="Location not found",
            ).model_dump(),
        )
    return location
