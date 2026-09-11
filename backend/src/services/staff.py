"""Composite staff-card service — GH #266 Task 3 (spec D5/D6/D8).

One card spans four tables: ``staff`` (the person), the 1:0..1 ``masters``
extension (schedule side), the ``staff_positions`` M2M, and — on create —
a linked ``users`` account. :class:`StaffService` composes the existing
generic machinery (``ArchiveService`` reads/hard-delete + ``resolve_delete``
over the Staff FK matrix) instead of duplicating it:

* ``create``/``update``/``patch`` — ONE transaction per call: card fields +
  masters-row upsert/remove + positions replace + user create, atomically
  (spec «API (после)»: три таблицы атомарно). Any failure → nothing
  persists (the ``@transactional`` decorator skips its commit on raise).
* ``archive(id, archive_master, archive_user)`` — D6 checkboxes applied
  ONLY to existing ACTIVE links; unchecked links keep their flags (three
  independent flags, D3 — no hidden cascades, nothing silently restores).
* ``restore`` — returns the PERSON only; master/user flags are owned by
  their own explicit toggles (domain-rules/staff.md).
* ``delete``/``resolve_delete`` — inherited matrix executor (activities
  block; users/masters/master_tags/staff_positions auto-cascade).
"""

from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING, cast

from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select, update

from src.auth.passwords import hash_password, validate_password
from src.domain.deletion import BlockingDepsError
from src.domain.errors import (
    ColorRequiredError,
    PositionNotFoundError,
    SpecialtyRequiredError,
)
from src.events.emitter import mark_changed
from src.models.activity import Activity
from src.models.enums import UserRole
from src.models.master import Master
from src.models.position import Position, staff_positions
from src.models.staff import Staff
from src.models.user import User
from src.repositories.generic import get_archive_repository
from src.repositories.search import SearchField
from src.schemas.common import PaginatedResponse
from src.schemas.staff import (
    MasterSection,
    StaffCreate,
    StaffPatch,
    StaffResponse,
    StaffUpdate,
)
from src.services.decorators import transactional
from src.services.generic import ArchiveService

if TYPE_CHECKING:
    from collections.abc import Sequence

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


def _require_section_fields(section: MasterSection | None) -> None:
    """D5: a present master section must carry a non-blank specialty + color.

    Pydantic already rejects absent keys / empty strings / bad hex; the
    blank-whitespace case (``"   "``) is domain-level, checked here.
    """
    if section is None:
        return
    if not section.specialty.strip():
        raise SpecialtyRequiredError()
    if not section.color.strip():
        raise ColorRequiredError()


class StaffService(ArchiveService[StaffCreate, StaffUpdate, StaffResponse]):
    """Composite service over staff + masters + staff_positions + users."""

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
        """Bulk-fill master sections + position ids for a page of cards."""
        ids = [s.id for s in staff_rows]
        exts = await _master_extensions(db_session, ids)
        links = await _position_ids(db_session, ids)
        return [
            self._to_response(s, exts.get(s.id), links.get(s.id, []))
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
        return self._to_response(staff, ext, links.get(id, []))

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

    # ─── composite writes — ONE transaction each ─────────────────────────

    @transactional
    async def create(
        self, db_session: AsyncSession, data: StaffCreate
    ) -> StaffResponse:
        # 1. Person card.
        staff = Staff(
            first_name=data.first_name,
            last_name=data.last_name,
            avatar_url=data.avatar_url,
            sort_order=data.sort_order,
        )
        db_session.add(staff)
        await db_session.flush()

        # 2. Master section (optional).
        _require_section_fields(data.master)
        if data.master is not None:
            db_session.add(
                Master(
                    staff_id=staff.id,
                    specialty=data.master.specialty.strip(),
                    color=data.master.color.strip(),
                )
            )

        # 3. Positions replace (fresh card → plain insert, validated set).
        # Dedupe first: a repeated id is set-semantics noise, not an
        # IntegrityError on the composite PK (staff_id, position_id).
        await self._validate_position_ids(db_session, data.position_ids)
        for position_id in dict.fromkeys(data.position_ids):
            await db_session.execute(
                staff_positions.insert().values(
                    staff_id=staff.id, position_id=position_id
                )
            )

        # 4. Account checkbox (D6, create-only). Role: a card WITH a master
        # section is a schedule master; without — admin (#247 two roles).
        if data.create_user:
            password = validate_password(data.create_user.password)
            db_session.add(
                User(
                    phone=data.create_user.phone,
                    password_hash=hash_password(password),
                    role=(
                        UserRole.MASTER.value
                        if data.master is not None
                        else UserRole.ADMIN.value
                    ),
                    staff_id=staff.id,
                )
            )
        # Cross-table writes — surface the touched entities (§3.3); the
        # decorator's accumulator already carries the own "staff" entity.
        if data.master is not None:
            mark_changed("masters")
        if data.position_ids:
            mark_changed("staff_positions")
        if data.create_user:
            mark_changed("users")

        await db_session.flush()
        ext = (
            (await _master_extensions(db_session, [staff.id])).get(staff.id)
            if data.master is not None
            else None
        )
        links = await _position_ids(db_session, [staff.id])
        return self._to_response(staff, ext, links.get(staff.id, []))

    @transactional
    async def update(
        self, db_session: AsyncSession, id: str, data: StaffUpdate
    ) -> StaffResponse | None:
        staff = await self._repository.get(db_session, self._model, id)
        if staff is None:
            return None

        # 1. Card fields.
        staff.first_name = data.first_name
        staff.last_name = data.last_name
        staff.avatar_url = data.avatar_url
        staff.sort_order = data.sort_order

        # 2. Master section upsert/remove.
        await self._apply_master_section(db_session, id, data.master)

        # 3. Positions full replace.
        await self._replace_positions(db_session, id, data.position_ids)

        await db_session.flush()
        return await self.get(db_session, id)

    async def patch(
        self, db_session: AsyncSession, id: str, data: StaffPatch
    ) -> StaffResponse | None:
        """PATCH — only sent keys apply (three-state ``master``)."""
        payload = self._patch_payload(data)
        master_sent = "master" in payload
        master_section = payload.pop("master", None)
        positions_sent = "position_ids" in payload
        position_ids = payload.pop("position_ids", None)
        return await self._patch_composite(
            db_session, id, payload,
            master_sent=master_sent,
            master_section=cast("MasterSection | None", master_section),
            positions_sent=positions_sent,
            position_ids=cast("list[str] | None", position_ids),
        )

    @transactional
    async def _patch_composite(
        self,
        db_session: AsyncSession,
        id: str,
        card_payload: dict,
        *,
        master_sent: bool,
        master_section: MasterSection | None,
        positions_sent: bool,
        position_ids: list[str] | None,
    ) -> StaffResponse | None:
        staff = await self._repository.get(db_session, self._model, id)
        if staff is None:
            return None

        for key, value in card_payload.items():
            setattr(staff, key, value)
        if master_sent:
            await self._apply_master_section(
                db_session, id, cast("MasterSection | None", master_section)
            )
        if positions_sent and position_ids is not None:
            await self._replace_positions(db_session, id, position_ids)

        await db_session.flush()
        return await self.get(db_session, id)

    # ─── section/link plumbing (flushed inside the caller's transaction) ──

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

    async def _replace_positions(
        self, db_session: AsyncSession, staff_id: str, position_ids: Sequence[str]
    ) -> None:
        """Full replace of the M2M set (delete-all + insert, same flush).

        Duplicates in *position_ids* collapse to one row (set semantics)
        instead of dying on the composite PK.
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

    async def _apply_master_section(
        self, db_session: AsyncSession, staff_id: str, section: MasterSection | None
    ) -> None:
        """Upsert (payload) / remove (None) the masters extension row."""
        _require_section_fields(section)
        ext = (await _master_extensions(db_session, [staff_id])).get(staff_id)
        if section is None:
            if ext is not None:
                # D7: удаление masters-строки заблокировано занятиями —
                # same block rule as the card hard-delete (activities block).
                await self._assert_section_removable(db_session, staff_id)
                await db_session.execute(
                    sa_delete(Master).where(Master.staff_id == staff_id)
                )
                mark_changed("masters")
            return
        if ext is None:
            db_session.add(
                Master(
                    staff_id=staff_id,
                    specialty=section.specialty.strip(),
                    color=section.color.strip(),
                )
            )
        else:
            ext.specialty = section.specialty.strip()
            ext.color = section.color.strip()
        mark_changed("masters")

    async def _assert_section_removable(
        self, db_session: AsyncSession, staff_id: str
    ) -> None:
        """A masters row with activities cannot be removed (D7)."""
        count = (
            await db_session.execute(
                select(func.count())
                .select_from(Activity)
                .where(Activity.master_id == staff_id)
            )
        ).scalar_one()
        if count:
            raise BlockingDepsError(
                "Master section has activities — archive it instead"
            )

    # ─── archive/restore: D6 checkboxes, no hidden cascades ───────────────

    @transactional
    async def archive(
        self,
        db_session: AsyncSession,
        id: str,
        archive_master: bool = True,
        archive_user: bool = True,
    ) -> bool:
        """Archive the person + the CHECKED existing ACTIVE links (D6).

        One transaction: ``staff.is_active=False`` always; the master
        extension / linked user flip only when their checkbox is set AND
        the link exists AND is currently active (an archive call never
        silently restores an already-archived link).
        """
        staff = await self._repository.get(db_session, self._model, id)
        if staff is None:
            return False
        staff.is_active = False

        if archive_master:
            result = await db_session.execute(
                update(Master)
                .where(Master.staff_id == id, Master.is_active)
                .values(is_active=False)
            )
            if result.rowcount:
                mark_changed("masters")
        if archive_user:
            result = await db_session.execute(
                update(User)
                .where(User.staff_id == id, User.is_active)
                .values(is_active=False)
            )
            if result.rowcount:
                mark_changed("users")
        await db_session.flush()
        return True

    @transactional
    async def restore(
        self, db_session: AsyncSession, id: str
    ) -> bool:
        """Restore the PERSON only (master/user flags are explicit toggles)."""
        staff = await self._repository.get(db_session, self._model, id)
        if staff is None:
            return False
        staff.is_active = True
        await db_session.flush()
        return True

    # delete()/resolve_delete() — inherited UNMODIFIED from the generic
    # ArchiveService executor over the Staff FK matrix (T2): activities
    # block; users/masters/master_tags/staff_positions auto-cascade.


@lru_cache
def get_staff_service() -> StaffService:
    return StaffService(get_archive_repository(), Staff, StaffResponse)
