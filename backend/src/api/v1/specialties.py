"""FastAPI router for the specialties dictionary (GH #599 Task 1).

Mirror of the positions router (minimal dictionary): paginated list
(fixed ``title ASC, id ASC`` — NO ``sort_by``, no filters, no ``?q=``),
bare ``/all`` (dropdown source, ``BARE_LIST_MAX_ROWS``-capped), POST
create, PATCH rename, DELETE via the #324 family fork (форма → probe →
dry_run/commit). No GET ``/{id}`` and no PUT — the dictionary surface
is the 5-endpoint set of the domain rules API table.

The single domain rule beyond CRUD: the title is unique
case-insensitively (functional index ``lower(title)``) — a collision on
create/rename → 409 ``SPECIALTY_TITLE_TAKEN`` (domain error raised by
both the UX-fast precheck and the authoritative ``IntegrityError``
catch; rename to the row's own case-variant succeeds).

Task 2 scope: the delete-family REGISTRY carries both dependency rows
— ``services`` (visible BLOCKING, counter over all services incl.
archived) and ``staff_specialties`` (auto-cascade) — so a free row
previews 204 / commits ``{expected: {}}`` → 204, staff links cascade
(auto), and an occupied row 409s with the tree.
"""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response
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
from src.domain.errors import SpecialtyTitleTakenError
from src.errors import ErrorCode, ErrorDetail
from src.models.specialty import Specialty
from src.schemas.common import DeleteBody, PaginatedResponse
from src.schemas.specialty import (
    SpecialtyCreate,
    SpecialtyListParams,
    SpecialtyPatch,
    SpecialtyView,
)
from src.services.specialty import SpecialtyService, get_specialty_service

router = APIRouter(tags=["specialties"])


@lru_cache
def _get_specialty_service() -> SpecialtyService:
    """Dependency factory returning a singleton SpecialtyService."""
    return get_specialty_service()


_ServiceDep = Annotated[SpecialtyService, Depends(_get_specialty_service)]

# GH #247 (spec §3.7), named mirror of the positional route: mutating
# routes carry specialties:write + the CSRF fetch-metadata secondary
# line; the list and /all carry specialties:read.
_WRITE_GUARD = [
    Depends(require_permission("specialties:write")),
    Depends(verify_fetch_metadata),
]
_READ_GUARD = [Depends(require_permission("specialties:read"))]


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=404,
        detail=ErrorDetail(
            code=ErrorCode.SPECIALTY_NOT_FOUND,
            message="Направление не найдено",
        ).model_dump(),
    )


def _title_taken(title: str) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail=ErrorDetail(
            code=ErrorCode.SPECIALTY_TITLE_TAKEN,
            message="Направление с таким названием уже существует",  # noqa: RUF001
        ).model_dump(),
    )


@router.get(
    "",
    response_model=PaginatedResponse[SpecialtyView],
    dependencies=_READ_GUARD,
)
async def list_specialties(
    service: _ServiceDep,
    session: SessionDep,
    # GH #371 §4.1: one model-as-query entry — no scalar query siblings
    # (fastapi PR #12481). Specialties have no filters of their own and
    # NO sort_by — the order is fixed by contract (title ASC, id ASC).
    params: Annotated[SpecialtyListParams, Query()],
) -> PaginatedResponse[SpecialtyView]:
    """Paginated dictionary list — ``title ASC, id ASC`` (fixed order,
    domain rules List contract: the dictionary carries no ``sort_by``).

    ``id`` (GH #232/#371): repeated ``?id=`` keys narrow the list to the
    given UUID set — the inherited PaginationParams brick.
    """
    return await service.list(
        db_session=session,
        page=params.page,
        per_page=params.per_page,
        ids=params.id,
        order_by=[asc(Specialty.title), asc(Specialty.id)],
    )


@router.get("/all", response_model=list[SpecialtyView], dependencies=_READ_GUARD)
async def list_all_specialties(
    service: _ServiceDep,
    session: SessionDep,
) -> list[SpecialtyView]:
    """Bare array of dictionary rows (GH #205), sorted ``title ASC, id ASC``.

    No pagination — the dropdowns (service form, staff checkboxes)
    consume the whole dictionary; capped by ``BARE_LIST_MAX_ROWS`` like
    every /all route.
    """
    from src.domain.errors import BareListLimitExceededError

    try:
        return await service.list_all(
            db_session=session,
            order_by=[asc(Specialty.title), asc(Specialty.id)],
        )
    except BareListLimitExceededError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("", response_model=SpecialtyView, status_code=201, dependencies=_WRITE_GUARD)
async def create_specialty(
    data: SpecialtyCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> SpecialtyView:
    """Create a dictionary row (title normalized on write; a
    case-insensitive collision → 409 ``SPECIALTY_TITLE_TAKEN``)."""
    try:
        return await service.create(db_session=session, data=data)
    except SpecialtyTitleTakenError as exc:
        raise _title_taken(exc.title) from exc


@router.patch("/{specialty_id}", response_model=SpecialtyView, dependencies=_WRITE_GUARD)
async def patch_specialty(
    specialty_id: str,
    data: SpecialtyPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> SpecialtyView:
    """Rename a dictionary row — same normalization and uniqueness rule
    as create; renaming to the row's own case-variant succeeds."""
    try:
        specialty = await service.patch(db_session=session, id=specialty_id, data=data)
    except SpecialtyTitleTakenError as exc:
        raise _title_taken(exc.title) from exc
    if not specialty:
        raise _not_found()
    return specialty


@router.delete("/{specialty_id}", status_code=204, dependencies=_WRITE_GUARD)
async def delete_specialty(
    specialty_id: str,
    service: _ServiceDep,
    session: SessionDep,
    body: Annotated[DeleteBody | None, Body()] = None,
    dry_run: DryRunParam = None,
) -> Response:
    """Unified delete contract — dry-run flag / commit body (#324 family,
    the positional route's transport).

    Check order (security pin, §4): form → probe → fork. No subject
    guard (specialties carry no ``is_system`` — every row is
    user-defined and deletable).

    Dependency semantics (domain rules Delete semantics): ``services``
    is a visible BLOCKING dep (occupied by any service, archived ones
    counted — FK RESTRICT); ``staff_specialties`` is auto-cascade (the
    materials pattern) — commit ``{"resolutions": {}}`` unlinks staff
    cards, which survive. A free row is a leaf.

    * ``?dry_run=true`` — PURE preview: busy → 409 ``has_dependencies``
      + tree; free → 204 WITHOUT deleting.
    * No body, no flag → 422 ``expected_state_required`` (rejected
      before any DB access; same for a resolutions-only body).
    * Body ``{resolutions?, expected}`` — the deferred-delete commit:
      expected id-set verification (subset semantics) →
      ``resolve_delete`` → 204; missing id → 404.
    """
    rejection = form_rejection(body, dry_run)
    if rejection is not None:
        return rejection
    resolutions = body.resolutions if body is not None else None
    expected = body.expected if body is not None else None

    # Existence probe — returns the row (dictionary access = the
    # specialties:write role; no per-row scope).
    specialty = await service.get(db_session=session, id=specialty_id)
    if not specialty:
        raise _not_found()

    if dry_run:
        deps = await collect_dependencies(session, Specialty, specialty_id)
        if deps:
            return dependencies_response(deps, detail="has_dependencies")
        return Response(status_code=204)  # preview only: no resolve_delete, no SSE marks.

    # Body branch: the commit of the deferred delete. Expected id-set
    # verification FIRST (fail-closed) — a stale commit must 409 BEFORE
    # the resolutions validation inside resolve_delete could turn it
    # into a 422, and before any join row is touched. Reads and the
    # @transactional executor share the request session — one
    # transaction (SQLite single-writer).
    deps = await collect_dependencies(session, Specialty, specialty_id)
    now_ids = await collect_dependency_ids(session, Specialty, specialty_id)
    if stale_expected_entities(Specialty, now_ids, expected or {}):
        return dependencies_response(deps, detail="stale_dependencies")

    # Match → execution by the generic executor: re-collects deps,
    # validates resolutions (ResolutionError → 422), strips the
    # staff_specialties join rows, hard-deletes the specialty row.
    try:
        ok = await service.resolve_delete(
            db_session=session,
            id=specialty_id,
            resolutions=resolutions or {},
        )
    except ResolutionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not ok:
        raise _not_found()
    return Response(status_code=204)  # the deferred-delete commit succeeded.
