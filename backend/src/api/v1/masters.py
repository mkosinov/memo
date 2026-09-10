"""FastAPI router for master CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import asc

from src.auth.permissions import require_permission, verify_fetch_metadata
from src.db import SessionDep
from src.domain.deletion import ResolutionError, collect_dependencies
from src.domain.errors import BareListLimitExceededError
from src.errors import ErrorCode, ErrorDetail
from src.models.enums import ArchiveStatus
from src.models.master import Master
from src.schemas.common import PaginatedResponse, SortOrder
from src.schemas.master import (
    MasterCreate,
    MasterPatch,
    MasterResponse,
    MasterSortBy,
    MasterUpdate,
    ReorderRequest,
)
from src.schemas.pagination import PaginationParams
from src.services.master import MasterService, get_master_service

router = APIRouter(tags=["masters"])


@lru_cache
def _get_master_service() -> MasterService:
    """Dependency factory returning a singleton MasterService."""
    return get_master_service()


_ServiceDep = Annotated[MasterService, Depends(_get_master_service)]

# Sort whitelist map: UI key → list of ORM columns (#205 Task 3, spec §4.5).
# Composite UI columns map to multiple DB columns. ``avatar`` → avatar_url;
# ``status`` → is_active (asc = is_active ASC = archived-first, preserving
# the old client boolean-sort semantics).
_MASTER_SORT_MAP: dict[str, list] = {
    "name": [Master.first_name, Master.last_name],
    "specialty": [Master.specialty],
    "position": [Master.position],
    "color": [Master.color],
    "avatar": [Master.avatar_url],
    "status": [Master.is_active],
}


def _master_order_by(sort_by: MasterSortBy | None, sort_order: SortOrder) -> list:
    """Build the ``order_by`` list for GET /api/v1/masters.

    * ``sort_by=None`` → spec §4.4 default: ``sort_order ASC, first_name ASC, id ASC``.
    * User sort → mapped columns with nulls-first (asc) / nulls-last (desc),
      then ``id ASC`` tiebreak for cross-page stability (records idiom).
    """
    if sort_by is None:
        return [asc(Master.sort_order), asc(Master.first_name), asc(Master.id)]
    cols = _MASTER_SORT_MAP[sort_by]
    ordered = [
        c.desc().nullslast() if sort_order == "desc" else c.asc().nullsfirst()
        for c in cols
    ]
    return [*ordered, asc(Master.id)]


@router.get("", response_model=PaginatedResponse[MasterResponse])
async def list_masters(
    service: _ServiceDep,
    session: SessionDep,
    pagination: PaginationParams = Depends(),
    status: ArchiveStatus = Query(ArchiveStatus.ACTIVE),
    sort_by: MasterSortBy | None = Query(None),
    sort_order: SortOrder = Query("asc"),
    q: str | None = Query(None, min_length=2, max_length=100),
) -> PaginatedResponse[MasterResponse]:
    """Return masters filtered by archive status (default: active),
    sorted by sort_order, then name.

    ``status`` accepts ``active`` (default), ``archived``, or ``all`` — see
    ``ArchiveStatus``. Invalid values are rejected with 422 by FastAPI's
    enum validation.

    ``sort_by`` selects a whitelisted sort key (spec §4.5); ``sort_order``
    is ``asc`` (default) or ``desc``. Unknown ``sort_by`` → 422 via Literal
    validation. ``sort_by=None`` → spec §4.4 default order with ``id ASC``
    tiebreak.

    ``q`` (GH #212): case-insensitive substring on ``first_name`` OR
    ``last_name`` (separate fields, no concatenation) OR exact id equality
    for a full UUID; ``total`` reflects the filtered count. len<2 / len>100
    → 422 VALIDATION_ERROR.
    """
    return await service.list(
        db_session=session,
        page=pagination.page,
        per_page=pagination.per_page,
        status=status,
        order_by=_master_order_by(sort_by, sort_order),
        q=q,
    )


@router.get(
    "/all",
    response_model=list[MasterResponse],
    dependencies=[Depends(require_permission("masters:read"))],
)
async def list_all_masters(
    service: _ServiceDep,
    session: SessionDep,
    status: ArchiveStatus = Query(ArchiveStatus.ACTIVE),
) -> list[MasterResponse]:
    """Return all masters as a bare JSON array (GH #205).

    Unpaginated, capped by ``BARE_LIST_MAX_ROWS`` (1000). Sorted by
    ``sort_order ASC, first_name ASC, id ASC`` (spec §4.4). ``status``
    mirrors the paginated list endpoint (active default / archived / all).
    """
    try:
        return await service.list_all(
            db_session=session,
            status=status,
            order_by=[asc(Master.sort_order), asc(Master.first_name), asc(Master.id)],
        )
    except BareListLimitExceededError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


# GH #247 (spec §3.7): public GET list/detail (PUBLIC_ROUTES) stay bare;
# everything else is guarded — decorator-level ``masters:read`` for the
# private bare-list GET, ``masters:write`` + ``verify_fetch_metadata`` for
# every mutating route.
_WRITE_GUARD = [
    Depends(require_permission("masters:write")),
    Depends(verify_fetch_metadata),
]


@router.put(
    "/reorder",
    response_model=list[MasterResponse],
    dependencies=_WRITE_GUARD,
)
async def reorder_masters(
    data: ReorderRequest,
    service: _ServiceDep,
    session: SessionDep,
) -> list[MasterResponse]:
    """Reorder masters by assigning sort_order from the provided ID list."""
    return await service.reorder(db_session=session, ids=data.ids)


@router.get("/{master_id}", response_model=MasterResponse)
async def get_master(
    master_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> MasterResponse:
    """Return a single master by ID."""
    master = await service.get(db_session=session, id=master_id)
    if not master:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MASTER_NOT_FOUND,
                message="Master not found",
            ).model_dump(),
        )
    return master


@router.post("", response_model=MasterResponse, status_code=201, dependencies=_WRITE_GUARD)
async def create_master(
    data: MasterCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> MasterResponse:
    """Create a new master."""
    return await service.create(db_session=session, data=data)


@router.put("/{master_id}", response_model=MasterResponse, dependencies=_WRITE_GUARD)
async def update_master(
    master_id: str,
    data: MasterUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> MasterResponse:
    """Full-update a master by ID (PUT, not PATCH)."""
    master = await service.update(db_session=session, id=master_id, data=data)
    if not master:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MASTER_NOT_FOUND,
                message="Master not found",
            ).model_dump(),
        )
    return master


@router.patch("/{master_id}", response_model=MasterResponse, dependencies=_WRITE_GUARD)
async def patch_master(
    master_id: str,
    data: MasterPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> MasterResponse:
    """Partial-update a master by ID (PATCH)."""
    master = await service.patch(db_session=session, id=master_id, data=data)
    if not master:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MASTER_NOT_FOUND,
                message="Master not found",
            ).model_dump(),
        )
    return master


@router.delete("/{master_id}", status_code=204, dependencies=_WRITE_GUARD)
async def delete_master(
    master_id: str,
    service: _ServiceDep,
    session: SessionDep,
    resolutions: dict[str, str] | None = Body(default=None, embed=True),
) -> None:
    """Unified DELETE — dry-run (no body) or execute (with body). Spec §2/§5/§6.

    * No body (dry-run): ``collect_dependencies`` → empty → hard delete (204);
      non-empty → 409 + dependency tree (no rows modified).
    * With body (execute): ``{"resolutions": {...}}`` per spec §6 (§2 L24,
      §6 L161 — the ONLY accepted body form; the api-client ``resolveDeleteX``
      sends exactly this; ``embed=True`` rejects a bare dict as a dry-run
      shape). A wrapped empty ``{"resolutions": {}}`` still executes (S2 —
      all-auto deps). ``service.resolve_delete`` runs the resolution
      transaction (Task 10) → 204; ``ResolutionError`` → 422; missing → 404.
    """
    if resolutions is not None:
        try:
            ok = await service.resolve_delete(
                db_session=session, id=master_id, resolutions=resolutions
            )
        except ResolutionError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        if not ok:
            raise HTTPException(
                status_code=404,
                detail=ErrorDetail(
                    code=ErrorCode.MASTER_NOT_FOUND,
                    message="Master not found",
                ).model_dump(),
            )
        return

    deps = await collect_dependencies(session, Master, master_id)
    if deps:
        return JSONResponse(
            status_code=409,
            content={
                "detail": "has_dependencies",
                "dependencies": [d.model_dump() for d in deps],
            },
        )
    deleted = await service.delete(db_session=session, id=master_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MASTER_NOT_FOUND,
                message="Master not found",
            ).model_dump(),
        )


@router.post("/{master_id}/archive", response_model=MasterResponse, dependencies=_WRITE_GUARD)
async def archive_master(
    master_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> MasterResponse:
    """Archive a master — flip ``is_active=False`` (spec §2/§14).

    Returns HTTP **200 with the re-fetched body** (``archived: true`` computed
    in the schema) so the frontend updates the row without a refetch (spec §12
    S5: 200-with-body chosen over 204 for this reason — 204 carries no body).
    Idempotent: archiving an already-archived row → still 200 ``archived:true``.
    **Master-only cascade (§4.2, Change 3):** additionally writes the linked
    ``users.is_active=False`` in the same transaction (handled in
    ``MasterService.archive``).
    """
    ok = await service.archive(db_session=session, id=master_id)
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MASTER_NOT_FOUND,
                message="Master not found",
            ).model_dump(),
        )
    return await _refetch_or_404(service, session, master_id)


@router.post("/{master_id}/restore", response_model=MasterResponse, dependencies=_WRITE_GUARD)
async def restore_master(
    master_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> MasterResponse:
    """Restore an archived master — flip ``is_active=True`` (spec §2/§14).

    Returns HTTP **200 with the re-fetched body** (``archived: false``). 404 if
    not found. Idempotent. **Master-only cascade (§4.2, Change 3):** linked
    ``users.is_active=True`` in the same transaction.
    """
    ok = await service.restore(db_session=session, id=master_id)
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MASTER_NOT_FOUND,
                message="Master not found",
            ).model_dump(),
        )
    return await _refetch_or_404(service, session, master_id)


async def _refetch_or_404(
    service: MasterService, session: SessionDep, master_id: str
) -> MasterResponse:
    """Re-fetch the master after a successful archive/restore (Task 11).

    Archive/restore are soft ``is_active`` flips — the row persists. The route
    re-fetched via ``service.get`` so the response carries the updated
    ``archived`` computed field (spec §2: 200-with-body).
    """
    master = await service.get(db_session=session, id=master_id)
    if master is None:
        # Defensive: archive/restore are soft — the row must still exist.
        # Surface as 404 if it somehow vanished between the two calls.
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MASTER_NOT_FOUND,
                message="Master not found",
            ).model_dump(),
        )
    return master
