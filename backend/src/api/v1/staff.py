"""FastAPI router for the staff directory (GH #266 T4, spec «API (после)»).

Full CRUD over the composite staff card (service = composite
:class:`StaffService`): paginated list with the GH #205 contract (status /
q / sort_by whitelist WITHOUT ``position`` — M2M is ambiguous; specialty
and color sort through a LEFT JOIN on the masters extension, NULLs last),
bare ``/all``, get (including archived), create (D6 flags), atomic
PUT/PATCH, DELETE with the GH #207 dependency-resolution contract, and
D6-checkbox archive/restore. ``PUT /reorder`` is NOT carried over from the
old masters router (no consumers; ``sort_order`` stays the default-order
column).
"""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import asc, nullslast

from src.auth.passwords import PasswordPolicyError
from src.auth.permissions import require_permission, verify_fetch_metadata
from src.db import SessionDep
from src.domain.deletion import ResolutionError, collect_dependencies
from src.domain.errors import (
    BareListLimitExceededError,
    ColorRequiredError,
    PositionIsSystemError,
    PositionNotFoundError,
    SpecialtyRequiredError,
)
from src.errors import ErrorCode, ErrorDetail
from src.models.enums import ArchiveStatus
from src.models.master import Master
from src.models.staff import Staff
from src.schemas.common import PaginatedResponse, SortOrder
from src.schemas.pagination import PaginationParams
from src.schemas.staff import (
    StaffArchiveRequest,
    StaffCreate,
    StaffPatch,
    StaffResponse,
    StaffSortBy,
    StaffUpdate,
)
from src.services.staff import StaffService, get_staff_service

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

# Sort whitelist map: UI key → ORM columns (domain-rules/staff.md «List
# contract»). ``position`` is EXCLUDED (M2M, ambiguous). specialty/color
# live on the masters extension → NULLs LAST in BOTH directions (a card
# without the master section always sorts after sectioned ones).
_STAFF_SORT_MAP: dict[str, list] = {
    "name": [Staff.first_name, Staff.last_name],
    "specialty": [Master.specialty],
    "color": [Master.color],
    "avatar": [Staff.avatar_url],
    "status": [Staff.is_active],
}


def _staff_order_by(sort_by: StaffSortBy | None, sort_order: SortOrder) -> list:
    """Build the ``order_by`` list for GET /api/v1/staff.

    * ``sort_by=None`` → default: ``sort_order ASC, first_name ASC, id ASC``.
    * ``name``/``avatar``/``status`` → staff columns (records idiom:
      nulls-first asc / nulls-last desc, ``id ASC`` tiebreak).
    * ``specialty``/``color`` → masters-extension columns; a LEFT JOIN in
      the list query supplies them. NULLs (no master section) go LAST in
      BOTH directions (spec: «пустые — в конце»).
    """
    if sort_by is None:
        return [asc(Staff.sort_order), asc(Staff.first_name), asc(Staff.id)]
    cols = _STAFF_SORT_MAP[sort_by]
    if sort_by in ("specialty", "color"):
        ordered = [
            c.desc().nullslast() if sort_order == "desc" else nullslast(c.asc())
            for c in cols
        ]
    else:
        ordered = [
            c.desc().nullslast() if sort_order == "desc" else c.asc().nullsfirst()
            for c in cols
        ]
    return [*ordered, asc(Staff.id)]


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
    order_by = _staff_order_by(sort_by, sort_order)
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
    """
    try:
        return await service.create(db_session=session, data=data)
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
    """
    try:
        staff = await service.update(db_session=session, id=staff_id, data=data)
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
    """
    try:
        staff = await service.patch(db_session=session, id=staff_id, data=data)
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
    resolutions: dict[str, str] | None = Body(default=None, embed=True),
) -> None:
    """Unified DELETE — dry-run (no body) or execute (with body), GH #207.

    * No body: ``collect_dependencies`` → empty → hard delete (204);
      non-empty → 409 + dependency tree (no rows modified).
    * With body ``{"resolutions": {...}}``: run the resolution transaction
      → 204; ``ResolutionError`` → 422 (activities block); missing → 404.

    Deletion matrix (domain-rules/staff.md): activities BLOCK; the masters
    extension row, users, master_tags and staff_positions auto-cascade.
    """
    if resolutions is not None:
        try:
            ok = await service.resolve_delete(
                db_session=session, id=staff_id, resolutions=resolutions
            )
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
        return

    deps = await collect_dependencies(session, Staff, staff_id)
    if deps:
        return JSONResponse(
            status_code=409,
            content={
                "detail": "has_dependencies",
                "dependencies": [d.model_dump() for d in deps],
            },
        )
    deleted = await service.delete(db_session=session, id=staff_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.STAFF_NOT_FOUND,
                message="Сотрудник не найден",
            ).model_dump(),
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
    """
    ok = await service.archive(
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
