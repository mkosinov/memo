"""FastAPI router for the positions dictionary (GH #266 T4, spec D4).

Plain dictionary CRUD (not archive-aware): paginated list, bare ``/all``,
get, create, PUT/PATCH, DELETE. The single domain rule: built-ins
(``is_system``) never delete — 422 ``POSITION_IS_SYSTEM`` BEFORE the
dry_run/commit fork (spec #324 §4.3); their title stays freely editable
(tested in the same route).
"""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import asc

from src.api.v1._delete_family import (
    DryRunParam,
    dependencies_response,
    form_rejection,
)
from src.auth.permissions import require_permission, verify_fetch_metadata
from src.db import SessionDep
from src.domain.deletion import (
    ResolutionError,
    collect_dependencies,
    collect_dependency_ids,
    stale_expected_entities,
)
from src.errors import ErrorCode, ErrorDetail
from src.models.position import Position
from src.schemas.common import DeleteBody, PaginatedResponse
from src.schemas.pagination import PaginationParams
from src.schemas.position import (
    PositionCreate,
    PositionPatch,
    PositionResponse,
    PositionUpdate,
)
from src.services.position import PositionService, get_position_service

router = APIRouter(tags=["positions"])


@lru_cache
def _get_position_service() -> PositionService:
    """Dependency factory returning a singleton PositionService."""
    return get_position_service()


_ServiceDep = Annotated[PositionService, Depends(_get_position_service)]

# GH #247 (spec §3.7): mutating routes carry positions:write + the CSRF
# fetch-metadata secondary line; /all carries positions:read.
_WRITE_GUARD = [
    Depends(require_permission("positions:write")),
    Depends(verify_fetch_metadata),
]
_READ_GUARD = [Depends(require_permission("positions:read"))]


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=404,
        detail=ErrorDetail(
            code=ErrorCode.POSITION_NOT_FOUND,
            message="Должность не найдена",
        ).model_dump(),
    )


@router.get(
    "",
    response_model=PaginatedResponse[PositionResponse],
    dependencies=_READ_GUARD,
)
async def list_positions(
    service: _ServiceDep,
    session: SessionDep,
    pagination: PaginationParams = Depends(),
) -> PaginatedResponse[PositionResponse]:
    """Paginated dictionary list — ``title ASC, id ASC`` (plain dictionary,
    no archive status; the set is tiny, the envelope keeps UI parity)."""
    return await service.list(
        db_session=session,
        page=pagination.page,
        per_page=pagination.per_page,
        order_by=[asc(Position.title), asc(Position.id)],
    )


@router.get("/all", response_model=list[PositionResponse], dependencies=_READ_GUARD)
async def list_all_positions(
    service: _ServiceDep,
    session: SessionDep,
) -> list[PositionResponse]:
    """Bare array of dictionary rows (GH #205), sorted ``title ASC, id ASC``.

    No pagination — the checkbox list in the staff card consumes the whole
    dictionary; capped by ``BARE_LIST_MAX_ROWS`` like every /all route.
    """
    from src.domain.errors import BareListLimitExceededError

    try:
        return await service.list_all(
            db_session=session,
            order_by=[asc(Position.title), asc(Position.id)],
        )
    except BareListLimitExceededError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get(
    "/{position_id}", response_model=PositionResponse, dependencies=_READ_GUARD
)
async def get_position(
    position_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> PositionResponse:
    """Return a single dictionary row by ID."""
    position = await service.get(db_session=session, id=position_id)
    if not position:
        raise _not_found()
    return position


@router.post(
    "", response_model=PositionResponse, status_code=201, dependencies=_WRITE_GUARD
)
async def create_position(
    data: PositionCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> PositionResponse:
    """Create a user-defined position (``is_system`` is owned by the
    dictionary — always ``false`` here)."""
    return await service.create(db_session=session, data=data)


@router.put(
    "/{position_id}", response_model=PositionResponse, dependencies=_WRITE_GUARD
)
async def update_position(
    position_id: str,
    data: PositionUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> PositionResponse:
    """Full-update a position (title only; built-ins included — the title
    of a system position stays editable, D4)."""
    position = await service.update(db_session=session, id=position_id, data=data)
    if not position:
        raise _not_found()
    return position


@router.patch(
    "/{position_id}", response_model=PositionResponse, dependencies=_WRITE_GUARD
)
async def patch_position(
    position_id: str,
    data: PositionPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> PositionResponse:
    """Partial-update a position (title only)."""
    position = await service.patch(db_session=session, id=position_id, data=data)
    if not position:
        raise _not_found()
    return position


@router.delete("/{position_id}", status_code=204, dependencies=_WRITE_GUARD)
async def delete_position(
    position_id: str,
    service: _ServiceDep,
    session: SessionDep,
    body: Annotated[DeleteBody | None, Body()] = None,
    dry_run: DryRunParam = None,
) -> None:
    """Unified delete contract — dry-run flag / commit body (#324 §4,
    position = dependent subject — mirror of the tags route #318 D2).

    Check order (security pin, §4): form → probe → **is_system guard** →
    fork. The probed row's ``is_system`` → 422 ``POSITION_IS_SYSTEM``
    BEFORE the dry_run/commit fork — a built-in is neither previewed nor
    deleted in any form (the «встроенная не удаляется» behavior, moved
    from execution time to the guard).

    Position's single dep is ``staff_positions`` (join, cascade,
    NON-auto — stripping it from staff IS the visible main effect): a
    busy position previews the «Сотрудник» node; its commit carries
    ``{resolutions: {staff_positions: cascade}, expected:
    {staff_positions: [...]}}`` and unlinks the holders (the staff
    cards survive); an unheld position behaves as a leaf
    (``{expected: {}}``). Scope model: NONE by design (studio
    dictionary) — access = the ``positions:write`` role above; the
    tree is visible to role holders.

    * ``?dry_run=true`` — PURE preview: busy → 409 ``has_dependencies``
      + tree; free → 204 WITHOUT deleting.
    * No body, no flag → 422 ``expected_state_required`` (rejected
      before any DB access; same for a resolutions-only body).
    * Body ``{resolutions?, expected}`` — the deferred-delete commit:
      expected id-set verification (subset semantics — a holder link
      that APPEARED after confirmation → 409 ``stale_dependencies`` +
      live tree; a disappeared one does not block) → ``resolve_delete``
      (validates resolutions → strips staff_positions → hard-deletes
      the position) → 204; missing id → 404.
    """
    rejection = form_rejection(body, dry_run)
    if rejection is not None:
        return rejection
    resolutions = body.resolutions if body is not None else None
    expected = body.expected if body is not None else None

    # Existence probe — returns the row (no per-row scope for positions:
    # dictionary access = the positions:write role; §4.2).
    position = await service.get(db_session=session, id=position_id)
    if not position:
        raise _not_found()

    # Subject guard (§4.3) — BEFORE the dry_run/commit fork: a system
    # position is neither previewed nor deleted.
    if position.is_system:
        raise HTTPException(
            status_code=422,
            detail=ErrorDetail(
                code=ErrorCode.POSITION_IS_SYSTEM,
                message="Встроенная должность не удаляется",
            ).model_dump(),
        )

    if dry_run:
        deps = await collect_dependencies(session, Position, position_id)
        if deps:
            return dependencies_response(deps, detail="has_dependencies")
        return  # 204 — preview only: no resolve_delete, no SSE marks.

    # Body branch: the commit of the deferred delete. Expected id-set
    # verification FIRST (fail-closed) — a stale commit must 409 BEFORE
    # the resolutions validation inside resolve_delete could turn it
    # into a 422, and before any join row is touched. Reads and the
    # @transactional executor share the request session — one
    # transaction (SQLite single-writer).
    deps = await collect_dependencies(session, Position, position_id)
    now_ids = await collect_dependency_ids(session, Position, position_id)
    if stale_expected_entities(Position, now_ids, expected or {}):
        return dependencies_response(deps, detail="stale_dependencies")

    # Match → execution by the generic executor: re-collects deps,
    # validates resolutions (ResolutionError → 422), strips the
    # staff_positions join rows, hard-deletes the position row (the
    # is_system guard already ran above — a system row never gets here).
    try:
        ok = await service.resolve_delete(
            db_session=session, id=position_id, resolutions=resolutions or {},
        )
    except ResolutionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not ok:
        raise _not_found()
