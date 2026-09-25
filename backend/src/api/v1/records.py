"""FastAPI router for record CRUD endpoints with nested visits."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.permissions import require_permission, verify_fetch_metadata
from src.auth.scope import ScopeContext, get_optional_scope, get_scope
from src.db import SessionDep
from src.domain.deletion import (
    ResolutionError,
    StaleDependenciesError,
    collect_dependencies,
)
from src.errors import ErrorCode, ErrorDetail
from src.models.record import Record
from src.schemas.common import PaginatedResponse
from src.schemas.record import (
    RecordCreate,
    RecordDeleteBody,
    RecordListParams,
    RecordPatch,
    RecordResponse,
    RecordUpdate,
    RecordViewResponse,
)
from src.services.activity import get_activity_service
from src.services.record import (
    RecordService,
    get_record_service,
    list_records_view,
    map_record,
)
from src.usecases.records import (
    create_record as create_record_scenario,
)
from src.usecases.records import (
    delete_record as delete_record_scenario,
)
from src.usecases.records import (
    patch_record as patch_record_scenario,
)
from src.usecases.records import (
    update_record as update_record_scenario,
)

router = APIRouter(tags=["records"])


@lru_cache
def _get_record_service() -> RecordService:
    """Dependency factory returning a singleton RecordService."""
    return get_record_service()


_ServiceDep = Annotated[RecordService, Depends(_get_record_service)]

# GH #247 (spec §3.7): every mutating route carries records:write plus the
# CSRF fetch-metadata secondary line (verify_fetch_metadata).
_WRITE_GUARD = [
    Depends(require_permission("records:write")),
    Depends(verify_fetch_metadata),
]
# Guarded reads — POST "" stays public (anonymous booking until #8).
_READ_GUARD = [Depends(require_permission("records:read"))]


@router.get("", response_model=PaginatedResponse[RecordResponse],
             dependencies=_READ_GUARD)
async def list_records(
    service: _ServiceDep,
    session: SessionDep,
    params: Annotated[RecordListParams, Query()],
    # GH #263 T2 (D2): the server scope ANDs conjunctively with the
    # client-supplied filters — a master's ``master_id`` filter ≠ his own
    # key yields an empty result, never the other master's rows.
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> PaginatedResponse[RecordResponse]:
    """Return records with nested visits — server-side filter, sort, paginate (#191)."""
    result = await service.list(
        db_session=session, params=params, master_key=scope.master_key
    )
    return PaginatedResponse(
        items=[map_record(r) for r in result.items],
        total=result.total,
        page=result.page,
        per_page=result.per_page,
    )


@router.get("/view", response_model=PaginatedResponse[RecordViewResponse],
             dependencies=_READ_GUARD)
async def get_records_view(
    session: SessionDep,
    params: Annotated[RecordListParams, Query()],
    # GH #263 T2: same builder, same scope — the records table's read
    # surface must be leak-proof identically.
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> PaginatedResponse[RecordViewResponse]:
    """Composite read for the records table — records page enriched with
    denormalized display fields from joins (GH #213 §4).

    Corridor 3 free function (GH #217 Task 1, ADR 007): the route calls
    ``list_records_view`` directly with the session as an argument — no
    service dependency here (the module's other routes keep theirs:
    they are CRUD); the scope arrives from ``get_scope`` and ANDs into
    the shared builder inside the function.

    Same params/sort/pagination as ``GET /records`` (single
    ``RecordListParams`` class — no contract drift); display resolution
    carries NO ``is_active`` filters, so archived entities resolve their
    names (US-3). MUST stay declared BEFORE ``GET /{record_id}``: FastAPI
    matches routes in declaration order and ``/view`` would otherwise be
    captured by the id path param (404 instead of a page).
    """
    return await list_records_view(
        db_session=session, params=params, master_key=scope.master_key
    )


@router.get("/{record_id}", response_model=RecordResponse, dependencies=_READ_GUARD)
async def get_record(
    record_id: str,
    service: _ServiceDep,
    session: SessionDep,
    # GH #263 T2: чужая запись → 404 (indistinguishable from missing);
    # single scope-aware query (404-fast-path, plan T7).
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> RecordResponse:
    """Return a single record by ID with nested visits."""
    record = await service.get_scoped(
        db_session=session, id=record_id, master_key=scope.master_key
    )
    if not record:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.RECORD_NOT_FOUND,
                message="Record not found",
            ).model_dump(),
        )
    return map_record(record)


async def _activity_scoped_or_404(
    session: AsyncSession, activity_id: str, scope: ScopeContext,
) -> None:
    """GH #263 T2-quality — create/re-target gate on the target activity.

    A scoped master may create a record on (or re-target a record to) an
    activity ONLY inside his scope: ONE owner query (the ActivityService
    point-get with the scope folded in) — чужая активность → 404,
    indistinguishable from «не существует». Admin → no check.
    """
    if scope.master_key is None:
        return
    activity = await get_activity_service().get_scoped(
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


@router.post("", response_model=RecordResponse, status_code=201)
async def create_record(
    data: RecordCreate,
    service: _ServiceDep,
    session: SessionDep,
    # GH #263 T2-quality: the booking route stays public, but a scoped
    # master may only book onto his OWN activities (foreign → 404).
    scope: ScopeContext = Depends(get_optional_scope),  # noqa: B008
) -> RecordResponse:
    """Create a new record with visits. Seats auto-calculated from len(visits)."""
    await _activity_scoped_or_404(session, data.activity_id, scope)
    # Corridor 2 (GH #171): the multi-entity booking chain lives in the
    # usecases layer — the route stays transport-only and passes the
    # master scope through UNCHANGED (scoped access was already gated on
    # the target activity above). Leading None = the @transactional
    # wrapper's unused self slot (selfless-function convention).
    record = await create_record_scenario(None, db_session=session, data=data)
    return map_record(record)


async def _scoped_or_404(
    service: RecordService,
    session: AsyncSession,
    record_id: str,
    scope: ScopeContext,
) -> None:
    """GH #263 T2 — shared point-op owner gate for record mutations.

    ONE scope-aware query (join record → activity): a scoped master whose
    record is foreign gets the same 404 as a missing record
    (404-fast-path); admin (``master_key=None``) passes untouched.
    """
    record = await service.get_scoped(
        db_session=session, id=record_id, master_key=scope.master_key
    )
    if not record:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.RECORD_NOT_FOUND,
                message="Record not found",
            ).model_dump(),
        )


@router.put("/{record_id}", response_model=RecordResponse, dependencies=_WRITE_GUARD)
async def update_record(
    record_id: str,
    data: RecordUpdate,
    service: _ServiceDep,
    session: SessionDep,
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> RecordResponse:
    """Full-update a record by ID. Replaces visits, recalculates seats."""
    await _scoped_or_404(service, session, record_id, scope)
    # GH #263 T2-quality: PUT re-targets the record — the NEW activity_id
    # must be inside the master's scope (RecordPatch carries no
    # activity_id, so PATCH cannot re-target and needs no gate).
    await _activity_scoped_or_404(session, data.activity_id, scope)
    # Corridor 2 (GH #171 Task 4): the full-update chain (visits replace +
    # recalculation + capacity re-check) lives in the usecases layer —
    # the route stays transport-only. Leading None = the @transactional
    # wrapper's unused self slot (selfless-function convention).
    record = await update_record_scenario(
        None, db_session=session, id=record_id, data=data,
    )
    if not record:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.RECORD_NOT_FOUND,
                message="Record not found",
            ).model_dump(),
        )
    return map_record(record)


@router.patch("/{record_id}", response_model=RecordResponse, dependencies=_WRITE_GUARD)
async def patch_record(
    record_id: str,
    data: RecordPatch,
    service: _ServiceDep,
    session: SessionDep,
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> RecordResponse:
    """Partial-update a record by ID (PATCH). Only sent fields are changed."""
    await _scoped_or_404(service, session, record_id, scope)
    # Corridor 2 (GH #171 Task 4): the partial-update chain lives in the
    # usecases layer — same convention as PUT above (selfless scenario,
    # keyword args; RecordPatch carries no activity_id → no re-target gate).
    record = await patch_record_scenario(
        None, db_session=session, id=record_id, data=data,
    )
    if not record:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.RECORD_NOT_FOUND,
                message="Record not found",
            ).model_dump(),
        )
    return map_record(record)


def _dependencies_response(deps: list, detail: str) -> JSONResponse:
    """The unified 409 preview payload: ``{detail, dependencies}``.

    ``detail`` distinguishes the two 409s of the deferred-delete contract
    (#285): ``has_dependencies`` (dry-run preview) and
    ``stale_dependencies`` (commit-time expected mismatch). The
    ``dependencies`` array is ``DependencyNode`` dumps either way.
    rev8: ``exclude_none`` — optional-None node fields (``message`` /
    ``cascade_preview`` / ``items``) are OMITTED, not null; non-optional
    fields (entity/relation/count/allowed_actions/auto) always serialize.
    """
    return JSONResponse(
        status_code=409,
        content={
            "detail": detail,
            "dependencies": [d.model_dump(exclude_none=True) for d in deps],
        },
    )


@router.delete("/{record_id}", status_code=204, dependencies=_WRITE_GUARD)
async def delete_record(
    record_id: str,
    service: _ServiceDep,
    session: SessionDep,
    body: Annotated[RecordDeleteBody | None, Body()] = None,
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
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> None:
    """Unified delete contract — dry-run preview flag / commit body (rev7, #285).

    Mirrors the masters/clients routes (GH #139, Addendum 13); #285 rev7
    removes the legacy no-body "execute-if-clean" mode. Record deps
    (visits, payments, record_tags) are never blocking; record with none
    → clean delete. The business chain lives in the ``delete_record``
    scenario (usecases, Corridor 2 — GH #171 Task 5): dependency
    collection, expected snapshot verification, resolutions validation,
    and the cascade (visits → payments → record_tags → record); the
    ROUTE keeps transport — the form 422s, the scope probe, the dry-run
    preview (pure read), and the 409/404/422 mapping + response format.

    * ``?dry_run=true`` — PURE preview (never touches rows, no SSE):
      ``collect_dependencies`` → empty → 204 WITHOUT deleting; non-empty
      → 409 + dependency tree. Combined with a ``resolutions`` body →
      422 ``dry_run_with_resolutions_forbidden`` (checked before the
      existence probe).
    * No body, no flag → 422 ``{"detail": "expected_state_required"}``
      (rev7): every real deletion must declare its state; rejected
      before anything else. Same for a body whose ``expected`` is absent
      (e.g. ``{"resolutions": {...}}`` alone — the rejected legacy shape).
    * Body ``{resolutions?, expected}`` — the deferred-delete commit:
      scope probe → the scenario (existence → collect deps → **expected
      id-set verification (rev5/rev6)** — for every collected non-auto
      dep ``set(now_ids) ⊆ set(expected[entity])``; mismatch →
      ``StaleDependenciesError`` → 409 ``stale_dependencies`` + current
      tree (parsed by ``ApiError.dependencies``). Subset, not equality:
      a dep that disappeared in the undo window does not block; one that
      APPEARED does; auto-deps (record_tags) are exempt (§3 D9a). Only
      on a match → resolutions validation (ResolutionError → 422) →
      cascade → 204; missing id → 404.

    GH #263 T2: the scope gate runs FIRST (one query) — чужая запись →
    404 before any dependency collection or cascade; for the dry-run
    branch the same repository-get doubles as the existence probe
    (``collect_dependencies`` returns [] for a missing id).
    """
    resolutions = body.resolutions if body is not None else None
    expected = body.expected if body is not None else None

    # Rev7 (#285): bare DELETE without the flag is a contract violation —
    # reject the request shape before any DB access. Literal string detail
    # (same flat shape as the 409 preview) → JSONResponse, not raised:
    # the global HTTPException handler wraps string details into
    # {code, message} — not the pinned contract.
    if not dry_run and expected is None:
        return JSONResponse(
            status_code=422,
            content={"detail": "expected_state_required"},
        )
    # Pure preview never carries resolutions — forbidden combination.
    if dry_run and resolutions is not None:
        return JSONResponse(
            status_code=422,
            content={"detail": "dry_run_with_resolutions_forbidden"},
        )

    await _scoped_or_404(service, session, record_id, scope)

    if dry_run:
        deps = await collect_dependencies(session, Record, record_id)
        if deps:
            return _dependencies_response(deps, detail="has_dependencies")
        return  # 204 — preview only: no service.delete, no SSE marks.

    # Body branch: the commit of the deferred delete — the business chain
    # lives in the usecases scenario (GH #171 Task 5, Corridor 2): the
    # scenario collects dependencies, verifies the expected snapshot
    # (rev5/rev6) BEFORE the resolutions validation, validates
    # resolutions, and runs the cascade; the ROUTE keeps only transport —
    # the 409 stale_dependencies rendering, the 422 mapping, and 404.
    try:
        ok = await delete_record_scenario(
            None, db_session=session, id=record_id,
            resolutions=resolutions, expected=expected,
        )
    except StaleDependenciesError as exc:
        return _dependencies_response(exc.nodes, detail="stale_dependencies")
    except ResolutionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.RECORD_NOT_FOUND,
                message="Record not found",
            ).model_dump(),
        )
