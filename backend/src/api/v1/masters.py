"""FastAPI router for the read-only masters view (GH #266 T4, D8).

``/api/v1/masters`` is now a VIEW over ``staff`` ⨝ ``masters`` serving the
acting masters only (``masters.is_active = true``): schedule filters and
the client site (#48). Fields: ``id`` (= staff_id), names, specialty,
color, ``avatar_url``, ``sort_order``. Mutations, ``GET /{id}`` and
``PUT /reorder`` are REMOVED (no consumers — the staff card owns writes).

GH #217 Task 2 (ADR 007, corridor 3): the handlers call the module-level
free functions ``list_masters_view`` / ``list_all_masters_view`` directly
with the session as an argument — no service dependency, no cached
factories (the former ``_get_master_view_service`` / ``_ServiceDep`` are
gone with the class).
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import ColumnElement, asc

from src.auth.permissions import require_permission
from src.db import SessionDep
from src.domain.errors import BareListLimitExceededError
from src.models.enums import ArchiveStatus
from src.models.staff import Staff
from src.schemas.common import PaginatedResponse
from src.schemas.master import MasterViewResponse
from src.schemas.pagination import PaginationParams
from src.services.master import list_all_masters_view, list_masters_view

router = APIRouter(tags=["masters"])

# Default order of the read-only view (GH #205 §4.4 read side):
# ``sort_order ASC, first_name ASC, id ASC`` — all staff-table columns.
_DEFAULT_ORDER: list[ColumnElement[Any]] = [
    asc(Staff.sort_order), asc(Staff.first_name), asc(Staff.id),
]

# GH #247 (spec §3.7): the paginated list stays PUBLIC (PUBLIC_ROUTES —
# schedule + client site); the private bare /all carries masters:read.
_READ_GUARD = [Depends(require_permission("masters:read"))]


@router.get("", response_model=PaginatedResponse[MasterViewResponse])
async def list_masters(
    session: SessionDep,
    # Annotated[..., Query()], not Depends(): FastAPI classifies list-typed
    # model fields (``id`` #232) as BODY params under the Depends-with-model
    # shape and silently drops them from the query contract; the Query()
    # shape exposes them (precedent: clients/records/photos). Safe here —
    # no scalar query params in this handler (fastapi PR #12481).
    pagination: Annotated[PaginationParams, Query()],
) -> PaginatedResponse[MasterViewResponse]:
    """Return the ACTING masters (``masters.is_active = true``), paginated.

    Default order: ``sort_order ASC, first_name ASC, id ASC`` (GH #205
    list contract, read side). Archived-master rows disappear from the
    list while their history keeps its names/colors (records snapshot).
    ``?id=`` (GH #232 §3.1) narrows by the view identity (staff_id).
    """
    return await list_masters_view(
        db_session=session,
        page=pagination.page,
        per_page=pagination.per_page,
        order_by=_DEFAULT_ORDER,
        ids=pagination.id,
    )


@router.get("/all", response_model=list[MasterViewResponse], dependencies=_READ_GUARD)
async def list_all_masters(
    session: SessionDep,
    status: ArchiveStatus = Query(ArchiveStatus.ACTIVE),
) -> list[MasterViewResponse]:
    """Bare array of masters (GH #205), capped by BARE_LIST_MAX_ROWS.

    Sorted by ``sort_order ASC, first_name ASC, id ASC``. ``status``
    (GH #267): ``active`` (default) / ``archived`` / ``all`` — same
    contract as the locations/services dictionaries; invalid values →
    422 via FastAPI's enum validation.

    Default (active) serves the dropdowns (activity/record master
    pickers — S4: only acting masters); archived/all serve the schedule
    visibility of archived entities (GH #267).
    """
    try:
        return await list_all_masters_view(
            db_session=session,
            order_by=_DEFAULT_ORDER,
            status=status,
        )
    except BareListLimitExceededError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
