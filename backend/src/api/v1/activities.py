"""FastAPI router for activity CRUD endpoints with date filtering."""

from datetime import date
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.permissions import require_permission, verify_fetch_metadata
from src.auth.scope import ScopeContext, get_optional_scope
from src.db import SessionDep
from src.domain.deletion import (
    collect_dependencies,
    collect_dependency_ids,
    stale_expected_entities,
)
from src.errors import ERROR_MESSAGES, ErrorCode, ErrorDetail
from src.models.activity import Activity
from src.schemas.activity import (
    ActivityCopyWeekRequest,
    ActivityCreate,
    ActivityDeleteBody,
    ActivityPatch,
    ActivityResponse,
    ActivityUpdate,
    CopyWeekResult,
)
from src.schemas.common import PaginatedResponse
from src.schemas.pagination import PaginationParams
from src.services.activity import ActivityService, get_activity_service

router = APIRouter(tags=["activities"])


@lru_cache
def _get_activity_service() -> ActivityService:
    """Dependency factory returning a singleton ActivityService."""
    return get_activity_service()


_ServiceDep = Annotated[ActivityService, Depends(_get_activity_service)]

# GH #247 (spec §3.7): every mutating route carries activities:write plus the
# CSRF fetch-metadata secondary line (verify_fetch_metadata).
_WRITE_GUARD = [
    Depends(require_permission("activities:write")),
    Depends(verify_fetch_metadata),
]


async def _to_response(
    service: ActivityService,
    db_session: AsyncSession,
    activity,
) -> ActivityResponse:
    """Single-activity response (computes occupied via one SUM)."""
    occupied = await service.sum_active_seats(db_session=db_session, activity_id=activity.id)
    return _map_response(activity, occupied)


def _map_response(activity: ActivityResponse, occupied: int) -> ActivityResponse:
    """Set occupied on a validated ActivityResponse."""
    activity.occupied = occupied
    return activity


@router.get("", response_model=PaginatedResponse[ActivityResponse])
async def list_activities(
    service: _ServiceDep,
    session: SessionDep,
    pagination: PaginationParams = Depends(),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    q: str | None = Query(None, min_length=2, max_length=100),
    service_id: str | None = Query(None),
    # GH #263 T2 (D1): the route stays PUBLIC, but a logged-in master
    # sees only his own activities — master_key (or the empty-scope
    # sentinel) becomes the ``master_id`` equality kwarg; anonymous /
    # admin → master_key=None → no filter (unchanged behaviour).
    scope: ScopeContext = Depends(get_optional_scope),  # noqa: B008
) -> PaginatedResponse[ActivityResponse]:
    """Return all activities, optionally filtered by date range and service.

    ``q`` (GH #212): case-insensitive substring on the joined Service.title OR
    exact id equality for a full UUID; ``service_id`` narrows by service;
    ``total`` reflects the filtered count. len<2 / len>100 → 422
    VALIDATION_ERROR. List items carry ``service_title`` (single-item
    endpoints leave it None). Master role (GH #263): server-side scope —
    only ``master_id == master_key`` rows; empty scope → empty result.
    """
    result = await service.list(
        db_session=session, page=pagination.page, per_page=pagination.per_page,
        date_from=date_from, date_to=date_to, q=q, service_id=service_id,
        master_id=scope.master_key,
    )
    occupied_map = await service.sum_active_seats_bulk(
        db_session=session, activity_ids=[a.id for a in result.items]
    )
    return PaginatedResponse(
        items=[_map_response(a, occupied=occupied_map.get(a.id, 0)) for a in result.items],
        total=result.total,
        page=result.page,
        per_page=result.per_page,
    )


@router.get("/{activity_id}", response_model=ActivityResponse)
async def get_activity(
    activity_id: str,
    service: _ServiceDep,
    session: SessionDep,
    # GH #263 T2: public route + master narrowing (see list_activities).
    scope: ScopeContext = Depends(get_optional_scope),  # noqa: B008
) -> ActivityResponse:
    """Return a single activity by ID with computed occupied count.

    Scoped master + чужая активность → 404 (indistinguishable from
    «не существует»); single scope-aware query (404-fast-path, T7).
    """
    activity = await service.get_scoped(
        db_session=session, id=activity_id, master_key=scope.master_key
    )
    if not activity:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.ACTIVITY_NOT_FOUND,
                message="Activity not found",
            ).model_dump(),
        )
    return await _to_response(service, db_session=session, activity=activity)


@router.post("", response_model=ActivityResponse, status_code=201,
             dependencies=_WRITE_GUARD)
async def create_activity(
    data: ActivityCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> ActivityResponse:
    """Create a new activity."""
    activity = await service.create(db_session=session, data=data)
    return await _to_response(service, db_session=session, activity=activity)


# GH #242 (spec §4): no conflict with the /{activity_id} routes — there are no
# other POST-parameterized paths in this file.
@router.post("/copy-week", response_model=CopyWeekResult, dependencies=_WRITE_GUARD)
async def copy_week(
    data: ActivityCopyWeekRequest,
    service: _ServiceDep,
    session: SessionDep,
) -> CopyWeekResult:
    """Copy the previous week's activities into the target week (GH #242).

    ``week_start`` is the Monday of the TARGET week; ``locations`` is the
    explicit list of location ids checked in the popup. Validation errors
    (non-Monday / unknown location / volume cap) raise 422 with the
    COPY_WEEK_* codes; an empty source copies nothing (200 with zeros).
    """
    return await service.copy_week(
        db_session=session,
        week_start=data.week_start,
        locations=data.locations,
    )


@router.put("/{activity_id}", response_model=ActivityResponse, dependencies=_WRITE_GUARD)
async def update_activity(
    activity_id: str,
    data: ActivityUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> ActivityResponse:
    """Full-update an activity by ID (PUT, not PATCH)."""
    activity = await service.update(db_session=session, id=activity_id, data=data)
    if not activity:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.ACTIVITY_NOT_FOUND,
                message="Activity not found",
            ).model_dump(),
        )
    return await _to_response(service, db_session=session, activity=activity)


@router.patch("/{activity_id}", response_model=ActivityResponse, dependencies=_WRITE_GUARD)
async def partial_update_activity(
    activity_id: str,
    patch: ActivityPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> ActivityResponse:
    """Partially update an activity — only fields sent in the body are updated."""
    activity = await service.patch(db_session=session, id=activity_id, data=patch)
    if not activity:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.ACTIVITY_NOT_FOUND,
                message="Activity not found",
            ).model_dump(),
        )
    return await _to_response(service, db_session=session, activity=activity)


def _dependencies_response(deps: list, detail: str) -> JSONResponse:
    """The unified 409 preview payload: ``{detail, dependencies}`` —
    mirror of the records route's builder (#285, same pinned shape).

    ``detail`` distinguishes the two 409s of the deferred-delete contract
    (#286 D2): ``has_dependencies`` (dry-run preview) and
    ``stale_dependencies`` (commit-time expected mismatch). The
    ``dependencies`` array is ``DependencyNode`` dumps — for activities
    the tree spans TWO matrix levels (records with per-row items +
    aggregated visits/payments); optional-None node fields are OMITTED
    (``exclude_none``), non-optional fields always serialize.
    """
    return JSONResponse(
        status_code=409,
        content={
            "detail": detail,
            "dependencies": [d.model_dump(exclude_none=True) for d in deps],
        },
    )


@router.delete("/{activity_id}", status_code=204, dependencies=_WRITE_GUARD)
async def delete_activity(
    activity_id: str,
    service: _ServiceDep,
    session: SessionDep,
    body: ActivityDeleteBody | None = Body(default=None),
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
    """Unified delete contract — dry-run preview flag / commit body (#286 D2).

    Full mirror of the records route (GH #285 rev7/rev8): the legacy
    bare-DELETE execution is REMOVED. Modes:

    * ``?dry_run=true`` — PURE preview (never touches rows, no SSE):
      one-query existence probe → missing → 404 (a lying 204 otherwise:
      ``collect_dependencies`` returns [] for a missing id); present →
      ``collect_dependencies`` → empty → 204 WITHOUT deleting; non-empty
      → 409 + the two-level dependency tree (records node with per-row
      items + aggregated visits/payments). Combined with ANY body → 422
      ``invalid_delete_request`` (checked before the probe).
    * No body, no flag → 422 ``EXPECTED_STATE_REQUIRED`` — every real
      deletion must declare its state (ErrorDetail canon, #286 D2);
      rejected before anything else.
    * Body ``{expected}`` — the deferred-delete commit: existence probe →
      ``collect_dependencies`` + ``collect_dependency_ids`` (the recursive
      two-level subtree: records + visits/payments of every record) →
      **per-entity expected id-set verification** — subset semantics: a
      dep that disappeared in the undo window does not block; an id of
      ANY node present on the server but missing from ``expected`` does
      (a mid-window record AND a visit/payment inside an
      already-confirmed record); auto deps (photos/activity_tags) are
      exempt. Mismatch → 409 ``stale_dependencies`` + current tree.
      Only on a match → the handwritten ``ActivityService.delete``
      (the ``@transactional`` records cascade + photo SET NULL + join
      rows) → 204; missing id → 404. Fail-closed: the check runs BEFORE
      execution — a stale commit deletes nothing.

    Every branch inherits ``_WRITE_GUARD`` (activities:write + fetch
    metadata) — no weakening (#247 §3.7).
    """
    expected = body.expected if body is not None else None

    # Rev7 (#285) mirror: bare DELETE without the flag is a contract
    # violation — reject the request shape before any DB access.
    # ErrorDetail canon (#286 D2; the records route keeps its pinned
    # flat-string shape for its consumers).
    if not dry_run and expected is None:
        raise HTTPException(
            status_code=422,
            detail=ErrorDetail(
                code=ErrorCode.EXPECTED_STATE_REQUIRED,
                message=ERROR_MESSAGES[ErrorCode.EXPECTED_STATE_REQUIRED],
            ).model_dump(),
        )
    # Pure preview never carries a body — any body + dry_run is invalid,
    # checked before the existence probe (#286 D2: explicit, so the combo
    # can never degrade into a preview of a stale state).
    if dry_run and body is not None:
        raise HTTPException(
            status_code=422,
            detail=ErrorDetail(
                code=ErrorCode.INVALID_DELETE_REQUEST,
                message=ERROR_MESSAGES[ErrorCode.INVALID_DELETE_REQUEST],
            ).model_dump(),
        )

    # Existence probe — ONE query; the same repository-get pattern the
    # records route folds its scope into (#285). The dry-run branch MUST
    # 404 on a missing id instead of previewing an empty tree.
    activity = await service.get_scoped(
        db_session=session, id=activity_id, master_key=None,
    )
    if not activity:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.ACTIVITY_NOT_FOUND,
                message="Activity not found",
            ).model_dump(),
        )

    if dry_run:
        deps = await collect_dependencies(session, Activity, activity_id)
        if deps:
            return _dependencies_response(deps, detail="has_dependencies")
        return  # 204 — preview only: no service.delete, no SSE marks.

    # Body branch: the commit of the deferred delete. Expected id-set
    # verification FIRST (fail-closed) — a stale commit must 409 BEFORE
    # the handwritten cascade could partially execute.
    deps = await collect_dependencies(session, Activity, activity_id)
    now_ids = await collect_dependency_ids(session, Activity, activity_id)
    if stale_expected_entities(Activity, now_ids, expected or {}):
        return _dependencies_response(deps, detail="stale_dependencies")

    # Match → execution by the handwritten service (records cascade,
    # photo SET NULL, join rows — untouched by #286).
    deleted = await service.delete(db_session=session, id=activity_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.ACTIVITY_NOT_FOUND,
                message="Activity not found",
            ).model_dump(),
        )
