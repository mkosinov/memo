"""FastAPI router for visitor CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.v1._delete_family import (
    DryRunParam,
    dependencies_response,
    form_rejection,
)
from src.auth.permissions import require_permission, verify_fetch_metadata
from src.auth.scope import ScopeContext, get_scope
from src.db import SessionDep
from src.domain.deletion import (
    ResolutionError,
    collect_dependencies,
    collect_dependency_ids,
    stale_expected_entities,
)
from src.errors import ErrorCode, ErrorDetail
from src.models.visitor import Visitor
from src.schemas.common import DeleteBody, PaginatedResponse
from src.schemas.pagination import PaginationParams
from src.schemas.visitor import VisitorCreate, VisitorPatch, VisitorResponse, VisitorUpdate
from src.services.visitor import VisitorService, get_visitor_service

router = APIRouter(
    tags=["visitors"],
    # GH #247 spec §3.7: wholly-private router — read guard at router level.
    dependencies=[Depends(require_permission("visitors:read"))],
)


@lru_cache
def _get_visitor_service() -> VisitorService:
    """Dependency factory returning a singleton VisitorService."""
    return get_visitor_service()


_ServiceDep = Annotated[VisitorService, Depends(_get_visitor_service)]

# GH #247 (spec §3.7): every mutating route carries visitors:write plus the
# CSRF fetch-metadata secondary line (verify_fetch_metadata).
_WRITE_GUARD = [
    Depends(require_permission("visitors:write")),
    Depends(verify_fetch_metadata),
]


async def _visitor_scoped_or_404(
    service: VisitorService,
    session: AsyncSession,
    visitor_id: str,
    scope: ScopeContext,
) -> Visitor | None:
    """GH #263 T2 — shared owner gate for visitor point ops.

    ONE query with the EXISTS visibility predicate (visitor → visits →
    records → activities): a visitor without visits on the master's own
    records is invisible → the same 404 as missing (404-fast-path).

    #324 §4.2: returns the probed row (the delete-family contract probes
    existence through this helper — first line of both DELETE branches).
    """
    visitor = await service.get_scoped(
        db_session=session, id=visitor_id, master_key=scope.master_key
    )
    if not visitor:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.VISITOR_NOT_FOUND,
                message="Visitor not found",
            ).model_dump(),
        )
    return visitor


@router.get("", response_model=PaginatedResponse[VisitorResponse])
async def list_visitors(
    service: _ServiceDep,
    session: SessionDep,
    pagination: PaginationParams = Depends(),
    q: str | None = Query(None, min_length=2, max_length=100),
    # GH #263 T2: scope via visits → records → activities — a visitor
    # without the master's visits is invisible; ``q`` ANDs with the scope.
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> PaginatedResponse[VisitorResponse]:
    """Return all visitors, paginated.

    ``q`` (GH #212): case-insensitive substring on ``name`` OR exact id
    equality for a full UUID; ``total`` reflects the filtered count.
    len<2 / len>100 → 422 VALIDATION_ERROR.
    """
    return await service.list(
        db_session=session,
        page=pagination.page,
        per_page=pagination.per_page,
        q=q,
        master_key=scope.master_key,
    )


@router.get("/{visitor_id}", response_model=VisitorResponse)
async def get_visitor(
    visitor_id: str,
    service: _ServiceDep,
    session: SessionDep,
    # GH #263 T2: чужой посетитель → 404 (single scope-aware query).
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> VisitorResponse:
    """Return a single visitor by ID."""
    visitor = await service.get_scoped(
        db_session=session, id=visitor_id, master_key=scope.master_key
    )
    if not visitor:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.VISITOR_NOT_FOUND,
                message="Visitor not found",
            ).model_dump(),
        )
    return visitor


@router.post("", response_model=VisitorResponse, status_code=201,
             dependencies=_WRITE_GUARD)
async def create_visitor(
    data: VisitorCreate,
    service: _ServiceDep,
    session: SessionDep,
    # GH #263 T2: a master may create visitors only in the context of his
    # own records — the client must have a record to his activity
    # (чужой/невидимый клиент → 404; admin → unrestricted).
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> VisitorResponse:
    """Create a new visitor."""
    if not await service.client_is_scoped_visible(
        db_session=session, client_id=data.client_id, master_key=scope.master_key
    ):
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.CLIENT_NOT_FOUND,
                message="Client not found",
            ).model_dump(),
        )
    return await service.create(db_session=session, data=data)


@router.put("/{visitor_id}", response_model=VisitorResponse, dependencies=_WRITE_GUARD)
async def update_visitor(
    visitor_id: str,
    data: VisitorUpdate,
    service: _ServiceDep,
    session: SessionDep,
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> VisitorResponse:
    """Full-update a visitor by ID (PUT, not PATCH)."""
    await _visitor_scoped_or_404(service, session, visitor_id, scope)
    visitor = await service.update(db_session=session, id=visitor_id, data=data)
    if not visitor:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.VISITOR_NOT_FOUND,
                message="Visitor not found",
            ).model_dump(),
        )
    return visitor


@router.patch("/{visitor_id}", response_model=VisitorResponse, dependencies=_WRITE_GUARD)
async def patch_visitor(
    visitor_id: str,
    data: VisitorPatch,
    service: _ServiceDep,
    session: SessionDep,
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> VisitorResponse:
    """Partial-update a visitor by ID (PATCH)."""
    await _visitor_scoped_or_404(service, session, visitor_id, scope)
    visitor = await service.patch(db_session=session, id=visitor_id, data=data)
    if not visitor:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.VISITOR_NOT_FOUND,
                message="Visitor not found",
            ).model_dump(),
        )
    return visitor


@router.delete("/{visitor_id}", status_code=204, dependencies=_WRITE_GUARD)
async def delete_visitor(
    visitor_id: str,
    service: _ServiceDep,
    session: SessionDep,
    body: Annotated[DeleteBody | None, Body()] = None,
    dry_run: DryRunParam = None,
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> None:
    """Unified delete contract — dry-run flag / commit body (#324 §4,
    visitor = dependent subject — mirror of the tags route #318 D2).

    Visitor's deps: ``visits`` (NON-auto, cascade — the visits die with
    the visitor, user decision 21.09: no anonymization) and
    ``visitor_tags`` (auto join). The commit carries
    ``{resolutions: {visits: cascade}, expected: {visits: [...],
    visitor_tags: [...]}}`` — the auto group is included in the
    verification payload when present (the executor deletes both
    groups); a visit-less visitor behaves as a leaf (``{expected: {}}``).

    * ``?dry_run=true`` — PURE preview: with visits → 409
      ``has_dependencies`` + tree (the «Посещение» node with per-visit
      items); clean → 204 WITHOUT deleting.
    * No body, no flag → 422 ``expected_state_required`` (rejected
      before any DB access; same for a resolutions-only body).
    * Body ``{resolutions?, expected}`` — the deferred-delete commit:
      expected id-set verification (subset semantics — a visit that
      APPEARED after confirmation → 409 ``stale_dependencies`` + live
      tree; a disappeared one does not block) → ``resolve_delete``
      (validates resolutions → batch-deletes the visits WITH the
      record seats/status recompute (Task 2 block) → strips
      visitor_tags → hard-deletes the visitor) → 204. Missing/foreign
      id → 404 — the scope probe runs FIRST in both branches.

    Check order (security pin, §4.1-4.2): form → probe → fork.
    """
    rejection = form_rejection(body, dry_run)
    if rejection is not None:
        return rejection
    resolutions = body.resolutions if body is not None else None
    expected = body.expected if body is not None else None

    # Scope-existence probe — first line of BOTH branches (§4.2).
    await _visitor_scoped_or_404(service, session, visitor_id, scope)

    if dry_run:
        deps = await collect_dependencies(session, Visitor, visitor_id)
        if deps:
            return dependencies_response(deps, detail="has_dependencies")
        return  # 204 — preview only: no resolve_delete, no SSE marks.

    # Body branch: the commit of the deferred delete. Expected id-set
    # verification FIRST (fail-closed) — a stale commit must 409 BEFORE
    # the resolutions validation inside resolve_delete could turn it
    # into a 422, and before any row is touched. Reads and the
    # @transactional executor share the request session — one
    # transaction (SQLite single-writer).
    deps = await collect_dependencies(session, Visitor, visitor_id)
    now_ids = await collect_dependency_ids(session, Visitor, visitor_id)
    if stale_expected_entities(Visitor, now_ids, expected or {}):
        return dependencies_response(deps, detail="stale_dependencies")

    # Match → execution by the generic executor: re-collects deps,
    # validates resolutions (ResolutionError → 422), batch-deletes the
    # visits (recompute included, Task 2), strips visitor_tags,
    # hard-deletes the visitor row.
    try:
        ok = await service.resolve_delete(
            db_session=session, id=visitor_id, resolutions=resolutions or {},
        )
    except ResolutionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.VISITOR_NOT_FOUND,
                message="Visitor not found",
            ).model_dump(),
        )
