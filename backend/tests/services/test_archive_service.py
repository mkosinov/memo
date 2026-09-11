"""Service-layer rename + archive/restore contract tests (GH #207, Task 3).

Asserts the service-layer archive base rename and the new
``archive()`` / ``restore()`` bool contract:

  * ``ArchiveService`` class exists (renamed from the prior soft-delete base).
  * ``ArchiveService`` exposes ``archive`` and ``restore`` methods.
  * ``archive()`` flips ``is_active`` to ``False``; ``restore()`` flips it
    back to ``True`` (round trip via a representative subclass — the
    transitional ``MasterService`` backed by ``Staff`` since GH #266).
  * Both methods return ``False`` for a nonexistent id (no row, no exception).

GH #266 Task 2 addition — Staff hard-delete executor contract on the
#266 dependency matrix (activities block; users/masters/master_tags/
staff_positions auto-cascade in one transaction).

Spec: docs/specs/2026-08-15-delete-hard-delete-and-dependency-resolution-design.md
§3.4 (Service), §9 (Rename), §14 (rename AC); GH #266 deletion matrix —
docs/domain-rules/staff.md.
"""

from __future__ import annotations

import uuid as _uuid

import pytest
from sqlalchemy import insert, select

from src.domain.deletion import BlockingDepsError
from src.models.master import Master
from src.models.position import Position, staff_positions
from src.models.staff import Staff
from src.models.tag import Tag, master_tags
from src.models.user import User
from src.services.generic import ArchiveService
from src.services.master import get_master_service

pytestmark = pytest.mark.asyncio


# ─── Class surface ───────────────────────────────────────────────────────────────


def test_archive_service_exposes_archive_and_restore_methods() -> None:
    """The archive base declares archive/restore (spec §3.4, §9)."""
    assert hasattr(ArchiveService, "archive"), (
        "ArchiveService must expose an `archive` method (spec §3.4, §9)"
    )
    assert hasattr(ArchiveService, "restore"), (
        "ArchiveService must expose a `restore` method (spec §3.4, §9)"
    )


# ─── Round trip + bool contract ────────────────────────────────────────────────


async def _add_staff(db_session, **kwargs) -> Staff:
    staff = Staff(first_name="A", last_name="B", **kwargs)
    db_session.add(staff)
    await db_session.flush()
    return staff


async def test_archive_then_restore_flips_is_active_round_trip(db_session) -> None:
    """archive() sets is_active=False; restore() sets it back to True.

    Exercises the methods through a representative subclass (the
    transitional ``MasterService`` on ``Staff``), so the inheritance
    wiring is also covered.
    """
    staff = await _add_staff(db_session)
    staff_id = staff.id

    service = get_master_service()

    # archive → is_active=False, returns True
    archived_ok = await service.archive(db_session, staff_id)
    assert archived_ok is True, (
        f"archive({staff_id!r}) returned {archived_ok!r}, expected True"
    )
    db_session.expire_all()
    archived_row = await db_session.get(Staff, staff_id)
    assert archived_row is not None, "row vanished after archive"
    assert archived_row.is_active is False, (
        f"after archive: is_active={archived_row.is_active!r}, expected False"
    )

    # restore → is_active=True, returns True
    restored_ok = await service.restore(db_session, staff_id)
    assert restored_ok is True, (
        f"restore({staff_id!r}) returned {restored_ok!r}, expected True"
    )
    db_session.expire_all()
    restored_row = await db_session.get(Staff, staff_id)
    assert restored_row is not None, "row vanished after restore"
    assert restored_row.is_active is True, (
        f"after restore: is_active={restored_row.is_active!r}, expected True"
    )


async def test_archive_nonexistent_returns_false(db_session) -> None:
    """archive(nonexistent-id) → False (no row, no exception)."""
    service = get_master_service()
    assert await service.archive(db_session, "nonexistent-id") is False


async def test_restore_nonexistent_returns_false(db_session) -> None:
    """restore(nonexistent-id) → False (no row, no exception)."""
    service = get_master_service()
    assert await service.restore(db_session, "nonexistent-id") is False


# ─── GH #266: Staff hard-delete executor (deletion matrix on Staff) ────────────


async def _link_position(db_session, staff_id: str) -> None:
    position = Position(title="СММ")
    db_session.add(position)
    await db_session.flush()
    await db_session.execute(
        insert(staff_positions).values(staff_id=staff_id, position_id=position.id)
    )
    await db_session.flush()


async def _link_master_tag(db_session, staff_id: str) -> None:
    tag = Tag(tag=f"t-{_uuid.uuid4().hex[:8]}")
    db_session.add(tag)
    await db_session.flush()
    await db_session.execute(
        insert(master_tags).values(master_id=staff_id, tag_id=tag.id)
    )
    await db_session.flush()


async def test_staff_resolve_delete_cascades_extension_user_tags_positions(
    db_session,
) -> None:
    """DELETE /staff/{id} (all-auto deps, body {}) hard-deletes the card AND
    its extension row, user account, master_tags and staff_positions joins —
    everything but the tags/positions dictionaries themselves."""
    staff = await _add_staff(db_session)
    ext = Master(staff_id=staff.id, specialty="живопись", color="#000000")
    db_session.add(ext)
    await db_session.flush()
    user = User(
        phone=f"+7999{_uuid.uuid4().hex[:7]}",
        password_hash="x", role="admin", staff_id=staff.id,
    )
    db_session.add(user)
    await _link_master_tag(db_session, staff.id)
    await _link_position(db_session, staff.id)
    await db_session.commit()
    staff_id = staff.id

    ok = await get_master_service().resolve_delete(db_session, staff_id, {})

    assert ok is True
    assert await db_session.get(Staff, staff_id) is None
    assert (await db_session.execute(
        select(Master).where(Master.staff_id == staff_id)
    )).scalar_one_or_none() is None
    assert (await db_session.execute(
        select(User).where(User.staff_id == staff_id)
    )).scalar_one_or_none() is None
    assert (await db_session.execute(
        select(master_tags.c.tag_id).where(master_tags.c.master_id == staff_id)
    )).scalars().all() == []
    assert (await db_session.execute(
        select(staff_positions.c.position_id)
        .where(staff_positions.c.staff_id == staff_id)
    )).scalars().all() == []
    # Dictionaries survive — only the join rows die.
    assert len((await db_session.execute(select(Position))).scalars().all()) == 1
    assert len((await db_session.execute(select(Tag))).scalars().all()) == 1


async def test_staff_resolve_delete_with_activities_blocks(db_session) -> None:
    """A staff card with activities (via the master extension) cannot be
    hard-deleted — BlockingDepsError, nothing modified."""
    from datetime import UTC, datetime, timedelta

    from src.models.activity import Activity
    from src.models.location import Location
    from src.models.service import Service

    staff = await _add_staff(db_session)
    db_session.add(Master(staff_id=staff.id, specialty="живопись", color="#000000"))
    service = Service(title="S", description="d", image_url="i", specialty="живопись",
                      min_age=6, duration=90, record_info="r")
    location = Location(name="L", capacity=10)
    db_session.add_all([service, location])
    await db_session.flush()
    db_session.add(Activity(
        master_id=staff.id, service_id=service.id, location_id=location.id,
        start=datetime.now(UTC) + timedelta(days=1), duration=90,
        capacity=10, is_private=False,
    ))
    await db_session.commit()
    staff_id = staff.id

    with pytest.raises(BlockingDepsError):
        await get_master_service().resolve_delete(db_session, staff_id, {})

    # Nothing modified — the card and its extension survive.
    assert await db_session.get(Staff, staff_id) is not None
    assert (await db_session.execute(
        select(Master).where(Master.staff_id == staff_id)
    )).scalar_one_or_none() is not None
