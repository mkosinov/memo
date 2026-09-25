"""Read-only masters view — free functions (GH #266 T4, D8; GH #217 Task 2).

Thin view module over ``staff`` ⨝ ``masters`` (plan File Structure:
``services/master.py`` is the read-only masters view — the old masters
CRUD service is gone, the composite :class:`StaffService` owns all
writes). Serves the D8 wire shape: ``id`` = staff_id, names, specialty,
color, ``avatar_url``, ``sort_order``, ``archived`` (GH #267).

GH #217 Task 2 (ADR 007 / canon rule 8, corridor 3): the former
``MasterViewService`` class was disbanded into two module-level free
functions — no class, no cached factories:

- ``list_masters_view`` — paginated page riding the repository list
  mechanics (``BaseRepository.list_custom``: statement WITHOUT baked
  order/limit, order arrives as a parameter; count over the statement
  subquery is equivalent to the former handwritten INNER-JOIN count —
  the join is one-to-one, pinned by a dedicated test);
- ``list_all_masters_view`` — flat ``/all`` array with the
  function-side ``BARE_LIST_MAX_ROWS + 1`` probe (GH #205 — the list
  mechanics provide no such guard) raising
  :class:`BareListLimitExceededError`.

Archive statuses (#267: active/archived/all) are a parameter of BOTH
functions.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from sqlalchemy import select

from src.domain.errors import BareListLimitExceededError
from src.models.enums import ArchiveStatus
from src.models.master import Master
from src.models.staff import Staff
from src.repositories.generic import get_base_repository
from src.repositories.search import ids_in_predicate
from src.schemas.common import PaginatedResponse
from src.schemas.master import MasterViewResponse
from src.services.generic import BARE_LIST_MAX_ROWS

if TYPE_CHECKING:
    from collections.abc import Sequence
    from datetime import datetime
    from typing import Any
    from uuid import UUID

    from sqlalchemy import ColumnElement, Select
    from sqlalchemy.ext.asyncio import AsyncSession


@dataclass
class _MasterViewRow:
    """Attribute glue: staff row + master extension → view wire shape."""

    id: str
    first_name: str
    last_name: str
    specialty: str
    color: str
    avatar_url: str | None
    sort_order: int
    archived: bool
    created_at: datetime
    updated_at: datetime

    @classmethod
    def build(cls, staff: Staff, ext: Master) -> _MasterViewRow:
        return cls(
            id=staff.id,
            first_name=staff.first_name,
            last_name=staff.last_name,
            specialty=ext.specialty,
            color=ext.color,
            avatar_url=staff.avatar_url,
            sort_order=staff.sort_order,
            archived=not ext.is_active,
            created_at=staff.created_at,
            updated_at=staff.updated_at,
        )


def _view_stmt(
    status: ArchiveStatus, ids: Sequence[UUID] | None = None,
) -> Select[tuple[Staff, Master]]:
    """staff INNER JOIN masters filtered by archive status — no baked
    order/limit (the ``list_custom`` precondition: ordering and slicing
    are owned by the caller).

    GH #232 §3.1: ``ids`` narrows by the VIEW identity (``id`` on the
    wire = ``staff_id``) via the shared one-line helper — the scope
    predicate (archive status) stays BEFORE it.
    """
    stmt = select(Staff, Master).join(Master, Master.staff_id == Staff.id)
    if status is ArchiveStatus.ACTIVE:
        stmt = stmt.where(Master.is_active.is_(True))
    elif status is ArchiveStatus.ARCHIVED:
        stmt = stmt.where(Master.is_active.is_(False))
    # ALL → no archive filter.
    id_pred = ids_in_predicate(Staff.id, ids)
    if id_pred is not None:
        stmt = stmt.where(id_pred)
    return stmt


def _to_response(row: Any) -> MasterViewResponse:
    """Row tuple (staff, master extension) → view wire shape."""
    return MasterViewResponse.model_validate(_MasterViewRow.build(row[0], row[1]))


async def list_masters_view(
    db_session: AsyncSession,
    page: int = 1,
    per_page: int = 20,
    order_by: Sequence[ColumnElement[Any]] | None = None,
    status: ArchiveStatus = ArchiveStatus.ACTIVE,
    ids: Sequence[UUID] | None = None,
) -> PaginatedResponse[MasterViewResponse]:
    """Paginated masters view (GH #205 envelope; acting-only default).

    Corridor 3 free function (GH #217 Task 2, ADR 007 execution-path
    rule — "page of rows + total" rides the repository list mechanics):
    ``list_custom`` counts over the statement subquery and applies the
    order/limit/offset. The subquery count equals the former handwritten
    ``func.count() over Staff INNER JOIN Master`` because the join is
    one-to-one (``masters.staff_id`` is the PK — no row duplication);
    pinned by the equivalence test in ``test_service_master_view.py``.

    ``status`` (GH #267: active default / archived / all) survives as a
    parameter; the public GET /masters route keeps the acting-only
    default. ``ids`` (GH #232 §3.1) is the typed ``?id=`` set narrowing
    by the view identity (staff_id) — carried into the statement BEFORE
    ``list_custom`` so the subquery count and the page fetch stay honest.
    """
    rows, total = await get_base_repository().list_custom(
        db_session,
        _view_stmt(status, ids),
        order_by=order_by,
        limit=per_page,
        offset=(page - 1) * per_page,
    )
    return PaginatedResponse(
        items=[_to_response(row) for row in rows],
        total=total,
        page=page,
        per_page=per_page,
    )


async def list_all_masters_view(
    db_session: AsyncSession,
    order_by: Sequence[ColumnElement[Any]] | None = None,
    status: ArchiveStatus = ArchiveStatus.ACTIVE,
) -> list[MasterViewResponse]:
    """Bare /all array with the BARE_LIST_MAX_ROWS guard (GH #205).

    Corridor 3 free function (GH #217 Task 2): the flat list executes
    directly on the session — the limit mechanics provide no bare-list
    guard, so the ``BARE_LIST_MAX_ROWS + 1`` probe and the
    :class:`BareListLimitExceededError` raise stay FUNCTION-side.
    ``status`` (GH #267): active (default) / archived / all.
    """
    stmt = _view_stmt(status)
    if order_by is not None:
        stmt = stmt.order_by(*order_by)
    stmt = stmt.limit(BARE_LIST_MAX_ROWS + 1)
    rows = (await db_session.execute(stmt)).all()
    if len(rows) > BARE_LIST_MAX_ROWS:
        # Guard's documented assumption: router prefix == table name
        # (``/api/v1/masters`` — the view's own prefix; passing
        # ``Staff.__tablename__`` would misdirect to /api/v1/staff).
        raise BareListLimitExceededError("masters", BARE_LIST_MAX_ROWS)
    return [_to_response(row) for row in rows]
