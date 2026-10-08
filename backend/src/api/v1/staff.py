"""FastAPI router for the staff directory (GH #266 T4, spec «API (после)»).

Full CRUD over the composite staff card (service = composite
:class:`StaffService`): paginated list with the GH #205 contract (status /
q / sort_by whitelist WITHOUT ``position`` — M2M is ambiguous; specialty
and color sort through a LEFT JOIN on the masters extension, NULLs last),
bare ``/all``, get (including archived), create (D6 flags), atomic
PUT/PATCH, DELETE with the unified deferred-delete contract (GH #345 —
dry_run preview / commit body with ``expected``, verification inside the
``delete_staff`` scenario transaction), and
D6-checkbox archive/restore. ``PUT /reorder`` is NOT carried over from the
old masters router (no consumers; ``sort_order`` stays the default-order
column).
"""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import asc

from src.auth.passwords import PasswordPolicyError
from src.auth.permissions import require_permission, verify_fetch_metadata
from src.db import SessionDep
from src.domain.deletion import ResolutionError, StaleDependenciesError, collect_dependencies
from src.domain.errors import (
    BareListLimitExceededError,
    ColorRequiredError,
    PhoneInvalidError,
    PhoneTakenError,
    PositionIsSystemError,
    PositionNotFoundError,
    SpecialtyRequiredError,
)
from src.domain.sorting import SortExpr, SortKeyMap, SortKeySpec, apply_sort
from src.errors import ErrorCode, ErrorDetail
from src.models.enums import ArchiveStatus
from src.models.master import Master
from src.models.staff import Staff
from src.schemas.common import PaginatedResponse, SortOrder
from src.schemas.pagination import PaginationParams
from src.schemas.staff import (
    StaffArchiveRequest,
    StaffCreate,
    StaffDeleteBody,
    StaffPatch,
    StaffResponse,
    StaffSortBy,
    StaffUpdate,
)
from src.services.staff import StaffService, get_staff_service
from src.usecases.staff import (
    archive_staff as archive_staff_scenario,
)
from src.usecases.staff import (
    create_staff as create_staff_scenario,
)
from src.usecases.staff import (
    delete_staff as delete_staff_scenario,
)
from src.usecases.staff import (
    patch_staff as patch_staff_scenario,
)
from src.usecases.staff import (
    update_staff as update_staff_scenario,
)

router = APIRouter(tags=["staff"])


@lru_cache
def _get_staff_service() -> StaffService:
    """Dependency factory returning a singleton StaffService."""
    return get_staff_service()


_ServiceDep = Annotated[StaffService, Depends(_get_staff_service)]

# GH #247 (spec §3.7): every mutating route carries staff:write plus the
# CSRF fetch-metadata secondary line; /all carries staff:read.
_WRITE_GUARD = [
    Depends(require_permission("staff:write")),
    Depends(verify_fetch_metadata),
]
_READ_GUARD = [Depends(require_permission("staff:read"))]

# Sort whitelist map: UI key → spec (GH #367 Task 5, domain-rules/staff.md
# «List contract»). ``position`` is EXCLUDED (M2M, ambiguous). specialty/color
# live on the masters extension (a LEFT JOIN in the list query supplies
# them) → policy ``always_nulls_last``: a card without the master section
# sorts after sectioned ones in BOTH directions (#266 — «пустые — в
# конце»). All other keys are canonical (asc → nullsfirst / desc →
# nullslast). The ``sort_by=None`` fallback stays in the route (spec §4.3:
# entity default, never passed to the resolver).
_STAFF_SORT_KEYS: SortKeyMap = {
    "name": SortKeySpec([Staff.first_name, Staff.last_name]),
    "specialty": SortKeySpec([Master.specialty], policy="always_nulls_last"),
    "color": SortKeySpec([Master.color], policy="always_nulls_last"),
    "avatar": SortKeySpec([Staff.avatar_url]),
    "status": SortKeySpec([Staff.is_active]),
}


def _section_error(code: ErrorCode, message: str) -> HTTPException:
    return HTTPException(
        status_code=422,
        detail=ErrorDetail(code=code, message=message).model_dump(),
    )


_SECTION_ERRORS: tuple[type[Exception], ...] = (
    SpecialtyRequiredError,
    ColorRequiredError,
    PositionNotFoundError,
    PositionIsSystemError,
    PasswordPolicyError,
    PhoneTakenError,
    PhoneInvalidError,
)


def _map_domain_error(exc: Exception) -> HTTPException:
    """Domain error → its 422 ErrorDetail (spec «Контракты ошибок»)."""
    if isinstance(exc, SpecialtyRequiredError):
        return _section_error(
            ErrorCode.SPECIALTY_REQUIRED, "Укажите специальность мастера"
        )
    if isinstance(exc, ColorRequiredError):
        return _section_error(ErrorCode.COLOR_REQUIRED, "Укажите цвет мастера")
    if isinstance(exc, PositionNotFoundError):
        return _section_error(
            ErrorCode.POSITION_NOT_FOUND, "Должность не найдена"
        )
    if isinstance(exc, PositionIsSystemError):
        return _section_error(
            ErrorCode.POSITION_IS_SYSTEM, "Встроенная должность не удаляется"
        )
    if isinstance(exc, PasswordPolicyError):
        return _section_error(ErrorCode.PASSWORD_POLICY, str(exc))
    if isinstance(exc, PhoneTakenError):
        return _section_error(ErrorCode.PHONE_TAKEN, str(exc))
    if isinstance(exc, PhoneInvalidError):
        return _section_error(ErrorCode.PHONE_INVALID, str(exc))
    return _section_error(ErrorCode.VALIDATION_ERROR, str(exc))


@router.get(
    "",
    response_model=PaginatedResponse[StaffResponse],
    dependencies=_READ_GUARD,
)
async def list_staff(
    service: _ServiceDep,
    session: SessionDep,
    pagination: PaginationParams = Depends(),
    status: ArchiveStatus = Query(ArchiveStatus.ACTIVE),
    sort_by: StaffSortBy | None = Query(None),
    sort_order: SortOrder = Query("asc"),
    q: str | None = Query(None, min_length=2, max_length=100),
) -> PaginatedResponse[StaffResponse]:
    """Paginated staff list (GH #205 contract, moved from /masters).

    ``status``: active (default) | archived | all. ``sort_by`` whitelist:
    name, specialty, color, avatar, status — position EXCLUDED (M2M);
    specialty/color sort via the masters extension with NULLs last.
    ``q`` (GH #212): substring on first_name/last_name (each separately)
    or exact id on a full UUID.
    """
    # Explicit annotation: the two branches produce different list types
    # (literals vs ``apply_sort``), the bare join would degrade to
    # ``list[object]`` and fail the typed service signatures downstream.
    order_by: list[SortExpr]
    if sort_by is None:
        # Spec §4.3: entity fallback, never passed to the resolver;
        # ``sort_order`` is IGNORED without an explicit sort_by (as before).
        order_by = [asc(Staff.sort_order), asc(Staff.first_name), asc(Staff.id)]
    else:
        order_by = apply_sort(_STAFF_SORT_KEYS, sort_by, sort_order, Staff.id)
    if sort_by in ("specialty", "color"):
        # Extension sort needs the join so NULL cards (no master section)
        # stay in the result set while sorting after sectioned ones.
        return await service.list_join_masters(
            db_session=session,
            page=pagination.page,
            per_page=pagination.per_page,
            status=status,
            q=q,
            order_by=order_by,
        )
    return await service.list(
        db_session=session,
        page=pagination.page,
        per_page=pagination.per_page,
        status=status,
        q=q,
        order_by=order_by,
    )


@router.get("/all", response_model=list[StaffResponse], dependencies=_READ_GUARD)
async def list_all_staff(
    service: _ServiceDep,
    session: SessionDep,
    status: ArchiveStatus = Query(ArchiveStatus.ACTIVE),
) -> list[StaffResponse]:
    """Bare array of staff cards (GH #205), capped by ``BARE_LIST_MAX_ROWS``.

    Sorted by ``sort_order ASC, first_name ASC, id ASC``; ``status``
    mirrors the paginated list (active default / archived / all).
    """
    try:
        return await service.list_all(
            db_session=session,
            status=status,
            order_by=[asc(Staff.sort_order), asc(Staff.first_name), asc(Staff.id)],
        )
    except BareListLimitExceededError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get(
    "/{staff_id}", response_model=StaffResponse, dependencies=_READ_GUARD
)
async def get_staff(
    staff_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> StaffResponse:
    """Return a single staff card by ID (including archived people)."""
    staff = await service.get(db_session=session, id=staff_id)
    if not staff:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.STAFF_NOT_FOUND,
                message="Сотрудник не найден",
            ).model_dump(),
        )
    return staff


@router.post("", response_model=StaffResponse, status_code=201, dependencies=_WRITE_GUARD)
async def create_staff(
    data: StaffCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> StaffResponse:
    """Create a staff card (+ optional master section, positions, account).

    One transaction (spec D5): staff row + masters extension +
    staff_positions links + the optional user account are written
    atomically. Domain validation errors (missing specialty/color,
    unknown position, password policy) → 422 with their codes.

    Corridor 2 (GH #326 Task 3): the composite chain lives in the
    usecases layer — the route stays transport-only. Leading ``None`` =
    the @transactional wrapper's unused self slot (selfless-function
    convention).
    """
    try:
        # Selfless-scenario convention (usecases/records.py): the leading
        # None fills the @transactional wrapper's unused ``self`` slot.
        return await create_staff_scenario(  # type: ignore[misc]
            None,  # type: ignore[arg-type]
            db_session=session,
            data=data,
        )
    except _SECTION_ERRORS as exc:
        raise _map_domain_error(exc) from exc


@router.put("/{staff_id}", response_model=StaffResponse, dependencies=_WRITE_GUARD)
async def update_staff(
    staff_id: str,
    data: StaffUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> StaffResponse:
    """Full-update a staff card (PUT): card + master section + positions.

    ``master: null`` removes the section (blocked while activities exist,
    D7). ``position_ids`` is a full replace. One transaction.

    Corridor 2 (GH #326 Task 3): the chain lives in the usecases layer
    (selfless scenario, keyword args — the records-route convention).
    """
    try:
        # Selfless-scenario convention (usecases/records.py): the leading
        # None fills the @transactional wrapper's unused ``self`` slot.
        staff = await update_staff_scenario(  # type: ignore[misc]
            None,  # type: ignore[arg-type]
            db_session=session,
            id=staff_id,
            data=data,
        )
    except _SECTION_ERRORS as exc:
        raise _map_domain_error(exc) from exc
    except ResolutionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not staff:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.STAFF_NOT_FOUND,
                message="Сотрудник не найден",
            ).model_dump(),
        )
    return staff


@router.patch("/{staff_id}", response_model=StaffResponse, dependencies=_WRITE_GUARD)
async def patch_staff(
    staff_id: str,
    data: StaffPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> StaffResponse:
    """Partial-update a staff card (PATCH) — only sent keys apply.

    ``master`` is three-state: absent = keep; ``null`` = remove (D7 block);
    payload = upsert. ``position_ids`` replaces the set when sent.

    Corridor 2 (GH #326 Task 3): same convention as PUT above.
    """
    try:
        # Selfless-scenario convention — see POST above.
        staff = await patch_staff_scenario(  # type: ignore[misc]
            None,  # type: ignore[arg-type]
            db_session=session,
            id=staff_id,
            data=data,
        )
    except _SECTION_ERRORS as exc:
        raise _map_domain_error(exc) from exc
    except ResolutionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not staff:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.STAFF_NOT_FOUND,
                message="Сотрудник не найден",
            ).model_dump(),
        )
    return staff


@router.delete("/{staff_id}", status_code=204, dependencies=_WRITE_GUARD)
async def delete_staff(
    staff_id: str,
    service: _ServiceDep,
    session: SessionDep,
    body: Annotated[StaffDeleteBody | None, Body()] = None,
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
    (GH #345 §4.1, one-to-one mirror of the tags route / #318 D2 and the
    records transport / #285 rev7-rev9).

    The legacy no-body DELETE (execute-if-clean / silent dry-run) is
    REMOVED. Staff deps per the FK matrix: ``activities`` (blocked,
    NON-auto — joined via the masters extension row; the race gate: its
    id-set joins the expected check even though the node is never
    confirmed), plus 4 AUTO deps (users, masters, master_tags,
    staff_positions — resolved automatically, exempt from the check).

    * ``?dry_run=true`` — PURE preview (never touches rows, no SSE):
      existence probe → missing → 404; present →
      ``collect_dependencies`` → empty → 204 WITHOUT deleting;
      non-empty → 409 + dependency tree. Combined with a
      ``resolutions`` body → 422
      ``dry_run_with_resolutions_forbidden`` (checked before the
      existence probe); an expected-only body is silently ignored.
    * No body, no flag → 422 ``{"detail": "expected_state_required"}``:
      every real deletion must declare its state; rejected before any
      DB access — the form check precedes the probe, so an unknown id
      still gets 422, not 404. Same for a body whose ``expected`` is
      absent (``{"resolutions": {...}}`` alone — the rejected legacy
      shape).
    * Body ``{resolutions?, expected}`` — the deferred-delete commit.
      The ROUTE is transport only (spec §4.5): the subset verification
      AND execution live INSIDE the ``delete_staff`` scenario's
      ``@transactional`` transaction (the ``delete_record`` mirror —
      one transaction for the verification + the cascade); this route
      maps ``StaleDependenciesError`` → 409 ``stale_dependencies`` +
      current tree, ``ResolutionError`` → 422 (blocked activities →
      422 "archive instead"), missing id → 404 ``STAFF_NOT_FOUND``,
      success → 204.

    Per the §4.4 matrix a successful commit with ``resolutions`` is
    unreachable for Staff (activities is blocked, the rest are auto) —
    the branch is still honored in full: it is the contract for API
    consumers and mid-window races.
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
    card = await service.get(db_session=session, id=staff_id)
    if not card:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.STAFF_NOT_FOUND,
                message="Сотрудник не найден",
            ).model_dump(),
        )

    if dry_run:
        deps = await collect_dependencies(session, Staff, staff_id)
        if deps:
            return _dependencies_response(deps, detail="has_dependencies")
        return  # 204 — preview only: no resolve_delete, no SSE marks.

    # Body branch: the commit of the deferred delete — the business
    # chain lives in the usecases scenario (spec §4.5): ONE
    # @transactional transaction owns BOTH the expected subset
    # verification and the execution (the ``delete_record`` mirror,
    # unlike the session-request routers of the dictionary entities);
    # the ROUTE keeps only transport — the 409 stale_dependencies
    # rendering, the 422 mapping, and 404.
    try:
        ok = await delete_staff_scenario(  # type: ignore[misc]
            None,  # type: ignore[arg-type]
            db_session=session,
            id=staff_id,
            resolutions=resolutions or {},
            expected=expected,
        )
    except StaleDependenciesError as exc:
        return _dependencies_response(exc.nodes, detail="stale_dependencies")
    except ResolutionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.STAFF_NOT_FOUND,
                message="Сотрудник не найден",
            ).model_dump(),
        )


def _dependencies_response(deps: list, detail: str) -> JSONResponse:
    """The unified 409 preview payload: ``{detail, dependencies}``.

    Mirror of the tags/records/activities routes' builder (#285/#286/
    #318; same pinned shape). ``detail`` distinguishes the two 409s of
    the deferred-delete contract (GH #345 §4.1): ``has_dependencies``
    (dry-run preview) and ``stale_dependencies`` (commit-time expected
    mismatch — rendered here from the ``StaleDependenciesError`` nodes
    the scenario raised inside its transaction). The ``dependencies``
    array is ``DependencyNode`` dumps — optional-None node fields are
    OMITTED (``exclude_none``), non-optional fields always serialize
    (the Staff tree shows counters for all deps; items stay absent —
    §4.3 fixed boundary).
    """
    return JSONResponse(
        status_code=409,
        content={
            "detail": detail,
            "dependencies": [d.model_dump(exclude_none=True) for d in deps],
        },
    )


@router.post("/{staff_id}/archive", response_model=StaffResponse, dependencies=_WRITE_GUARD)
async def archive_staff(
    staff_id: str,
    service: _ServiceDep,
    session: SessionDep,
    checkboxes: StaffArchiveRequest | None = None,
) -> StaffResponse:
    """Archive the person + apply the D6 dismissal checkboxes.

    Body ``{archive_master, archive_user}`` (both default ``true`` — the
    preselected dialog state). Checkboxes apply ONLY to existing ACTIVE
    links; an unchecked link keeps its flag (D3 — no hidden cascades).
    Returns 200 with the re-fetched card (``archived: true``).

    Corridor 2 (GH #326 Task 3): the dismissal chain lives in the
    ``archive_staff`` scenario (usecases).
    """
    ok = await archive_staff_scenario(  # type: ignore[misc]
        None,  # type: ignore[arg-type]
        db_session=session,
        id=staff_id,
        archive_master=(checkboxes.archive_master if checkboxes else True),
        archive_user=(checkboxes.archive_user if checkboxes else True),
    )
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.STAFF_NOT_FOUND,
                message="Сотрудник не найден",
            ).model_dump(),
        )
    return await _refetch_or_404(service, session, staff_id)


@router.post("/{staff_id}/restore", response_model=StaffResponse, dependencies=_WRITE_GUARD)
async def restore_staff(
    staff_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> StaffResponse:
    """Restore the PERSON only (master/user flags are explicit toggles).

    Returns 200 with the re-fetched card (``archived: false``). Idempotent.
    """
    ok = await service.restore(db_session=session, id=staff_id)
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.STAFF_NOT_FOUND,
                message="Сотрудник не найден",
            ).model_dump(),
        )
    return await _refetch_or_404(service, session, staff_id)


async def _refetch_or_404(
    service: StaffService, session: SessionDep, staff_id: str
) -> StaffResponse:
    """Re-fetch the card after a successful archive/restore (200-with-body)."""
    staff = await service.get(db_session=session, id=staff_id)
    if staff is None:
        # Defensive: archive/restore are soft — the row must still exist.
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.STAFF_NOT_FOUND,
                message="Сотрудник не найден",
            ).model_dump(),
        )
    return staff
