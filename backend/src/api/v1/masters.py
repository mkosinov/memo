"""FastAPI router for the read-only masters view (GH #266 T4, D8).

``/api/v1/masters`` is now a VIEW over ``staff`` ⨝ ``masters`` serving the
acting masters only (``masters.is_active = true``): schedule filters and
the client site (#48). Fields: ``id`` (= staff_id), names, specialty,
color, ``avatar_url``, ``sort_order``. Mutations, ``GET /{id}`` and
``PUT /reorder`` are REMOVED (no consumers — the staff card owns writes).
"""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import asc

from src.auth.permissions import require_permission
from src.db import SessionDep
from src.models.staff import Staff
from src.schemas.common import PaginatedResponse
from src.schemas.master import MasterViewResponse
from src.schemas.pagination import PaginationParams
from src.services.master import MasterViewService, get_master_view_service

router = APIRouter(tags=["masters"])

# Default order of the read-only view (GH #205 §4.4 read side):
# ``sort_order ASC, first_name ASC, id ASC`` — all staff-table columns.
_DEFAULT_ORDER = [asc(Staff.sort_order), asc(Staff.first_name), asc(Staff.id)]


@lru_cache
def _get_master_view_service() -> MasterViewService:
    """Dependency factory returning a singleton read-only view service."""
    return get_master_view_service()


_ServiceDep = Annotated[MasterViewService, Depends(_get_master_view_service)]

# GH #247 (spec §3.7): the paginated list stays PUBLIC (PUBLIC_ROUTES —
# schedule + client site); the private bare /all carries masters:read.
_READ_GUARD = [Depends(require_permission("masters:read"))]


@router.get("", response_model=PaginatedResponse[MasterViewResponse])
async def list_masters(
    service: _ServiceDep,
    session: SessionDep,
    pagination: PaginationParams = Depends(),
) -> PaginatedResponse[MasterViewResponse]:
    """Return the ACTING masters (``masters.is_active = true``), paginated.

    Default order: ``sort_order ASC, first_name ASC, id ASC`` (GH #205
    list contract, read side). Archived-master rows disappear from the
    list while their history keeps its names/colors (records snapshot).
    """
    return await service.list(
        db_session=session,
        page=pagination.page,
        per_page=pagination.per_page,
        order_by=_DEFAULT_ORDER,
    )


@router.get("/all", response_model=list[MasterViewResponse], dependencies=_READ_GUARD)
async def list_all_masters(
    service: _ServiceDep,
    session: SessionDep,
) -> list[MasterViewResponse]:
    """Bare array of ACTING masters (GH #205), capped by BARE_LIST_MAX_ROWS.

    Sorted by ``sort_order ASC, first_name ASC, id ASC``. Consumed by
    dropdowns (activity/record master pickers — S4: only acting masters).
    """
    return await service.list_all(
        db_session=session,
        order_by=_DEFAULT_ORDER,
    )
