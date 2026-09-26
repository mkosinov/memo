"""Masters view (reads) + the ``masters`` writing owner (GH #326 Task 2).

Two halves share this module:

* READS — the D8 wire-shape view (``id`` = staff_id, names, specialty,
  color, ``avatar_url``, ``sort_order``, ``archived``, GH #267) as thin
  free functions over ``staff`` ⨝ ``masters`` (GH #266 T4, D8): GH #217
  Task 2 (ADR 007 / canon rule 8, corridor 3) disbanded the former
  ``MasterViewService`` class into two module-level functions — no class,
  no cached factories:

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

* WRITES — :class:`MasterService`, the ``masters`` writing owner (GH #326
  Task 2; the module is no longer read-only). Standalone service
  (``entity_name = "masters"``, the ``VisitService`` /
  ``UserSettingsService`` / ``UserService`` precedent): every method is
  a SCENARIO BUILDING BLOCK — no ``@transactional`` (canon
  docs/domain-rules/service-layer.md rule 3), the session arrives as an
  argument, only ``flush()``; the usecases layer owns the transaction
  boundary. The semantics moved 1-to-1 from the ``StaffService``
  cascades (``_apply_master_section`` / ``archive`` — ``staff.py`` keeps
  its working copy until the Task 3 demolition): T8 ``archived`` flag
  handling, the D5 blank-section rule, the D7 activities block
  (``BlockingDepsError``), ``mark_changed`` by fact of change.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import TYPE_CHECKING, Any, cast

from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select, update

from src.domain.deletion import BlockingDepsError
from src.domain.errors import (
    BareListLimitExceededError,
    ColorRequiredError,
    SpecialtyRequiredError,
)
from src.events.emitter import mark_changed
from src.models.activity import Activity
from src.models.enums import ArchiveStatus
from src.models.master import Master
from src.models.staff import Staff
from src.repositories.generic import BaseRepository, get_base_repository
from src.repositories.search import ids_in_predicate
from src.schemas.common import PaginatedResponse
from src.schemas.master import MasterViewResponse
from src.services.generic import BARE_LIST_MAX_ROWS

if TYPE_CHECKING:
    from collections.abc import Sequence
    from datetime import datetime
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
    status: ArchiveStatus,
    ids: Sequence[UUID] | None = None,
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


# ─── writes: the ``masters`` owner (scenario building blocks) ───────────────


def _require_section_fields(specialty: str, color: str) -> None:
    """D5: a present master section must carry a non-blank specialty + color.

    Pydantic already rejects absent keys / empty strings / bad hex; the
    blank-whitespace case (``"   "``) is domain-level, checked here.
    Same rule as the ``StaffService`` working copy (Task 3 demolition).
    """
    if not specialty.strip():
        raise SpecialtyRequiredError()
    if not color.strip():
        raise ColorRequiredError()


class MasterService:
    """``masters`` owner — scenario building blocks, never commits."""

    # Standalone service (no GenericService ``_model``) — canonical entity
    # name declared explicitly (spec §3.3/§3.4).
    entity_name: str = "masters"

    def __init__(self, repository: BaseRepository) -> None:
        """Hold the shared ``BaseRepository`` (stateless, any model)."""
        self._repository: BaseRepository = repository

    async def upsert_extension(
        self,
        db_session: AsyncSession,
        staff_id: str,
        specialty: str,
        color: str,
        archived: bool | None = None,
    ) -> Master:
        """Create or update the masters extension row for *staff_id*.

        Today's T8 ``archived`` semantics (moved 1-to-1 from
        ``StaffService._apply_master_section``): ``None`` = don't touch
        the schedule flag (a new row still starts active — the model
        default); a value → ``is_active = not archived``. Archiving NEVER
        deletes the row (D7 — history keeps specialty/color; removal is
        the explicit :meth:`remove_extension` path). A written row is a
        fact → ``mark_changed("masters")`` unconditionally (both branches
        change the table). Flush, no commit.
        """
        _require_section_fields(specialty, color)
        ext = (
            await db_session.execute(select(Master).where(Master.staff_id == staff_id))
        ).scalar_one_or_none()
        if ext is None:
            ext = Master(
                staff_id=staff_id,
                specialty=specialty.strip(),
                color=color.strip(),
                **({"is_active": not archived} if archived is not None else {}),
            )
            db_session.add(ext)
            await db_session.flush()
        else:
            ext.specialty = specialty.strip()
            ext.color = color.strip()
            if archived is not None:
                ext.is_active = not archived
        mark_changed("masters")
        return ext

    async def remove_extension(self, db_session: AsyncSession, staff_id: str) -> None:
        """Delete the masters extension row (the explicit ``master: null``
        path), domain-blocked by activities (D7).

        No row → no-op (no spurious mark). A row with live activities →
        :class:`BlockingDepsError` (the 422 «archive it instead»
        semantics, same rule as the card hard-delete); the row survives.
        Flush, no commit.
        """
        ext = (
            await db_session.execute(select(Master).where(Master.staff_id == staff_id))
        ).scalar_one_or_none()
        if ext is None:
            return
        await self._assert_section_removable(db_session, staff_id)
        await db_session.execute(sa_delete(Master).where(Master.staff_id == staff_id))
        mark_changed("masters")

    async def archive_active_extension(self, db_session: AsyncSession, staff_id: str) -> int:
        """Deactivate the extension — ONLY if currently active.

        The D6 dismissal-checkbox semantics (moved 1-to-1 from
        ``StaffService.archive``): an already-archived row is untouched
        (an archive call never silently restores anything). Returns the
        rowcount; marks ``"masters"`` only when a row changed. Flush, no
        commit.
        """
        result = await db_session.execute(
            update(Master)
            .where(Master.staff_id == staff_id, Master.is_active)
            .values(is_active=False)
        )
        rowcount = int(cast("Any", result).rowcount)
        if rowcount:
            mark_changed("masters")
        return rowcount

    async def _assert_section_removable(self, db_session: AsyncSession, staff_id: str) -> None:
        """A masters row with activities cannot be removed (D7)."""
        count = (
            await db_session.execute(
                select(func.count()).select_from(Activity).where(Activity.master_id == staff_id)
            )
        ).scalar_one()
        if count:
            raise BlockingDepsError("Master section has activities — archive it instead")


@lru_cache
def get_master_service() -> MasterService:
    """Returns a singleton MasterService over the shared BaseRepository."""
    return MasterService(get_base_repository())
