"""StaffService tests — GH #266 Task 3 (composite card operations).

Covers the composite contract (spec D5/D6/D8, domain-rules/staff.md
«Сценарные операции»):

* ``create``/``update`` — ONE transaction per call: staff card +
  masters-extension upsert/remove + staff_positions replace + user create
  (create only). Failure anywhere → nothing persists.
* ``archive(id, {archive_master, archive_user})`` — D6 checkboxes applied
  ONLY to existing ACTIVE links; unchecked links keep their flags (three
  independent flags, D3 — no hidden cascades).
* ``restore`` — returns the PERSON only; master/user flags are restored by
  their own explicit toggles.
* deletion resolutions — inherited executor over the Staff matrix
  (activities block; users/masters/master_tags/staff_positions cascade).
"""

from __future__ import annotations

import uuid as _uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from src.domain.deletion import BlockingDepsError
from src.domain.errors import (
    ColorRequiredError,
    PositionNotFoundError,
    SpecialtyRequiredError,
)
from src.auth.passwords import hash_password, verify_password
from src.models.activity import Activity
from src.models.location import Location
from src.models.master import Master
from src.models.position import Position, staff_positions
from src.models.service import Service
from src.models.staff import Staff
from src.models.user import User
from src.schemas.activity import ActivityCreate
from src.schemas.staff import StaffCreate, StaffPatch, StaffUpdate
from src.schemas.position import PositionCreate
from src.services.activity import get_activity_service
from src.services.position import get_position_service
from src.services.staff import get_staff_service

pytestmark = pytest.mark.asyncio


# ─── helpers ────────────────────────────────────────────────────────────────


async def _add_position(db_session, **kwargs) -> Position:
    position = Position(**kwargs) if kwargs else Position(title="СММ")
    db_session.add(position)
    await db_session.flush()
    return position


async def _add_staff(db_session, **kwargs) -> Staff:
    kwargs.setdefault("first_name", "А")
    kwargs.setdefault("last_name", "Б")
    staff = Staff(**kwargs)
    db_session.add(staff)
    await db_session.flush()
    return staff


async def _add_master_ext(db_session, staff_id: str, **kwargs) -> Master:
    defaults = {"specialty": "живопись", "color": "#5B8C7A"}
    defaults.update(kwargs)
    ext = Master(staff_id=staff_id, **defaults)
    db_session.add(ext)
    await db_session.flush()
    return ext


async def _add_user(db_session, staff_id: str, **kwargs) -> User:
    defaults = {
        "phone": f"+7999{_uuid.uuid4().hex[:7]}",
        "password_hash": "x",
        "role": "admin",
    }
    defaults.update(kwargs)
    user = User(staff_id=staff_id, **defaults)
    db_session.add(user)
    await db_session.flush()
    return user


async def _staff_flags(db_session, staff_id: str) -> tuple[bool, bool | None, bool | None]:
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


def _create_payload(**overrides) -> StaffCreate:
    return StaffCreate(
        first_name="Ольга", last_name="Иванова", **overrides
    )


# ─── create: card only / + master section / + positions / + user ────────────


async def test_create_without_master_block(db_session) -> None:
    """Plain card (SMM person, S1): staff row only — no masters row, no
    user, no positions; response echoes master=None / position_ids=[]."""
    created = await get_staff_service().create(db_session, _create_payload())

    assert created.first_name == "Ольга"
    assert created.master is None
    assert created.position_ids == []
    assert created.archived is False
    staff_id = created.id
    assert await db_session.get(Staff, staff_id) is not None
    assert (await db_session.execute(
        select(Master).where(Master.staff_id == staff_id)
    )).scalar_one_or_none() is None
    assert (await db_session.execute(
        select(User).where(User.staff_id == staff_id)
    )).scalar_one_or_none() is None


async def test_create_with_master_block(db_session) -> None:
    """Card + master section (S7): masters row lands ACTIVE with the sent
    specialty/color; response echoes the section."""
    created = await get_staff_service().create(db_session, _create_payload(
        master={"specialty": "керамика", "color": "#FF0000"},
    ))

    assert created.master is not None
    assert created.master.specialty == "керамика"
    assert created.master.color == "#FF0000"
    ext = (await db_session.execute(
        select(Master).where(Master.staff_id == created.id)
    )).scalar_one()
    assert ext.is_active is True


async def test_create_with_positions_links_staff_positions(db_session) -> None:
    """Card + position_ids: M2M rows land; response echoes the ids."""
    p1 = await _add_position(db_session, id="master", title="Мастер", is_system=True)
    p2 = await _add_position(db_session)

    created = await get_staff_service().create(db_session, _create_payload(
        position_ids=[p1.id, p2.id],
    ))

    assert sorted(created.position_ids) == sorted([p1.id, p2.id])
    linked = (await db_session.execute(
        select(staff_positions.c.position_id)
        .where(staff_positions.c.staff_id == created.id)
    )).scalars().all()
    assert sorted(linked) == sorted([p1.id, p2.id])


async def test_create_with_unknown_position_raises(db_session) -> None:
    """position_ids referencing a missing dictionary row → PositionNotFoundError."""
    with pytest.raises(PositionNotFoundError):
        await get_staff_service().create(
            db_session, _create_payload(position_ids=["ghost-id"])
        )


# ─── create: master-section validation (D5 required fields) ────────────────


async def test_create_master_block_without_specialty_raises(db_session) -> None:
    with pytest.raises(SpecialtyRequiredError):
        await get_staff_service().create(db_session, _create_payload(
            master={"color": "#FF0000"},
        ))


async def test_create_master_block_without_color_raises(db_session) -> None:
    with pytest.raises(ColorRequiredError):
        await get_staff_service().create(db_session, _create_payload(
            master={"specialty": "керамика"},
        ))


async def test_create_master_block_blank_specialty_raises(db_session) -> None:
    """Empty/whitespace specialty is 'missing' too (presence, not just key)."""
    with pytest.raises(SpecialtyRequiredError):
        await get_staff_service().create(db_session, _create_payload(
            master={"specialty": "   ", "color": "#FF0000"},
        ))


# ─── create: user checkbox (D6) ─────────────────────────────────────────────


async def test_create_with_user_creates_linked_account(db_session) -> None:
    """create_user {phone, password}: user row lands linked to the card with
    a verifiable Argon2 hash; master-section card → role "master"."""
    created = await get_staff_service().create(db_session, _create_payload(
        master={"specialty": "живопись", "color": "#5B8C7A"},
        create_user={"phone": "+79995556677", "password": "secret12345"},
    ))

    user = (await db_session.execute(
        select(User).where(User.staff_id == created.id)
    )).scalar_one()
    assert user.phone == "+79995556677"
    assert user.is_active is True
    assert user.role == "master"
    assert verify_password("secret12345", user.password_hash)


async def test_create_with_user_without_master_gets_admin_role(db_session) -> None:
    """No master section → created account gets the "admin" role."""
    created = await get_staff_service().create(db_session, _create_payload(
        create_user={"phone": "+79995556678", "password": "secret12345"},
    ))
    user = (await db_session.execute(
        select(User).where(User.staff_id == created.id)
    )).scalar_one()
    assert user.role == "admin"


async def test_create_with_user_short_password_raises(db_session) -> None:
    """Password policy (GH #247 §3.2) applies to card-created accounts."""
    with pytest.raises(Exception):  # PasswordPolicyError
        await get_staff_service().create(db_session, _create_payload(
            create_user={"phone": "+79995556679", "password": "short"},
        ))


# ─── create: atomicity — ONE transaction, all-or-nothing ───────────────────


async def test_create_rolls_back_everything_on_failure(db_session) -> None:
    """Bad position_id late in the composite → NO staff/masters/user rows
    persist (single transaction, spec «API (после)»: три таблицы атомарно)."""
    await _add_position(db_session, id="master", title="Мастер", is_system=True)
    staff_count_before = len(
        (await db_session.execute(select(Staff))).scalars().all()
    )

    with pytest.raises(PositionNotFoundError):
        await get_staff_service().create(db_session, _create_payload(
            master={"specialty": "живопись", "color": "#5B8C7A"},
            position_ids=["master", "ghost"],
            create_user={"phone": "+79995556680", "password": "secret12345"},
        ))

    await db_session.rollback()
    staff_rows = (await db_session.execute(select(Staff))).scalars().all()
    assert len(staff_rows) == staff_count_before
    assert (await db_session.execute(select(Master))).scalars().all() == []
    assert (await db_session.execute(select(User))).scalars().all() == []


# ─── update: composite one-transaction semantics ────────────────────────────


async def test_update_replaces_positions_set(db_session) -> None:
    """PUT position_ids = full replace (old links die, new land)."""
    keep = await _add_position(db_session, id="master", title="Мастер", is_system=True)
    drop = await _add_position(db_session)
    staff = await _add_staff(db_session)
    await db_session.execute(
        staff_positions.insert().values(
            staff_id=staff.id, position_id=keep.id
        )
    )
    await db_session.execute(
        staff_positions.insert().values(
            staff_id=staff.id, position_id=drop.id
        )
    )
    await db_session.flush()

    updated = await get_staff_service().update(
        db_session, staff.id,
        StaffUpdate(first_name="А", last_name="Б", position_ids=[keep.id]),
    )
    assert updated is not None and updated.position_ids == [keep.id]
    linked = (await db_session.execute(
        select(staff_positions.c.position_id)
        .where(staff_positions.c.staff_id == staff.id)
    )).scalars().all()
    assert linked == [keep.id]


async def test_update_master_section_upsert(db_session) -> None:
    """Adding a section to a bare card creates the masters row; sending the
    section again updates fields in place (upsert, S2)."""
    staff = await _add_staff(db_session)
    service = get_staff_service()

    added = await service.update(
        db_session, staff.id,
        StaffUpdate(first_name="А", last_name="Б",
                    master={"specialty": "живопись", "color": "#111111"}),
    )
    assert added is not None and added.master is not None
    assert added.master.specialty == "живопись"

    changed = await service.update(
        db_session, staff.id,
        StaffUpdate(first_name="А", last_name="Б",
                    master={"specialty": "керамика, живопись", "color": "#222222"}),
    )
    assert changed is not None and changed.master is not None
    assert changed.master.specialty == "керамика, живопись"
    assert changed.master.color == "#222222"
    exts = (await db_session.execute(
        select(Master).where(Master.staff_id == staff.id)
    )).scalars().all()
    assert len(exts) == 1  # upsert, not a second row


async def test_update_master_null_removes_section(db_session) -> None:
    """master: null on a card without activities → the masters row dies."""
    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)

    updated = await get_staff_service().update(
        db_session, staff.id,
        StaffUpdate(first_name="А", last_name="Б", master=None),
    )
    assert updated is not None and updated.master is None
    assert (await db_session.execute(
        select(Master).where(Master.staff_id == staff.id)
    )).scalar_one_or_none() is None


async def test_update_master_null_blocked_by_activities(db_session) -> None:
    """master: null with activities → BlockingDepsError (D7: удаление
    masters-строки заблокировано занятиями), section survives."""
    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)
    service_ = Service(
        title="S", description="d", image_url="i", specialty="живопись",
        min_age=6, duration=90, record_info="r",
    )
    location = Location(name="L", capacity=10)
    db_session.add_all([service_, location])
    await db_session.flush()
    db_session.add(Activity(
        master_id=staff.id, service_id=service_.id, location_id=location.id,
        start=datetime.now(UTC) + timedelta(days=1), duration=90,
        capacity=10, is_private=False,
    ))
    await db_session.commit()  # persist setup — rollback below must only
    staff_id = staff.id        # undo the failed update, not the fixture

    with pytest.raises(BlockingDepsError):
        await get_staff_service().update(
            db_session, staff_id,
            StaffUpdate(first_name="А", last_name="Б", master=None),
        )
    await db_session.rollback()
    assert (await db_session.execute(
        select(Master).where(Master.staff_id == staff_id)
    )).scalar_one_or_none() is not None


async def test_update_missing_staff_returns_none(db_session) -> None:
    updated = await get_staff_service().update(
        db_session, "ghost", StaffUpdate(first_name="А", last_name="Б"),
    )
    assert updated is None


async def test_patch_absent_master_keeps_section(db_session) -> None:
    """PATCH without the master key leaves the section untouched."""
    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)

    patched = await get_staff_service().patch(
        db_session, staff.id, StaffPatch(first_name="В"),
    )
    assert patched is not None
    assert patched.first_name == "В"
    assert patched.master is not None
    assert patched.master.specialty == "живопись"


async def test_patch_null_master_removes_section(db_session) -> None:
    """PATCH master=null (explicit) removes the section."""
    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)

    patched = await get_staff_service().patch(
        db_session, staff.id, StaffPatch(master=None),
    )
    assert patched is not None and patched.master is None
    assert (await db_session.execute(
        select(Master).where(Master.staff_id == staff.id)
    )).scalar_one_or_none() is None


# ─── archive: D6 checkboxes — no hidden cascades (D3) ──────────────────────


async def test_archive_defaults_archive_master_and_user(db_session) -> None:
    """No body = consent to the preselected checkboxes: person + active
    master + active user all archive in ONE call."""
    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)
    user = await _add_user(db_session, staff.id)

    ok = await get_staff_service().archive(db_session, staff.id)
    assert ok is True

    staff_active, master_active, user_active = await _staff_flags(
        db_session, staff.id
    )
    assert staff_active is False
    assert master_active is False
    assert user_active is False


async def test_archive_unchecked_master_stays_active(db_session) -> None:
    """S6: archive_master=False — the fired person keeps the schedule link
    (штатное состояние D3); user checkbox still applies."""
    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)
    user = await _add_user(db_session, staff.id)

    ok = await get_staff_service().archive(
        db_session, staff.id, archive_master=False, archive_user=True,
    )
    assert ok is True
    staff_active, master_active, user_active = await _staff_flags(
        db_session, staff.id
    )
    assert staff_active is False
    assert master_active is True
    assert user_active is False


async def test_archive_unchecked_user_stays_active(db_session) -> None:
    """S6: archive_user=False — login stays allowed; master still archives."""
    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)
    user = await _add_user(db_session, staff.id)

    ok = await get_staff_service().archive(
        db_session, staff.id, archive_master=True, archive_user=False,
    )
    assert ok is True
    staff_active, master_active, user_active = await _staff_flags(
        db_session, staff.id
    )
    assert master_active is False
    assert user_active is True


async def test_archive_skips_missing_and_already_archived_links(db_session) -> None:
    """Checkboxes apply ONLY to existing ACTIVE links (spec «API (после)»):
    no masters row → no-op; an already-archived master stays archived (an
    archive call never silently RESTORES anything)."""
    staff = await _add_staff(db_session)  # no master ext, no user

    ok = await get_staff_service().archive(db_session, staff.id)
    assert ok is True  # bare card archives fine

    await _add_master_ext(db_session, staff.id, is_active=False)
    ok = await get_staff_service().archive(db_session, staff.id)
    assert ok is True
    ext = (await db_session.execute(
        select(Master).where(Master.staff_id == staff.id)
    )).scalar_one()
    assert ext.is_active is False  # untouched, not resurrected


async def test_archive_missing_staff_returns_false(db_session) -> None:
    assert await get_staff_service().archive(db_session, "ghost") is False


async def test_restore_returns_person_only(db_session) -> None:
    """Restore returns the PERSON; master/user keep their own flags
    (domain-rules: «учётка/мастер возвращаются своими флагами явно»)."""
    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)
    user = await _add_user(db_session, staff.id)
    service = get_staff_service()
    await service.archive(db_session, staff.id)  # everything archived

    ok = await service.restore(db_session, staff.id)
    assert ok is True
    staff_active, master_active, user_active = await _staff_flags(
        db_session, staff.id
    )
    assert staff_active is True
    assert master_active is False  # stays archived until its own toggle
    assert user_active is False


async def test_restore_missing_staff_returns_false(db_session) -> None:
    assert await get_staff_service().restore(db_session, "ghost") is False


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
    location = Location(name="L", capacity=10)
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
    location = Location(name="L", capacity=10)
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
