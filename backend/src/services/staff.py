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
from sqlalchemy import func, not_, select, update

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
from src.services.user_settings import UserSettingsService

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


# GH #263 D10 — role template anchored on the FIXED system position ids
# (never on title, D4 #266: titles are freely editable). Seniority:
# admin > master — several anchored positions collapse to the senior one.
_POSITION_ROLE_TEMPLATE: dict[str, UserRole] = {
    "admin": UserRole.ADMIN,
    "master": UserRole.MASTER,
}


def _template_role(position_ids: Sequence[str]) -> UserRole | None:
    """Highest template role among *position_ids* (admin > master).

    ``None`` = none of the anchored positions present — «прочие должности
    роль не трогают». Deliberate edge (D10): a set that LOSES master/admin
    also yields ``None`` → the linked account keeps its current role
    (removal is not a downgrade; roles are manual outside the template).
    """
    roles = [
        _POSITION_ROLE_TEMPLATE[pid]
        for pid in dict.fromkeys(position_ids)
        if pid in _POSITION_ROLE_TEMPLATE
    ]
    if UserRole.ADMIN in roles:
        return UserRole.ADMIN
    if roles:
        return UserRole.MASTER
    return None


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

        # 2. Master section (optional). ``archived`` (Gap A): set → the
        # section is born with is_active = not archived; None → default True.
        _require_section_fields(data.master)
        if data.master is not None:
            db_session.add(
                Master(
                    staff_id=staff.id,
                    specialty=data.master.specialty.strip(),
                    color=data.master.color.strip(),
                    **(
                        {"is_active": not data.master.archived}
                        if data.master.archived is not None
                        else {}
                    ),
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

        # 4. Account checkbox (D6, create-only). Role (GH #263 D10):
        # explicit role in the body wins (ручная правка); otherwise the
        # position template (master → master, admin → admin, senior
        # admin > master); no anchored position → the legacy #247 fallback
        # (master section → master, else admin) keeps bare cards sensible.
        if data.create_user:
            password = validate_password(data.create_user.password)
            template = _template_role(data.position_ids)
            if data.create_user.role is not None:
                role: UserRole = data.create_user.role
            elif template is not None:
                role = template
            else:
                role = (
                    UserRole.MASTER
                    if data.master is not None
                    else UserRole.ADMIN
                )
            user = User(
                phone=data.create_user.phone,
                password_hash=hash_password(password),
                role=role.value,
                staff_id=staff.id,
            )
            db_session.add(user)
            await db_session.flush()
            # GH #319: guaranteed child record — the UserSettings defaults
            # row in the SAME transaction (silent core: no separate
            # bus-invalidation event; the structural move of staff ops to
            # scenarios is #326).
            await UserSettingsService.insert_defaults(db_session, user.id)
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
        has_user = (await _user_presence(db_session, [staff.id])).get(
            staff.id, False
        )
        return self._to_response(
            staff, ext, links.get(staff.id, []), has_user
        )

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

        # 4. Role template (GH #263 D10): position set is part of the PUT
        # contract → the linked account follows the template unless the
        # body carries an explicit role.
        await self._apply_role_template(
            db_session, id, data.position_ids, explicit_role=data.role
        )

        await db_session.flush()
        return await self.get(db_session, id)

    async def patch(
        self, db_session: AsyncSession, id: str, data: StaffPatch
    ) -> StaffResponse | None:
        """PATCH — only sent keys apply (three-state ``master``)."""
        payload = self._patch_payload(data)
        master_sent = "master" in payload
        # The ORIGINAL model object, not the payload dump: the dict form
        # loses attribute access in ``_apply_master_section``.
        master_section = data.master if master_sent else None
        positions_sent = "position_ids" in payload
        position_ids = payload.pop("position_ids", None)
        payload.pop("master", None)
        # Role (GH #263 D10): absent or null body value = no override →
        # the template decides when the set changes; a sent value wins.
        # ``explicit_role is not None`` below already implies the key was
        # sent with a value.
        payload.pop("role", None)
        return await self._patch_composite(
            db_session, id, payload,
            master_sent=master_sent,
            master_section=master_section,
            positions_sent=positions_sent,
            position_ids=cast("list[str] | None", position_ids),
            explicit_role=data.role,
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
        explicit_role: UserRole | None = None,
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
            await self._apply_role_template(
                db_session, id, position_ids, explicit_role=explicit_role
            )
        elif explicit_role is not None:
            # Role sent WITHOUT a position-set change — manual override only
            # (ручная правка роли остаётся: the body beats the template).
            # Empty position ids → template yields None → explicit applies.
            await self._apply_role_template(
                db_session, id, [], explicit_role=explicit_role
            )

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
        """Upsert (payload) / remove (None) the masters extension row.

        ``section.archived`` (T8 Gap A): ``None`` = don't touch the
        schedule flag; set → ``masters.is_active = not archived`` on the
        upserted row. Archiving NEVER deletes the row (D7 — history keeps
        specialty/color; removal stays the explicit ``master: null`` path).
        """
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
                    **(
                        {"is_active": not section.archived}
                        if section.archived is not None
                        else {}
                    ),
                )
            )
        else:
            ext.specialty = section.specialty.strip()
            ext.color = section.color.strip()
            if section.archived is not None:
                ext.is_active = not section.archived
        mark_changed("masters")

    async def _apply_role_template(
        self,
        db_session: AsyncSession,
        staff_id: str,
        position_ids: Sequence[str],
        *,
        explicit_role: UserRole | None = None,
    ) -> None:
        """GH #263 D10 — the position set templates the linked account role.

        Applied when the position set changes (PUT always carries the set;
        PATCH only when ``position_ids`` was sent). Template = highest
        anchor (admin > master); explicit ``role`` in the request body
        beats the template (ручная правка роли остаётся). No anchored
        position → the role is NOT touched (СММ и пользовательские
        должности не влияют; losing master/admin is not a downgrade).

        No linked account → nothing to template (no-op).
        """
        role = explicit_role if explicit_role is not None else _template_role(position_ids)
        if role is None:
            return
        result = await db_session.execute(
            update(User)
            .where(User.staff_id == staff_id)
            .values(role=role.value)
        )
        if result.rowcount:
            mark_changed("users")

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
