"""StaffService tests — the narrowed owner (GH #326 Task 3).

The composite create/update/patch/archive chains moved to the
``usecases.staff`` scenarios (Corridor 2) and are pinned there by
``tests/usecases/test_staff_create.py`` / ``test_staff_update_patch.py``
/ ``test_staff_archive.py`` (branch grids, step order, atomicity, null
stripping). This file covers what REMAINS on the service:

* ``restore`` — the Corridor-1 decorated method: returns the PERSON
  only; master/user flags are restored by their own explicit toggles;
* ``resolve_delete`` — the inherited matrix executor (activities block;
  users/masters/master_tags/staff_positions cascade);
* ``list`` — composite response assembly (master section + position ids
  per row);
* the MASTER_NOT_ACTIVE TOCTOU guard (activity side, spec «Валидация»).
"""

from __future__ import annotations

import uuid as _uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from src.domain.deletion import BlockingDepsError
from src.models.activity import Activity
from src.models.location import Location
from src.models.master import Master
from src.models.position import Position, staff_positions
from src.models.service import Service
from src.models.staff import Staff
from src.models.user import User
from src.schemas.activity import ActivityCreate
from src.services.activity import get_activity_service
from src.services.staff import get_staff_service

pytestmark = pytest.mark.asyncio


# ─── helpers ────────────────────────────────────────────────────────────────


async def _add_position(db_session: Any, **kwargs: Any) -> Position:
    position = Position(**kwargs) if kwargs else Position(title="СММ")
    db_session.add(position)
    await db_session.flush()
    return position


async def _add_staff(db_session: Any, **kwargs: Any) -> Staff:
    kwargs.setdefault("first_name", "А")
    kwargs.setdefault("last_name", "Б")
    staff = Staff(**kwargs)
    db_session.add(staff)
    await db_session.flush()
    return staff


async def _add_master_ext(db_session: Any, staff_id: str, **kwargs: Any) -> Master:
    defaults: dict[str, Any] = {"specialty": "живопись", "color": "#5B8C7A"}
    defaults.update(kwargs)
    ext = Master(staff_id=staff_id, **defaults)
    db_session.add(ext)
    await db_session.flush()
    return ext


async def _add_user(db_session: Any, staff_id: str, **kwargs: Any) -> User:
    defaults: dict[str, Any] = {
        "phone": f"+7999{_uuid.uuid4().hex[:7]}",
        "password_hash": "x",
        "role": "admin",
    }
    defaults.update(kwargs)
    user = User(staff_id=staff_id, **defaults)
    db_session.add(user)
    await db_session.flush()
    return user


async def _staff_flags(
    db_session: Any, staff_id: str
) -> tuple[bool, bool | None, bool | None]:
    """(staff.is_active, masters.is_active, users.is_active) via one DB read
    each — fresh column scalars, immune to identity-map staleness."""
    staff_active = (await db_session.execute(
        select(Staff.is_active).where(Staff.id == staff_id)
    )).scalar_one()
    master_active = (await db_session.execute(
        select(Master.is_active).where(Master.staff_id == staff_id)
    )).scalar_one_or_none()
    user_active = (await db_session.execute(
        select(User.is_active).where(User.staff_id == staff_id)
    )).scalar_one_or_none()
    return staff_active, master_active, user_active


# ─── restore: the person only (Corridor 1 — stays decorated) ───────────────

async def test_restore_returns_person_only(db_session) -> None:
    """Restore returns the PERSON; master/user keep their own flags
    (domain-rules: «учётка/мастер возвращаются своими флагами явно»).

    Setup archives everything through the ``archive_staff`` scenario
    (the D6-default dismissal), then restore flips the person back."""
    from src.usecases.staff import archive_staff

    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)
    await _add_user(db_session, staff.id)
    staff_id = staff.id
    ok = await archive_staff(
        None, db_session=db_session, id=staff_id,
        archive_master=True, archive_user=True,
    )
    assert ok is True

    ok = await get_staff_service().restore(db_session, staff_id)
    assert ok is True
    staff_active, master_active, user_active = await _staff_flags(
        db_session, staff_id
    )
    assert staff_active is True
    assert master_active is False  # stays archived until its own toggle
    assert user_active is False


async def test_restore_missing_staff_returns_false(db_session) -> None:
    assert await get_staff_service().restore(db_session, "ghost") is False


async def test_restore_is_decorated(db_session) -> None:
    """US-5: restore stays a Corridor-1 ``@transactional`` method (it is
    NOT part of the Task 3 demolition)."""
    from src.services.decorators import _TRANSACTIONAL_MARKER

    assert hasattr(get_staff_service().restore, _TRANSACTIONAL_MARKER)


# ─── deletion resolutions (matrix inherited from T2) ───────────────────────


async def test_resolve_delete_cascades_card_extension_user_joins(db_session) -> None:
    """All-auto deps: card + masters row + user + both join tables die in
    one transaction; dictionaries survive."""
    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)
    await _add_user(db_session, staff.id)
    position = await _add_position(db_session)
    await db_session.execute(
        staff_positions.insert().values(
            staff_id=staff.id, position_id=position.id
        )
    )
    await db_session.flush()
    staff_id = staff.id

    assert await get_staff_service().resolve_delete(db_session, staff_id, {}) is True

    assert await db_session.get(Staff, staff_id) is None
    assert (await db_session.execute(
        select(Master).where(Master.staff_id == staff_id)
    )).scalar_one_or_none() is None
    assert (await db_session.execute(
        select(User).where(User.staff_id == staff_id)
    )).scalar_one_or_none() is None
    assert (await db_session.execute(
        select(staff_positions.c.position_id)
        .where(staff_positions.c.staff_id == staff_id)
    )).scalars().all() == []
    assert await db_session.get(Position, position.id) is not None


async def test_resolve_delete_blocked_by_activities(db_session) -> None:
    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)
    service_ = Service(
        title="S", description="d", image_url="i", specialty="живопись",
        min_age=6, duration=90, record_info="r",
    )
    location = Location(title="L", capacity=10)
    db_session.add_all([service_, location])
    await db_session.flush()
    db_session.add(Activity(
        master_id=staff.id, service_id=service_.id, location_id=location.id,
        start=datetime.now(UTC) + timedelta(days=1), duration=90,
        capacity=10, is_private=False,
    ))
    await db_session.commit()  # persist setup — rollback below must only
    staff_id = staff.id        # undo the failed resolve, not the fixture

    with pytest.raises(BlockingDepsError):
        await get_staff_service().resolve_delete(db_session, staff_id, {})
    await db_session.rollback()
    assert await db_session.get(Staff, staff_id) is not None


# ─── list: composite response (master + positions filled per row) ──────────


async def test_list_returns_cards_with_master_and_positions(db_session) -> None:
    """Paginated list fills master/position_ids per row (GH #205 envelope)."""
    with_master = await _add_staff(db_session, first_name="М", sort_order=1)
    await _add_master_ext(db_session, with_master.id)
    bare = await _add_staff(db_session, first_name="С", sort_order=2)
    position = await _add_position(db_session)
    await db_session.execute(
        staff_positions.insert().values(
            staff_id=bare.id, position_id=position.id
        )
    )
    await db_session.flush()

    result = await get_staff_service().list(db_session, page=1, per_page=20)
    assert result.total == 2
    by_id = {item.id: item for item in result.items}
    assert by_id[with_master.id].master is not None
    assert by_id[with_master.id].position_ids == []
    assert by_id[bare.id].master is None
    assert by_id[bare.id].position_ids == [position.id]


# ─── MASTER_NOT_ACTIVE: activity-side TOCTOU guard (spec «Валидация») ──────


async def _activity_deps(db_session) -> tuple[str, str]:
    service_ = Service(
        title="S", description="d", image_url="i", specialty="живопись",
        min_age=6, duration=90, record_info="r",
    )
    location = Location(title="L", capacity=10)
    db_session.add_all([service_, location])
    await db_session.flush()
    return service_.id, location.id


def _activity_payload(master_id: str, service_id: str, location_id: str) -> ActivityCreate:
    return ActivityCreate(
        master_id=master_id, service_id=service_id, location_id=location_id,
        start=datetime.now(UTC) + timedelta(days=1),
        duration=90, capacity=10,
    )


async def test_activity_create_on_active_master_succeeds(db_session) -> None:
    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)
    service_id, location_id = await _activity_deps(db_session)

    created = await get_activity_service().create(
        db_session, _activity_payload(staff.id, service_id, location_id)
    )
    assert created.master_id == staff.id


async def test_activity_create_on_archived_master_raises_422(db_session) -> None:
    """TOCTOU guard: the picker list may be stale — the server still
    refuses activities on masters.is_active=false (MASTER_NOT_ACTIVE)."""
    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id, is_active=False)
    service_id, location_id = await _activity_deps(db_session)

    with pytest.raises(HTTPException) as exc_info:
        await get_activity_service().create(
            db_session, _activity_payload(staff.id, service_id, location_id)
        )
    assert exc_info.value.status_code == 422
    assert exc_info.value.detail["code"] == "MASTER_NOT_ACTIVE"


async def test_activity_patch_transfer_to_archived_master_raises_422(
    db_session,
) -> None:
    """Перенос занятия на неактивного мастера — тот же код ошибки."""
    from src.schemas.activity import ActivityPatch

    active = await _add_staff(db_session, first_name="Ж")
    await _add_master_ext(db_session, active.id)
    inactive = await _add_staff(db_session, first_name="У")
    await _add_master_ext(db_session, inactive.id, is_active=False)
    service_id, location_id = await _activity_deps(db_session)
    activity = await get_activity_service().create(
        db_session, _activity_payload(active.id, service_id, location_id)
    )

    with pytest.raises(HTTPException) as exc_info:
        await get_activity_service().patch(
            db_session, activity.id, ActivityPatch(master_id=inactive.id),
        )
    assert exc_info.value.status_code == 422
    assert exc_info.value.detail["code"] == "MASTER_NOT_ACTIVE"
