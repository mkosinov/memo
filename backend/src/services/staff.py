"""Staff card service — reads, row blocks, and the own positions bundle.

GH #326 Task 3 — the composite write flows (create / update / patch /
archive chains) live in the ``usecases.staff`` scenarios (Corridor 2 —
canon docs/domain-rules/service-layer.md rule 2); this service is the
narrow owner of the ``staff`` table plus its OWN ``staff_positions``
bundle (rule 1 — child rows without a lifecycle of their own stay with
the parent, the ``record_tags`` precedent):

* reads — ``get`` / ``list`` / ``list_all`` / ``list_join_masters``
  (composite response assembly via the module helpers; NO
  ``@transactional`` — a read inside a scenario publishes nothing);
* row blocks — ``create_card`` / ``update_card`` / ``patch_card`` /
  ``archive_card`` / ``patch_payload``: scenario building blocks (rule
  3), no decorator, flush only; the scenario owns the transaction;
* ``replace_positions`` — the own M2M bundle replace (validated set,
  deduped, marks ``staff_positions`` — the card's own edge);
* ``restore`` — Corridor 1 (one table, own endpoint), stays a
  decorated method;
* ``delete``/``resolve_delete`` — inherited matrix executor
  (activities block; users/masters/master_tags/staff_positions
  auto-cascade).

The masters extension is written through ``MasterService`` (GH #326
Task 2), the account/role through ``UserService`` (Task 1) — this
module no longer imports their models for writes. The foreign entity
marks live in the owner modules; their absence HERE is pinned by
``tests/test_events_emit.py::TestCascadeSourceAudit``.
"""

from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING, cast

from sqlalchemy import delete as sa_delete
from sqlalchemy import func, not_, select

from src.domain.errors import PositionNotFoundError
from src.events.emitter import mark_changed
from src.models.master import Master
from src.models.position import Position, staff_positions
from src.models.staff import Staff
from src.models.user import User
from src.repositories.generic import get_archive_repository
from src.repositories.search import SearchField
from src.schemas.common import PaginatedResponse
from src.schemas.staff import (
    StaffCreate,
    StaffResponse,
    StaffUpdate,
)
from src.services.decorators import transactional
from src.services.generic import ArchiveService

if TYPE_CHECKING:
    from collections.abc import Sequence

    from pydantic import BaseModel
    from sqlalchemy.ext.asyncio import AsyncSession

    from src.models.enums import ArchiveStatus


async def _master_extensions(
    db_session: AsyncSession, staff_ids: Sequence[str]
) -> dict[str, Master]:
    """Fetch masters-extension rows for *staff_ids* (single query, empty-safe)."""
    if not staff_ids:
        return {}
    rows = await db_session.execute(
        select(Master).where(Master.staff_id.in_(list(staff_ids)))
    )
    return {m.staff_id: m for m in rows.scalars().all()}


async def _position_ids(
    db_session: AsyncSession, staff_ids: Sequence[str]
) -> dict[str, list[str]]:
    """Fetch {staff_id: [position_id, …]} M2M links (single query)."""
    if not staff_ids:
        return {}
    rows = await db_session.execute(
        select(staff_positions.c.staff_id, staff_positions.c.position_id)
        .where(staff_positions.c.staff_id.in_(list(staff_ids)))
        .order_by(staff_positions.c.position_id)
    )
    result: dict[str, list[str]] = {sid: [] for sid in staff_ids}
    for staff_id, position_id in rows.all():
        result[staff_id].append(position_id)
    return result


async def _user_presence(
    db_session: AsyncSession, staff_ids: Sequence[str]
) -> dict[str, bool]:
    """Fetch {staff_id: has_user} — ANY linked users row counts (D6).

    ``is_active`` is deliberately ignored: «наличие учётки» for the D6
    dismissal checkbox means the row exists; applying the checkbox to an
    active link is the dialog's own logic.
    """
    if not staff_ids:
        return {}
    rows = await db_session.execute(
        select(User.staff_id).where(User.staff_id.in_(list(staff_ids)))
    )
    return {staff_id: True for (staff_id,) in rows.all()}



class StaffService(ArchiveService[StaffCreate, StaffUpdate, StaffResponse]):
    """Owner of the staff card: reads + row blocks + own positions bundle."""

    NOT_NULL_FIELDS = {"first_name", "last_name", "sort_order"}

    # GH #212 search matrix (spec §5.2, former masters contract → staff):
    # substring on first_name/last_name (each separately), exact id on a
    # full UUID.
    search_fields = [
        SearchField(Staff.first_name),
        SearchField(Staff.last_name),
        SearchField(Staff.id, kind="uuid"),
    ]

    # ─── response assembly (ORM + extension + links → StaffResponse) ─────

    def _to_response(
        self,
        staff: Staff,
        ext: Master | None,
        position_ids: list[str],
        has_user: bool = False,
    ) -> StaffResponse:
        from src.schemas.staff import MasterSectionView

        # Explicit construction (NOT from_attributes on the ORM object): the
        # schema field ``master`` collides with the lazy ``Staff.master``
        # relationship — attribute access would trigger a greenlet-less
        # lazy load inside validation. The section is filled from the
        # pre-fetched ``ext`` row instead.
        response = StaffResponse(
            id=staff.id,
            first_name=staff.first_name,
            last_name=staff.last_name,
            avatar_url=staff.avatar_url,
            sort_order=staff.sort_order,
            is_active=staff.is_active,
            has_user=has_user,
            created_at=staff.created_at,
            updated_at=staff.updated_at,
        )
        response.master = (
            MasterSectionView.model_validate(ext) if ext is not None else None
        )
        response.position_ids = position_ids
        return response

    async def _assemble(
        self, db_session: AsyncSession, staff_rows: Sequence[Staff]
    ) -> list[StaffResponse]:
        """Bulk-fill master sections + position ids + has_user for a page."""
        ids = [s.id for s in staff_rows]
        exts = await _master_extensions(db_session, ids)
        links = await _position_ids(db_session, ids)
        users = await _user_presence(db_session, ids)
        return [
            self._to_response(
                s, exts.get(s.id), links.get(s.id, []), users.get(s.id, False)
            )
            for s in staff_rows
        ]

    # ─── reads ────────────────────────────────────────────────────────────

    async def get(
        self, db_session: AsyncSession, id: str
    ) -> StaffResponse | None:
        staff = await self._repository.get(db_session, self._model, id)
        if staff is None:
            return None
        ext = (await _master_extensions(db_session, [id])).get(id)
        links = await _position_ids(db_session, [id])
        has_user = (await _user_presence(db_session, [id])).get(id, False)
        return self._to_response(staff, ext, links.get(id, []), has_user)

    async def list(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 20,
        order_by=None,
        status: ArchiveStatus | None = None,
        q: str | None = None,
        **filters,
    ) -> PaginatedResponse[StaffResponse]:
        """Paginated list (GH #205 envelope) with composite fields filled."""
        from src.models.enums import ArchiveStatus
        from src.repositories.generic import ArchiveRepository

        if status is None:
            status = ArchiveStatus.ACTIVE
        staff_rows, total = await cast("ArchiveRepository", self._repository).list(
            db_session,
            self._model,
            status=status,
            filters=filters,
            q=q,
            search_fields=self.search_fields,
            order_by=order_by,
            limit=per_page,
            offset=(page - 1) * per_page,
        )
        items = await self._assemble(db_session, staff_rows)
        return PaginatedResponse(
            items=items, total=total, page=page, per_page=per_page,
        )

    async def list_all(
        self,
        db_session: AsyncSession,
        order_by=None,
        status: ArchiveStatus | None = None,
        **filters,
    ) -> list[StaffResponse]:
        """Bare /all list (BARE_LIST_MAX_ROWS guard) with composite fields."""
        from src.domain.errors import BareListLimitExceededError
        from src.models.enums import ArchiveStatus
        from src.services.generic import BARE_LIST_MAX_ROWS

        if status is None:
            status = ArchiveStatus.ACTIVE
        stmt = self._list_stmt(status=status, **filters)
        if order_by is not None:
            stmt = stmt.order_by(*order_by)
        result = await db_session.execute(stmt.limit(BARE_LIST_MAX_ROWS + 1))
        staff_rows = list(result.scalars().all())
        if len(staff_rows) > BARE_LIST_MAX_ROWS:
            raise BareListLimitExceededError(
                self._model.__tablename__, BARE_LIST_MAX_ROWS
            )
        return await self._assemble(db_session, staff_rows)

    async def list_join_masters(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 20,
        order_by=None,
        status: ArchiveStatus | None = None,
        q: str | None = None,
        **filters,
    ) -> PaginatedResponse[StaffResponse]:
        """Extension-sort variant of ``list`` — LEFT JOIN on masters.

        ``sort_by=specialty|color`` orders by masters-extension columns
        (domain-rules/staff.md «List contract»): cards WITHOUT the section
        (NULL) stay in the result and sort LAST (the router bakes
        ``nullslast`` into ``order_by``). Same GH #205 envelope + the same
        GH #212 search matrix as the plain list.
        """
        from src.models.enums import ArchiveStatus
        from src.repositories.search import search_predicate

        if status is None:
            status = ArchiveStatus.ACTIVE
        stmt = select(Staff).outerjoin(Master, Master.staff_id == Staff.id)
        if status == ArchiveStatus.ACTIVE:
            stmt = stmt.where(Staff.is_active)
        elif status == ArchiveStatus.ARCHIVED:
            stmt = stmt.where(not_(Staff.is_active))
        if q is not None:
            assert self.search_fields is not None  # class attribute (narrow for mypy)
            stmt = stmt.where(search_predicate(q, self.search_fields))
        for key, value in filters.items():
            if value is not None:
                stmt = stmt.where(getattr(Staff, key) == value)
        total = (
            await db_session.execute(
                select(func.count()).select_from(stmt.subquery())
            )
        ).scalar_one()
        if order_by is not None:
            stmt = stmt.order_by(*order_by)
        stmt = stmt.limit(per_page).offset((page - 1) * per_page)
        staff_rows = list((await db_session.execute(stmt)).scalars().all())
        items = await self._assemble(db_session, staff_rows)
        return PaginatedResponse(
            items=items, total=total, page=page, per_page=per_page,
        )

    # ─── card row blocks — scenario building blocks, no decorator ────────

    async def create_card(
        self,
        db_session: AsyncSession,
        *,
        first_name: str,
        last_name: str,
        avatar_url: str | None = None,
        sort_order: int = 0,
    ) -> Staff:
        """Insert ONE staff card row — WITHOUT committing (rule 3).

        The ``create_staff`` scenario owns the transaction boundary and
        the composite chain (section / positions / account). Value-typed
        parameters only; flush so the caller gets a populated ``id``.
        """
        staff = Staff(
            first_name=first_name,
            last_name=last_name,
            avatar_url=avatar_url,
            sort_order=sort_order,
        )
        db_session.add(staff)
        await db_session.flush()
        return staff

    async def update_card(
        self,
        db_session: AsyncSession,
        id: str,
        *,
        first_name: str,
        last_name: str,
        avatar_url: str | None,
        sort_order: int,
    ) -> Staff | None:
        """Apply the PUT card-field writes — WITHOUT committing.

        Missing id → ``None`` (the route maps that to 404). ``updated_at``
        stamps via the model's ``onupdate``. The section/positions/role
        parts of the former ``StaffService.update`` live in the
        ``update_staff`` scenario.
        """
        staff = await self._repository.get(db_session, self._model, id)
        if staff is None:
            return None
        staff.first_name = first_name
        staff.last_name = last_name
        staff.avatar_url = avatar_url
        staff.sort_order = sort_order
        await db_session.flush()
        return staff

    async def patch_card(
        self, db_session: AsyncSession, id: str, fields: dict
    ) -> Staff | None:
        """Apply the SENT card fields of a PATCH — WITHOUT committing.

        ``fields`` is the caller's prepared payload (``patch_payload`` —
        ``exclude_unset`` dump with NOT NULL nulls stripped); only the
        card scalar keys remain in it. Missing id → ``None``.
        """
        staff = await self._repository.get(db_session, self._model, id)
        if staff is None:
            return None
        for key, value in fields.items():
            setattr(staff, key, value)
        await db_session.flush()
        return staff

    def patch_payload(self, data: BaseModel) -> dict:
        """PATCH prep for the scenario: ``exclude_unset`` dump with ``None``
        values for ``NOT_NULL_FIELDS`` stripped (client intent is "don't
        change", not "set to null") — the generic ``_patch_payload``
        semantics, exposed for the ``patch_staff`` scenario.
        """
        return self._patch_payload(data)

    async def archive_card(self, db_session: AsyncSession, id: str) -> bool:
        """Flip the person flag (``staff.is_active = False``) — WITHOUT
        committing.

        The D6 checkboxes (masters/users) are applied by the
        ``archive_staff`` scenario through their owners. Missing id →
        ``False`` (the route maps that to 404).
        """
        staff = await self._repository.get(db_session, self._model, id)
        if staff is None:
            return False
        staff.is_active = False
        await db_session.flush()
        return True

    # ─── positions bundle (own M2M edge) ──────────────────────────────────

    async def _validate_position_ids(
        self, db_session: AsyncSession, position_ids: Sequence[str]
    ) -> None:
        """Every sent position id must exist (POSITION_NOT_FOUND else)."""
        if not position_ids:
            return
        unique_ids = set(position_ids)
        rows = await db_session.execute(
            select(Position.id).where(Position.id.in_(unique_ids))
        )
        found = set(rows.scalars().all())
        for missing in sorted(unique_ids - found):
            raise PositionNotFoundError(missing)

    async def replace_positions(
        self, db_session: AsyncSession, staff_id: str, position_ids: Sequence[str]
    ) -> None:
        """Full replace of the M2M set (delete-all + insert, same flush).

        Duplicates in *position_ids* collapse to one row (set semantics)
        instead of dying on the composite PK. A replace is a fact → marks
        ``"staff_positions"`` unconditionally (the card's OWN bundle —
        the pre-refactor grid, pinned by the usecases tests).
        """
        await self._validate_position_ids(db_session, position_ids)
        await db_session.execute(
            sa_delete(staff_positions).where(staff_positions.c.staff_id == staff_id)
        )
        for position_id in dict.fromkeys(position_ids):
            await db_session.execute(
                staff_positions.insert().values(
                    staff_id=staff_id, position_id=position_id
                )
            )
        mark_changed("staff_positions")

    # ─── restore: Corridor 1, stays decorated ─────────────────────────────
    @transactional
    async def restore(
        self, db_session: AsyncSession, id: str
    ) -> bool:
        """Restore the PERSON only (master/user flags are explicit toggles).

        GH #344 (spec §4.6): mirrored EXPLICIT ``restore`` journal row;
        restoring an already-ACTIVE card is a no-op and writes nothing.
        """
        staff = await self._repository.get(db_session, self._model, id)
        if staff is None:
            return False
        if not staff.is_active:
            from src.events.audit import derive_row_label, mark_audit

            mark_audit(
                entity="staff",
                action="restore",
                entity_id=id,
                entity_label=derive_row_label("staff", staff),
                changes=None,
            )
        staff.is_active = True
        await db_session.flush()
        return True

    # delete()/resolve_delete() — inherited UNMODIFIED from the generic
    # ArchiveService executor over the Staff FK matrix (T2): activities
    # block; users/masters/master_tags/staff_positions auto-cascade.


@lru_cache
def get_staff_service() -> StaffService:
    return StaffService(get_archive_repository(), Staff, StaffResponse)
