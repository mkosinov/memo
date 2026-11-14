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
  functions. GH #599: ``specialty`` in the view is the DISPLAY STRING —
  the ``staff_specialties`` titles joined «, » alphabetically (same
  string the staff card carries; eager-loaded via
  ``selectinload(Staff.specialties)`` — no N+1).

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

  GH #599 Task 4: the section owns the direction SET —
  ``upsert_extension`` takes ``specialty_ids`` (hard-replace, the
  ``replace_positions`` pattern: dedup, >50 distinct → 422, unknown id →
  422, empty set on a live section → 422 ``SPECIALTY_REQUIRED`` — D5
  unchanged) and rewrites the ``staff_specialties`` links in the same
  flush; ``remove_extension`` clears the links too («без секции
  направлений нет»).
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import TYPE_CHECKING, Any, cast

from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select, update
from sqlalchemy.orm import selectinload

from src.domain.deletion import BlockingDepsError
from src.domain.errors import (
    BareListLimitExceededError,
    ColorRequiredError,
    SpecialtyNotFoundError,
    SpecialtyRequiredError,
    SpecialtySetTooLongError,
)
from src.events.emitter import mark_changed
from src.models.activity import Activity
from src.models.enums import ArchiveStatus
from src.models.master import Master
from src.models.specialty import Specialty, staff_specialties
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


#: Write-amplification guard for the master-section direction set
#: (GH #599 §4.4): >50 DISTINCT ids after dedup → 422.
SPECIALTY_SET_LIMIT = 50


def format_specialty_display(specialties: Sequence[Specialty]) -> str:
    """Linked directions → the display string: titles joined «, »
    alphabetically (plain codepoint sort — the established pattern; the
    sort expression ``string_agg(... ORDER BY title)`` builds the same
    string, SQLite BINARY ordering agrees with Python's)."""
    return ", ".join(sorted(s.title for s in specialties))


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
            # GH #599: the joined display string over the card's links
            # (eager-loaded — ``_view_stmt`` bakes the selectinload).
            specialty=format_specialty_display(staff.specialties),
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

    GH #599: the statement eager-loads the card's specialty links
    (``selectinload`` — ONE extra query per page, no N+1): the view's
    ``specialty`` string is the joined titles.
    """
    stmt = (
        select(Staff, Master)
        .join(Master, Master.staff_id == Staff.id)
        # populate_existing: CORE link writes must beat a stale
        # identity-map ``specialties`` collection.
        .options(selectinload(Staff.specialties)).execution_options(populate_existing=True)
    )
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


def _require_section_fields(specialty_ids: Sequence[str], color: str) -> None:
    """D5: a present master section must carry a non-empty specialty SET
    + color (GH #599 §4.4 — the CSV string became the M2M, the invariant
    is NOT weakened).

    Ids are UUID-validated by the schema and their EXISTENCE is checked
    separately (:meth:`MasterService._validate_specialty_ids`); the
    blank-whitespace color case stays domain-level, checked here.
    """
    if not specialty_ids:
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

    async def _validate_specialty_ids(
        self, db_session: AsyncSession, specialty_ids: Sequence[str]
    ) -> None:
        """Every sent specialty id must exist (the ``_validate_position_ids``
        pattern — SPECIALTY_NOT_FOUND else, never a raw FK IntegrityError)."""
        unique_ids = set(specialty_ids)
        rows = await db_session.execute(
            select(Specialty.id).where(Specialty.id.in_(unique_ids))
        )
        found = set(rows.scalars().all())
        for missing in sorted(unique_ids - found):
            raise SpecialtyNotFoundError(missing)

    async def _replace_specialty_links(
        self, db_session: AsyncSession, staff_id: str, specialty_ids: Sequence[str]
    ) -> None:
        """Full replace of the section's M2M set (delete-all + insert,
        same flush — the ``replace_positions`` mirror on the master side).

        Duplicates collapse to one row (composite PK). A replace is a
        fact → marks ``"staff_specialties"`` (the join-table wire name —
        consumers skip unknown entity names, the staff_positions
        precedent).
        """
        await db_session.execute(
            sa_delete(staff_specialties).where(
                staff_specialties.c.staff_id == staff_id
            )
        )
        for specialty_id in specialty_ids:
            await db_session.execute(
                staff_specialties.insert().values(
                    staff_id=staff_id, specialty_id=specialty_id
                )
            )
        mark_changed("staff_specialties")

    async def upsert_extension(
        self,
        db_session: AsyncSession,
        staff_id: str,
        specialty_ids: Sequence[str],
        color: str,
        archived: bool | None = None,
    ) -> Master:
        """Create or update the masters extension row for *staff_id* and
        hard-replace its specialty link set.

        GH #599 §4.4: ``specialty_ids`` — dedup first, >50 distinct after
        dedup → 422 (write-amplification guard), unknown id → 422
        (explicit prevalidation), empty set → ``SPECIALTY_REQUIRED``
        (D5, non-weakened — an upsert IS a live section).

        Today's T8 ``archived`` semantics (moved 1-to-1 from
        ``StaffService._apply_master_section``): ``None`` = don't touch
        the schedule flag (a new row still starts active — the model
        default); a value → ``is_active = not archived``. Archiving NEVER
        deletes the row (D7 — history keeps the directions/color;
        removal is the explicit :meth:`remove_extension` path). A written
        row is a fact → ``mark_changed("masters")`` unconditionally (both
        branches change the table). Flush, no commit.
        """
        _require_section_fields(specialty_ids, color)
        deduped = list(dict.fromkeys(str(sid) for sid in specialty_ids))
        if len(deduped) > SPECIALTY_SET_LIMIT:
            raise SpecialtySetTooLongError(SPECIALTY_SET_LIMIT)
        await self._validate_specialty_ids(db_session, deduped)
        ext = (
            await db_session.execute(select(Master).where(Master.staff_id == staff_id))
        ).scalar_one_or_none()
        if ext is None:
            ext = Master(
                staff_id=staff_id,
                color=color.strip(),
                **({"is_active": not archived} if archived is not None else {}),
            )
            db_session.add(ext)
            await db_session.flush()
        else:
            ext.color = color.strip()
            if archived is not None:
                ext.is_active = not archived
        await self._replace_specialty_links(db_session, staff_id, deduped)
        mark_changed("masters")
        return ext

    async def remove_extension(self, db_session: AsyncSession, staff_id: str) -> None:
        """Delete the masters extension row (the explicit ``master: null``
        path), domain-blocked by activities (D7) — and CLEAR the
        specialty links («без мастер-секции направлений нет», §4.4: the
        links hang off the card, so they need their own delete next to
        the row).

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
        await db_session.execute(
            sa_delete(staff_specialties).where(
                staff_specialties.c.staff_id == staff_id
            )
        )
        mark_changed("masters")
        mark_changed("staff_specialties")

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
