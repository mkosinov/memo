"""Business logic for master CRUD operations.

GH #266 Task 1 transitional shape: the people table became ``staff`` and
``Master`` is now the 1:0..1 schedule extension (specialty/color). The old
masters API keeps serving the SAME contract (id = staff id, names,
specialty, color, position, avatar, sort_order, archived) — this service
reads/writes through ``Staff`` and mirrors master fields onto the extension.
The composite StaffService split (card + positions + master section) lands
in Tasks 2-3 of the plan; the D6 checkbox archive semantics replace the
legacy cascade there as well.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import TYPE_CHECKING, cast

from sqlalchemy import select, update

if TYPE_CHECKING:
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession

from src.events.emitter import mark_changed
from src.models.master import Master
from src.models.staff import Staff
from src.models.user import User
from src.repositories.generic import get_archive_repository
from src.repositories.search import SearchField
from src.schemas.common import PaginatedResponse
from src.schemas.master import MasterCreate, MasterResponse, MasterUpdate
from src.services.decorators import transactional
from src.services.generic import ArchiveService


@dataclass
class _MasterView:
    """Attribute glue: staff row + master extension → MasterResponse shape."""

    id: str
    first_name: str
    last_name: str
    avatar_url: str | None
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
    specialty: str
    color: str
    position: str  # transitional constant (positions M2M lands in Task 3)

    @classmethod
    def build(cls, staff: Staff, ext: Master | None) -> _MasterView:
        return cls(
            id=staff.id,
            first_name=staff.first_name,
            last_name=staff.last_name,
            avatar_url=staff.avatar_url,
            sort_order=staff.sort_order,
            is_active=staff.is_active,
            created_at=staff.created_at,
            updated_at=staff.updated_at,
            specialty=(ext.specialty if ext else ""),
            color=(ext.color if ext else "#000000"),
            position="мастер",
        )


async def _extensions(
    db_session: AsyncSession, ids: list[str]
) -> dict[str, Master]:
    """Fetch master extension rows for *ids* (single query; empty-safe)."""
    if not ids:
        return {}
    rows = await db_session.execute(
        select(Master).where(Master.staff_id.in_(ids))
    )
    return {m.staff_id: m for m in rows.scalars().all()}


class MasterService(ArchiveService[MasterCreate, MasterUpdate, MasterResponse]):
    """Transitional master service backed by staff + masters extension."""

    NOT_NULL_FIELDS = {"first_name", "last_name", "sort_order"}

    # GH #212 search matrix (spec §5.2): substring on first_name/last_name
    # (each field ilike'd separately), exact id equality on full UUID.
    search_fields = [
        SearchField(Staff.first_name),
        SearchField(Staff.last_name),
        SearchField(Staff.id, kind="uuid"),
    ]

    # ─── reads ────────────────────────────────────────────────────────────

    async def get(
        self, db_session: AsyncSession, id: str
    ) -> MasterResponse | None:
        staff = await self._repository.get(db_session, self._model, id)
        if staff is None:
            return None
        ext = (await _extensions(db_session, [id])).get(id)
        return MasterResponse.model_validate(_MasterView.build(staff, ext))

    async def list(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 20,
        order_by=None,
        status=None,
        q: str | None = None,
        **filters,
    ) -> PaginatedResponse[MasterResponse]:
        # Full override (not super()): super() validates raw Staff rows
        # against MasterResponse before the extension remap could run.
        from src.models.enums import ArchiveStatus
        from src.repositories.generic import ArchiveRepository

        if status is None:
            status = ArchiveStatus.ACTIVE
        staff_rows, total = await cast(
            "ArchiveRepository", self._repository
        ).list(
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
        exts = await _extensions(db_session, [s.id for s in staff_rows])
        items = [
            MasterResponse.model_validate(_MasterView.build(s, exts.get(s.id)))
            for s in staff_rows
        ]
        return PaginatedResponse(
            items=items, total=total, page=page, per_page=per_page,
        )

    async def list_all(
        self,
        db_session: AsyncSession,
        order_by=None,
        status=None,
        **filters,
    ) -> list[MasterResponse]:
        # Full override — same rationale as list().
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
        exts = await _extensions(db_session, [s.id for s in staff_rows])
        return [
            MasterResponse.model_validate(_MasterView.build(s, exts.get(s.id)))
            for s in staff_rows
        ]

    # ─── writes ───────────────────────────────────────────────────────────

    @transactional
    async def create(
        self, db_session: AsyncSession, data: MasterCreate
    ) -> MasterResponse:
        staff = Staff(
            first_name=data.first_name,
            last_name=data.last_name,
            avatar_url=data.avatar_url,
            sort_order=data.sort_order,
        )
        db_session.add(staff)
        await db_session.flush()
        db_session.add(
            Master(
                staff_id=staff.id, specialty=data.specialty, color=data.color
            )
        )
        await db_session.flush()
        ext = (await _extensions(db_session, [staff.id])).get(staff.id)
        return MasterResponse.model_validate(_MasterView.build(staff, ext))

    @transactional
    async def update(
        self, db_session: AsyncSession, id: str, data: MasterUpdate
    ) -> MasterResponse | None:
        staff = await self._repository.get(db_session, self._model, id)
        if staff is None:
            return None
        staff.first_name = data.first_name
        staff.last_name = data.last_name
        staff.avatar_url = data.avatar_url
        staff.sort_order = data.sort_order
        ext = (await _extensions(db_session, [id])).get(id)
        if ext is None:
            db_session.add(
                Master(staff_id=id, specialty=data.specialty, color=data.color)
            )
        else:
            ext.specialty = data.specialty
            ext.color = data.color
        await db_session.flush()
        ext = (await _extensions(db_session, [id])).get(id)
        return MasterResponse.model_validate(_MasterView.build(staff, ext))

    @transactional
    async def patch(
        self, db_session: AsyncSession, id: str, data
    ) -> MasterResponse | None:
        staff = await self._repository.get(db_session, self._model, id)
        if staff is None:
            return None
        payload = {
            k: v for k, v in data.model_dump().items()
            if v is not None or k not in self.NOT_NULL_FIELDS
        }
        for key, value in payload.items():
            setattr(staff, key, value)
        ext_patch = {
            k: v for k, v in data.model_dump().items()
            if k in ("specialty", "color") and v is not None
        }
        if ext_patch:
            ext = (await _extensions(db_session, [id])).get(id)
            if ext is None:
                db_session.add(Master(staff_id=id, **ext_patch))
            else:
                for key, value in ext_patch.items():
                    setattr(ext, key, value)
        await db_session.flush()
        ext = (await _extensions(db_session, [id])).get(id)
        return MasterResponse.model_validate(_MasterView.build(staff, ext))

    # ─── archive/restore (legacy §4.2 cascade, until Task 3 D6) ──────────

    @transactional
    async def archive(self, db_session: AsyncSession, id: str) -> bool:
        """Archive the staff card AND the linked user + master extension.

        ONE transaction: staff.is_active, the linked account's
        users.is_active and the extension's is_active flip together
        (D6 checkboxes replace this behaviour in Task 3).
        """
        orm = await self._repository.patch(
            db_session, self._model, id, {"is_active": False}
        )
        if orm is None:
            return False
        await db_session.execute(
            update(User).where(User.staff_id == id).values(is_active=False)
        )
        await db_session.execute(
            update(Master).where(Master.staff_id == id).values(is_active=False)
        )
        mark_changed("users")
        mark_changed("masters")
        return True

    @transactional
    async def restore(self, db_session: AsyncSession, id: str) -> bool:
        """Restore the staff card, linked user and master extension."""
        orm = await self._repository.patch(
            db_session, self._model, id, {"is_active": True}
        )
        if orm is None:
            return False
        await db_session.execute(
            update(User).where(User.staff_id == id).values(is_active=True)
        )
        await db_session.execute(
            update(Master).where(Master.staff_id == id).values(is_active=True)
        )
        mark_changed("users")
        mark_changed("masters")
        return True


@lru_cache
def get_master_service() -> MasterService:
    return MasterService(get_archive_repository(), Staff, MasterResponse)
