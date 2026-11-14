"""Unit tests for MasterService — the ``masters`` writing owner (GH #326 Task 2).

Covers the three scenario building blocks (canon rules 1/3 — no
``@transactional``: flush only, ``mark_changed`` by fact). The semantics
moved 1-to-1 from the ``StaffService`` cascades (which keep their working
copy until the Task 3 demolition):

* ``upsert_extension`` — both branches (create/update); today's T8
  ``archived`` semantics (``None`` leaves ``is_active`` untouched, a value
  sets ``is_active = not archived``); the D5 blank-section domain rule;
  unconditional ``mark_changed("masters")``;
* ``remove_extension`` — D7 domain block (activities →
  ``BlockingDepsError``, the 422 semantics) and the clean delete;
* ``archive_active_extension`` — rowcount over ACTIVE rows only (the D6
  checkbox semantics), mark by fact;
* no method commits — a rollback after the call restores prior state.
"""

from __future__ import annotations

import uuid as _uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

import pytest
from sqlalchemy import select

from src.models.activity import Activity
from src.models.location import Location
from src.models.master import Master
from src.models.service import Service
from src.models.specialty import Specialty
from src.models.staff import Staff

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.asyncio


# ─── helpers ────────────────────────────────────────────────────────────────


async def _t3_spec(db_session) -> Specialty:
    """GH #599: one direction row per test world (find-or-create by title)."""
    row = (
        await db_session.execute(
            select(Specialty).where(Specialty.title == "Живопись")
        )
    ).scalar_one_or_none()
    if row is None:
        row = Specialty(title="Живопись")
        db_session.add(row)
        await db_session.flush()
    return row


async def _add_staff(db_session: Any, **kwargs: Any) -> Staff:
    kwargs.setdefault("first_name", "А")
    kwargs.setdefault("last_name", "Б")
    staff = Staff(**kwargs)
    db_session.add(staff)
    await db_session.flush()
    return staff


async def _add_master(db_session: Any, staff_id: str, **kwargs: Any) -> Master:
    # GH #599: color/flag only — the directions live in the M2M (raw seed).
    defaults: dict[str, Any] = {"color": "#5B8C7A"}
    defaults.update(kwargs)
    ext = Master(staff_id=staff_id, **defaults)
    db_session.add(ext)
    await db_session.flush()
    return ext


async def _link_specialty(db_session: Any, staff_id: str, title: str) -> str:
    """Seed a direction link directly (raw-ORM idiom, find-or-create)."""
    from sqlalchemy import func as sa_func

    from src.models.specialty import staff_specialties

    spec = (
        await db_session.execute(
            select(Specialty).where(sa_func.lower(Specialty.title) == title.lower())
        )
    ).scalar_one_or_none()
    if spec is None:
        spec = Specialty(title=title)
        db_session.add(spec)
        await db_session.flush()
    await db_session.execute(
        staff_specialties.insert().values(staff_id=staff_id, specialty_id=spec.id)
    )
    await db_session.flush()
    return spec.id


async def _linked_ids(db_session: Any, staff_id: str) -> list[str]:
    from src.models.specialty import staff_specialties

    return list(
        (
            await db_session.execute(
                select(staff_specialties.c.specialty_id).where(
                    staff_specialties.c.staff_id == staff_id
                )
            )
        )
        .scalars()
        .all()
    )


async def _add_activity(db_session: Any, master_id: str) -> Activity:
    """One live activity pinning the masters row (the D7 blocker)."""
    service = Service(
        title="С",
        description="d",
        image_url="https://example.com/t.jpg",
        specialty_id=(await _t3_spec(db_session)).id,  # GH #599
        min_age=6,
        duration=60,
        record_info="",
    )
    location = Location(title="Л", capacity=10)
    db_session.add_all([service, location])
    await db_session.flush()
    activity = Activity(
        master_id=master_id,
        service_id=service.id,
        location_id=location.id,
        start=datetime(2026, 1, 1, 10, 0),
        duration=60,
        capacity=5,
    )
    db_session.add(activity)
    await db_session.flush()
    return activity


# ─── canon shape: standalone owner, scenario building blocks ────────────────


@pytest.mark.pure_unit
def test_entity_name_is_masters() -> None:
    from src.services.master import MasterService

    assert MasterService.entity_name == "masters"


@pytest.mark.pure_unit
def test_factory_returns_singleton() -> None:
    from src.services.master import MasterService, get_master_service

    service = get_master_service()
    assert isinstance(service, MasterService)
    assert get_master_service() is service


@pytest.mark.pure_unit
def test_no_method_is_transactional() -> None:
    """Scenario building blocks — none may commit (canon rule 3)."""
    from src.services.decorators import _TRANSACTIONAL_MARKER
    from src.services.master import MasterService

    for name in (
        "upsert_extension",
        "remove_extension",
        "archive_active_extension",
    ):
        assert not hasattr(getattr(MasterService, name), _TRANSACTIONAL_MARKER), (
            f"{name} is a scenario building block — it must NOT commit; "
            "the usecases layer owns the transaction boundary"
        )


# ─── upsert_extension — create branch ───────────────────────────────────────


class TestUpsertExtensionCreate:
    async def test_creates_active_row_links_and_stripped_color(
        self, db_session: AsyncSession
    ) -> None:
        from src.services.master import get_master_service

        staff = await _add_staff(db_session)
        spec_id = (await _t3_spec(db_session)).id

        ext = await get_master_service().upsert_extension(
            db_session, staff.id, [spec_id, spec_id], "  #5B8C7A  "
        )

        assert ext.staff_id == staff.id
        assert ext.color == "#5B8C7A"  # stripped
        assert ext.is_active is True  # new row starts active
        # duplicates collapsed to ONE link row (set semantics)
        assert await _linked_ids(db_session, staff.id) == [spec_id]

    async def test_create_archived_true_row_inactive(self, db_session: AsyncSession) -> None:
        """T8: ``archived=True`` on create → ``is_active = not archived``."""
        from src.services.master import get_master_service

        staff = await _add_staff(db_session)

        spec = await _t3_spec(db_session)
        ext = await get_master_service().upsert_extension(
            db_session, staff.id, [spec.id], "#AABBCC", True
        )

        assert ext.is_active is False

    async def test_marks_masters(self, db_session: AsyncSession) -> None:
        """A written row is a fact — the mark is unconditional."""
        from src.events import emitter
        from src.services.master import get_master_service

        staff = await _add_staff(db_session)

        spec = await _t3_spec(db_session)
        token = emitter.start_accumulation(set())
        try:
            await get_master_service().upsert_extension(
                db_session, staff.id, [spec.id], "#5B8C7A"
            )
            assert emitter.accumulated() == {"masters", "staff_specialties"}
        finally:
            emitter.reset_accumulation(token)


# ─── upsert_extension — update branch ───────────────────────────────────────


class TestUpsertExtensionUpdate:
    async def test_updates_existing_row_no_duplicate(self, db_session: AsyncSession) -> None:
        from src.services.master import get_master_service

        staff = await _add_staff(db_session)
        ext = await _add_master(db_session, staff.id)

        spec = await _t3_spec(db_session)
        updated = await get_master_service().upsert_extension(
            db_session, staff.id, [spec.id], "#112233", False
        )

        assert updated is ext  # same ORM row mutated
        assert ext.color == "#112233"
        count = (
            (await db_session.execute(select(Master).where(Master.staff_id == staff.id)))
            .scalars()
            .all()
        )
        assert len(count) == 1  # upsert, never a second row

    async def test_archived_none_keeps_flag_untouched(self, db_session: AsyncSession) -> None:
        """T8: ``archived=None`` never touches ``masters.is_active`` — in
        either direction (archived row stays archived, active stays
        active)."""
        from src.services.master import get_master_service

        staff_active = await _add_staff(db_session, last_name="А")
        staff_archived = await _add_staff(db_session, last_name="Б")
        await _add_master(db_session, staff_active.id, is_active=True)
        await _add_master(db_session, staff_archived.id, is_active=False)

        spec = await _t3_spec(db_session)
        await get_master_service().upsert_extension(
            db_session, staff_active.id, [spec.id], "#5B8C7A", None
        )
        await get_master_service().upsert_extension(
            db_session, staff_archived.id, [spec.id], "#5B8C7A", None
        )

        flags = dict(
            (
                await db_session.execute(
                    select(Master.staff_id, Master.is_active).where(
                        Master.staff_id.in_([staff_active.id, staff_archived.id])
                    )
                )
            ).all()
        )
        assert flags[staff_active.id] is True  # untouched
        assert flags[staff_archived.id] is False  # untouched

    async def test_archived_false_reactivates_row(self, db_session: AsyncSession) -> None:
        """T8: ``archived=False`` → ``is_active = not archived`` (the D7
        restore path: the row was never deleted, just flagged)."""
        from src.services.master import get_master_service

        staff = await _add_staff(db_session)
        await _add_master(db_session, staff.id, is_active=False)

        spec = await _t3_spec(db_session)
        ext = await get_master_service().upsert_extension(
            db_session, staff.id, [spec.id], "#5B8C7A", False
        )

        assert ext.is_active is True


# ─── upsert_extension — D5 blank-section domain rule ────────────────────────


class TestUpsertExtensionValidation:
    async def test_empty_specialty_set_raises(self, db_session: AsyncSession) -> None:
        """D5 (GH #599): a live section must carry ≥1 direction id."""
        from src.domain.errors import SpecialtyRequiredError
        from src.services.master import get_master_service

        staff = await _add_staff(db_session)

        with pytest.raises(SpecialtyRequiredError):
            await get_master_service().upsert_extension(
                db_session, staff.id, [], "#5B8C7A"
            )

    async def test_blank_color_raises(self, db_session: AsyncSession) -> None:
        from src.domain.errors import ColorRequiredError
        from src.services.master import get_master_service

        staff = await _add_staff(db_session)
        spec = await _t3_spec(db_session)

        with pytest.raises(ColorRequiredError):
            await get_master_service().upsert_extension(
                db_session, staff.id, [spec.id], "   "
            )

    async def test_unknown_specialty_id_raises(self, db_session: AsyncSession) -> None:
        from src.domain.errors import SpecialtyNotFoundError
        from src.services.master import get_master_service

        staff = await _add_staff(db_session)

        with pytest.raises(SpecialtyNotFoundError):
            await get_master_service().upsert_extension(
                db_session, staff.id, [str(_uuid.uuid4())], "#5B8C7A"
            )

    async def test_over_limit_raises(self, db_session: AsyncSession) -> None:
        """51 distinct ids → 422 (write-amplification guard, §4.4)."""
        from src.domain.errors import SpecialtySetTooLongError
        from src.services.master import get_master_service

        staff = await _add_staff(db_session)
        ids = [str(_uuid.uuid4()) for _ in range(51)]

        with pytest.raises(SpecialtySetTooLongError):
            await get_master_service().upsert_extension(
                db_session, staff.id, ids, "#5B8C7A"
            )

    async def test_duplicates_deduped_before_limit(
        self, db_session: AsyncSession
    ) -> None:
        """60 ids over only 30 distinct → UNDER the limit (dedup first)."""
        from src.models.specialty import staff_specialties
        from src.services.master import get_master_service

        staff = await _add_staff(db_session)
        rows = [Specialty(title=f"Направление {i}") for i in range(30)]
        db_session.add_all(rows)
        await db_session.flush()
        ids = [row.id for row in rows] * 2  # 60 sent, 30 distinct

        await get_master_service().upsert_extension(
            db_session, staff.id, ids, "#5B8C7A"
        )
        links = (
            await db_session.execute(
                select(staff_specialties.c.specialty_id).where(
                    staff_specialties.c.staff_id == staff.id
                )
            )
        ).scalars().all()
        assert sorted(links) == sorted({i for i in ids})


# ─── remove_extension — D7 domain block ─────────────────────────────────────


class TestRemoveExtension:
    async def test_blocked_by_activities_raises_and_row_survives(
        self, db_session: AsyncSession
    ) -> None:
        """D7: a masters row with activities cannot be removed — the 422
        semantics (``BlockingDepsError``, «archive it instead»)."""
        from src.domain.deletion import BlockingDepsError
        from src.services.master import get_master_service

        staff = await _add_staff(db_session)
        await _add_master(db_session, staff.id)
        await _add_activity(db_session, staff.id)

        with pytest.raises(BlockingDepsError):
            await get_master_service().remove_extension(db_session, staff.id)

        count = (
            (await db_session.execute(select(Master).where(Master.staff_id == staff.id)))
            .scalars()
            .all()
        )
        assert len(count) == 1  # the row survives the block

    async def test_removes_row_without_activities_and_marks(self, db_session: AsyncSession) -> None:
        from src.events import emitter
        from src.services.master import get_master_service

        staff = await _add_staff(db_session)
        await _add_master(db_session, staff.id)

        token = emitter.start_accumulation(set())
        try:
            await get_master_service().remove_extension(db_session, staff.id)
            # GH #599: removal clears the row AND the direction links.
            assert emitter.accumulated() == {"masters", "staff_specialties"}
        finally:
            emitter.reset_accumulation(token)

        count = (
            (await db_session.execute(select(Master).where(Master.staff_id == staff.id)))
            .scalars()
            .all()
        )
        assert count == []

    async def test_missing_row_noop_no_mark(self, db_session: AsyncSession) -> None:
        """No extension row → nothing to remove; no spurious mark."""
        from src.events import emitter
        from src.services.master import get_master_service

        staff = await _add_staff(db_session)

        token = emitter.start_accumulation(set())
        try:
            await get_master_service().remove_extension(db_session, staff.id)
            assert emitter.accumulated() == set()
        finally:
            emitter.reset_accumulation(token)

    async def test_does_not_commit(self, db_session: AsyncSession) -> None:
        from src.services.master import get_master_service
        from tests.conftest import query_db

        staff = await _add_staff(db_session)
        await _add_master(db_session, staff.id)
        await db_session.commit()  # persist setup — rollback below must only
        staff_id = staff.id  # undo the removal, not the fixture

        await get_master_service().remove_extension(db_session, staff_id)
        await db_session.rollback()

        assert (
            query_db(f"SELECT COUNT(*) AS c FROM masters WHERE staff_id='{staff_id}'")[0]["c"] == 1
        ), (
            "remove_extension must NOT commit — the scenario layer owns "
            "the transaction boundary (canon rule 3)"
        )


# ─── archive_active_extension — rowcount ONLY over active rows ──────────────


class TestArchiveActiveExtension:
    async def test_deactivates_active_row_and_marks(self, db_session: AsyncSession) -> None:
        from src.events import emitter
        from src.services.master import get_master_service

        staff = await _add_staff(db_session)
        await _add_master(db_session, staff.id)

        token = emitter.start_accumulation(set())
        try:
            rowcount = await get_master_service().archive_active_extension(db_session, staff.id)
            assert rowcount == 1
            assert emitter.accumulated() == {"masters"}
        finally:
            emitter.reset_accumulation(token)

        is_active = (
            await db_session.execute(select(Master.is_active).where(Master.staff_id == staff.id))
        ).scalar_one()
        assert is_active is False

    async def test_already_inactive_rowcount_zero_no_mark(self, db_session: AsyncSession) -> None:
        """The D6 checkbox applies ONLY to the ACTIVE row — an already
        archived extension is untouched (never silently restored)."""
        from src.events import emitter
        from src.services.master import get_master_service

        staff = await _add_staff(db_session)
        await _add_master(db_session, staff.id, is_active=False)

        token = emitter.start_accumulation(set())
        try:
            rowcount = await get_master_service().archive_active_extension(db_session, staff.id)
            assert rowcount == 0
            assert emitter.accumulated() == set()
        finally:
            emitter.reset_accumulation(token)

        is_active = (
            await db_session.execute(select(Master.is_active).where(Master.staff_id == staff.id))
        ).scalar_one()
        assert is_active is False  # untouched

    async def test_missing_row_rowcount_zero(self, db_session: AsyncSession) -> None:
        from src.services.master import get_master_service

        staff = await _add_staff(db_session)

        rowcount = await get_master_service().archive_active_extension(db_session, staff.id)

        assert rowcount == 0

    async def test_does_not_commit(self, db_session: AsyncSession) -> None:
        from src.services.master import get_master_service
        from tests.conftest import query_db

        staff = await _add_staff(db_session)
        await _add_master(db_session, staff.id)
        await db_session.commit()  # persist setup — rollback below must only
        staff_id = staff.id  # undo the deactivation, not the fixture

        await get_master_service().archive_active_extension(db_session, staff_id)
        await db_session.rollback()

        assert (
            query_db(f"SELECT is_active FROM masters WHERE staff_id='{staff_id}'")[0]["is_active"]
            == 1
        ), (
            "archive_active_extension must NOT commit — the scenario layer "
            "owns the transaction boundary (canon rule 3)"
        )


# ─── upsert_extension — no commit ───────────────────────────────────────────


class TestUpsertDoesNotCommit:
    async def test_does_not_commit(self, db_session: AsyncSession) -> None:
        from src.services.master import get_master_service
        from tests.conftest import query_db

        staff = await _add_staff(db_session)
        await db_session.commit()  # persist the fixture — rollback below must
        staff_id = staff.id  # only undo the service call

        spec = await _t3_spec(db_session)
        await get_master_service().upsert_extension(
            db_session, staff_id, [spec.id], "#5B8C7A"
        )
        await db_session.rollback()

        assert (
            query_db(f"SELECT COUNT(*) AS c FROM masters WHERE staff_id='{staff_id}'")[0]["c"] == 0
        ), (
            "upsert_extension must NOT commit — the scenario layer owns "
            "the transaction boundary (canon rule 3)"
        )
