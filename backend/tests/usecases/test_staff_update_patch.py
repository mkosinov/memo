"""Unit tests for the ``update_staff`` / ``patch_staff`` scenarios (GH #326 Task 3).

Pin-first oracle (plan #326 Task 3): the PUT/PATCH branch grids, step
order, null-stripping, and atomicity pinned BEFORE the StaffService
demolition; the scenarios must stay behavior-identical (spec
§Behavioral Delta: до = после).

- ``update_staff`` — PUT: card fields + section upsert/remove + position
  full-replace + role template, ONE transaction;
- ``patch_staff`` — PATCH: three-state ``master`` (absent/null/payload),
  sent-sets, null-stripping via ``NOT_NULL_FIELDS`` ({first_name,
  last_name, sort_order} — client intent "don't change", not "set null").

CALLING CONVENTION: selfless scenario — leading ``None`` + keyword args.

Authorization negative case (master role → 403 on PUT/PATCH) is covered
by ``tests/test_master_scope_contract.py`` — not duplicated here.
"""

from __future__ import annotations

import uuid as _uuid
from typing import Any

import pytest
from sqlalchemy import select

from src.domain.deletion import BlockingDepsError
from src.models.activity import Activity
from src.models.location import Location
from src.models.master import Master
from src.models.position import Position, staff_positions
from src.models.service import Service
from src.models.staff import Staff
from src.models.user import User
from src.schemas.staff import StaffPatch, StaffUpdate
from src.services.decorators import _TRANSACTIONAL_MARKER

pytestmark = pytest.mark.asyncio


# ─── helpers (direct ORM seeding, per the sibling usecases pattern) ──────────


async def _add_staff(db_session: Any, **kwargs: Any) -> Staff:
    kwargs.setdefault("first_name", "А")
    kwargs.setdefault("last_name", "Б")
    staff = Staff(**kwargs)
    db_session.add(staff)
    await db_session.flush()
    return staff


async def _add_position(db_session: Any, **kwargs: Any) -> Position:
    position = Position(**kwargs) if kwargs else Position(title="СММ")
    db_session.add(position)
    await db_session.flush()
    return position


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


async def _link_position(db_session: Any, staff_id: str, position_id: str) -> None:
    await db_session.execute(
        staff_positions.insert().values(staff_id=staff_id, position_id=position_id)
    )
    await db_session.flush()


async def _role_of(db_session: Any, staff_id: str) -> str:
    return (await db_session.execute(
        select(User.role).where(User.staff_id == staff_id)
    )).scalar_one()


def _drain(q: Any) -> list[tuple[set[str], object]]:
    events = []
    while not q.empty():
        events.append(q.get_nowait())
    return events


@pytest.fixture
def subscriber():
    from src.events.hub import hub

    q = hub.subscribe()
    try:
        yield q
    finally:
        hub.unsubscribe(q)


class StepBoomError(RuntimeError):
    """Injected mid-scenario failure — must propagate, never be swallowed."""


# ─── canon shape ─────────────────────────────────────────────────────────────


async def test_update_and_patch_are_transactional() -> None:
    from src.usecases.staff import patch_staff, update_staff

    assert hasattr(update_staff, _TRANSACTIONAL_MARKER)
    assert hasattr(patch_staff, _TRANSACTIONAL_MARKER)


# ─── update_staff (PUT) ──────────────────────────────────────────────────────


async def test_update_card_fields_and_response(db_session) -> None:
    from src.usecases.staff import update_staff

    staff = await _add_staff(db_session)

    updated = await update_staff(
        None, db_session=db_session, id=staff.id,
        data=StaffUpdate(
            first_name="Ольга2", last_name="Иванова2",
            avatar_url="http://x", sort_order=7,
        ),
    )
    assert updated is not None
    assert updated.first_name == "Ольга2"
    assert updated.last_name == "Иванова2"
    assert updated.avatar_url == "http://x"
    assert updated.sort_order == 7
    stored = await db_session.get(Staff, staff.id)
    assert stored is not None
    assert stored.first_name == "Ольга2"
    assert stored.sort_order == 7


async def test_update_section_upsert_then_change(db_session) -> None:
    """S2: adding a section creates the masters row; sending it again
    updates in place (upsert — never a second row)."""
    from src.usecases.staff import update_staff

    staff = await _add_staff(db_session)

    added = await update_staff(
        None, db_session=db_session, id=staff.id,
        data=StaffUpdate(
            first_name="А", last_name="Б",
            master={"specialty": "живопись", "color": "#111111"},
        ),
    )
    assert added is not None and added.master is not None
    assert added.master.specialty == "живопись"

    changed = await update_staff(
        None, db_session=db_session, id=staff.id,
        data=StaffUpdate(
            first_name="А", last_name="Б",
            master={"specialty": "керамика", "color": "#222222"},
        ),
    )
    assert changed is not None and changed.master is not None
    assert changed.master.specialty == "керамика"
    assert changed.master.color == "#222222"
    exts = (await db_session.execute(
        select(Master).where(Master.staff_id == staff.id)
    )).scalars().all()
    assert len(exts) == 1


async def test_update_null_master_removes_section(db_session) -> None:
    from src.usecases.staff import update_staff

    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)

    updated = await update_staff(
        None, db_session=db_session, id=staff.id,
        data=StaffUpdate(first_name="А", last_name="Б", master=None),
    )
    assert updated is not None and updated.master is None
    assert (await db_session.execute(
        select(Master).where(Master.staff_id == staff.id)
    )).scalar_one_or_none() is None


async def test_update_null_master_blocked_by_activities(db_session) -> None:
    """D7: removing a section with live activities → BlockingDepsError,
    the row survives."""
    from datetime import UTC, datetime, timedelta

    from src.usecases.staff import update_staff

    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)
    service = Service(
        title="S", description="d", image_url="i", specialty="живопись",
        min_age=6, duration=90, record_info="r",
    )
    location = Location(title="L", capacity=10)
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
        await update_staff(
            None, db_session=db_session, id=staff_id,
            data=StaffUpdate(first_name="А", last_name="Б", master=None),
        )
    await db_session.rollback()
    assert (await db_session.execute(
        select(Master).where(Master.staff_id == staff_id)
    )).scalar_one_or_none() is not None


async def test_update_replaces_positions_full_set(db_session) -> None:
    from src.usecases.staff import update_staff

    keep = await _add_position(db_session, id="master", title="Мастер", is_system=True)
    drop = await _add_position(db_session)
    staff = await _add_staff(db_session)
    await _link_position(db_session, staff.id, keep.id)
    await _link_position(db_session, staff.id, drop.id)

    updated = await update_staff(
        None, db_session=db_session, id=staff.id,
        data=StaffUpdate(first_name="А", last_name="Б", position_ids=[keep.id]),
    )
    assert updated is not None and updated.position_ids == [keep.id]
    linked = (await db_session.execute(
        select(staff_positions.c.position_id)
        .where(staff_positions.c.staff_id == staff.id)
    )).scalars().all()
    assert linked == [keep.id]


async def test_update_position_set_applies_role_template(db_session) -> None:
    """S8/D10: PUT carries the position set → the linked account follows
    the template; senior admin > master; non-anchored → untouched."""
    from src.usecases.staff import update_staff

    await _add_position(db_session, id="master", title="Мастер", is_system=True)
    await _add_position(db_session, id="admin", title="Админ", is_system=True)
    smm = await _add_position(db_session)
    staff = await _add_staff(db_session)
    await _add_user(db_session, staff.id, role="admin")

    await update_staff(
        None, db_session=db_session, id=staff.id,
        data=StaffUpdate(first_name="А", last_name="Б", position_ids=["master"]),
    )
    assert await _role_of(db_session, staff.id) == "master"

    await update_staff(
        None, db_session=db_session, id=staff.id,
        data=StaffUpdate(first_name="А", last_name="Б", position_ids=["master", "admin"]),
    )
    assert await _role_of(db_session, staff.id) == "admin"

    # Non-anchored set (СММ) — losing the anchors is NOT a downgrade.
    await update_staff(
        None, db_session=db_session, id=staff.id,
        data=StaffUpdate(first_name="А", last_name="Б", position_ids=[smm.id]),
    )
    assert await _role_of(db_session, staff.id) == "admin"


async def test_update_explicit_role_beats_template(db_session) -> None:
    from src.usecases.staff import update_staff

    await _add_position(db_session, id="master", title="Мастер", is_system=True)
    staff = await _add_staff(db_session)
    await _add_user(db_session, staff.id, role="admin")

    await update_staff(
        None, db_session=db_session, id=staff.id,
        data=StaffUpdate(
            first_name="А", last_name="Б",
            position_ids=["master"], role="admin",
        ),
    )
    assert await _role_of(db_session, staff.id) == "admin"


async def test_update_without_user_template_is_noop(db_session) -> None:
    """No linked account → the template has nothing to touch; the update
    succeeds."""
    from src.usecases.staff import update_staff

    await _add_position(db_session, id="master", title="Мастер", is_system=True)
    staff = await _add_staff(db_session)

    updated = await update_staff(
        None, db_session=db_session, id=staff.id,
        data=StaffUpdate(first_name="А", last_name="Б", position_ids=["master"]),
    )
    assert updated is not None


async def test_update_missing_returns_none(db_session) -> None:
    from src.usecases.staff import update_staff

    assert await update_staff(
        None, db_session=db_session, id="ghost",
        data=StaffUpdate(first_name="А", last_name="Б"),
    ) is None


# ─── patch_staff (PATCH) ─────────────────────────────────────────────────────


async def test_patch_sent_fields_only_keeps_sections(db_session) -> None:
    from src.usecases.staff import patch_staff

    pos = await _add_position(db_session)
    staff = await _add_staff(db_session, first_name="Ольга")
    await _add_master_ext(db_session, staff.id)
    await _link_position(db_session, staff.id, pos.id)

    patched = await patch_staff(
        None, db_session=db_session, id=staff.id, data=StaffPatch(first_name="Патч"),
    )
    assert patched is not None
    assert patched.first_name == "Патч"
    assert patched.last_name == "Б"  # unsent → kept
    assert patched.master is not None  # kept
    assert patched.master.specialty == "живопись"
    assert patched.position_ids == [pos.id]  # kept


async def test_patch_null_stripping_not_null_fields(db_session) -> None:
    """PATCH null-stripping: explicit ``null`` on a NOT NULL column
    ({first_name, last_name, sort_order}) means "don't change", not "set
    null" — the row keeps its values (GenericService._patch_payload /
    StaffService.NOT_NULL_FIELDS semantics, unchanged)."""
    from src.usecases.staff import patch_staff

    staff = await _add_staff(db_session, first_name="Имя", sort_order=5)

    patched = await patch_staff(
        None, db_session=db_session, id=staff.id,
        data=StaffPatch(first_name=None, last_name=None, sort_order=None),
    )
    assert patched is not None
    assert patched.first_name == "Имя"
    assert patched.last_name == "Б"
    assert patched.sort_order == 5
    stored = await db_session.get(Staff, staff.id)
    assert stored is not None
    assert stored.first_name == "Имя"
    assert stored.sort_order == 5


async def test_patch_avatar_null_applied(db_session) -> None:
    """avatar_url is NULLABLE — a sent null DOES clear it (stripping only
    protects NOT NULL fields)."""
    from src.usecases.staff import patch_staff

    staff = await _add_staff(db_session, avatar_url="http://old")

    patched = await patch_staff(
        None, db_session=db_session, id=staff.id, data=StaffPatch(avatar_url=None),
    )
    assert patched is not None
    assert patched.avatar_url is None


async def test_patch_absent_master_keeps_section(db_session) -> None:
    from src.usecases.staff import patch_staff

    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)

    patched = await patch_staff(
        None, db_session=db_session, id=staff.id, data=StaffPatch(first_name="В"),
    )
    assert patched is not None
    assert patched.master is not None
    assert patched.master.specialty == "живопись"


async def test_patch_null_master_removes_section(db_session) -> None:
    from src.usecases.staff import patch_staff

    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)

    patched = await patch_staff(
        None, db_session=db_session, id=staff.id, data=StaffPatch(master=None),
    )
    assert patched is not None and patched.master is None
    assert (await db_session.execute(
        select(Master).where(Master.staff_id == staff.id)
    )).scalar_one_or_none() is None


async def test_patch_master_payload_upserts(db_session) -> None:
    from src.usecases.staff import patch_staff

    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id, specialty="старая", color="#111111")

    patched = await patch_staff(
        None, db_session=db_session, id=staff.id,
        data=StaffPatch(master={"specialty": "новая", "color": "#222222"}),
    )
    assert patched is not None and patched.master is not None
    assert patched.master.specialty == "новая"
    assert patched.master.color == "#222222"


async def test_patch_position_set_applies_role_template(db_session) -> None:
    from src.usecases.staff import patch_staff

    await _add_position(db_session, id="admin", title="Админ", is_system=True)
    staff = await _add_staff(db_session)
    await _add_user(db_session, staff.id, role="master")

    patched = await patch_staff(
        None, db_session=db_session, id=staff.id,
        data=StaffPatch(position_ids=["admin"]),
    )
    assert patched is not None
    assert await _role_of(db_session, staff.id) == "admin"


async def test_patch_explicit_role_without_positions_applies(db_session) -> None:
    """PATCH role-only: an explicit role with NO position-set change still
    applies (manual role editing remains) — positions untouched."""
    from src.usecases.staff import patch_staff

    await _add_position(db_session, id="master", title="Мастер", is_system=True)
    staff = await _add_staff(db_session)
    await _link_position(db_session, staff.id, "master")
    await _add_user(db_session, staff.id, role="admin")

    patched = await patch_staff(
        None, db_session=db_session, id=staff.id, data=StaffPatch(role="master"),
    )
    assert patched is not None
    assert patched.position_ids == ["master"]  # untouched
    assert await _role_of(db_session, staff.id) == "master"


async def test_patch_without_role_keys_keeps_role(db_session) -> None:
    from src.usecases.staff import patch_staff

    staff = await _add_staff(db_session)
    await _add_user(db_session, staff.id, role="admin")

    patched = await patch_staff(
        None, db_session=db_session, id=staff.id, data=StaffPatch(first_name="В"),
    )
    assert patched is not None
    assert await _role_of(db_session, staff.id) == "admin"


async def test_patch_missing_returns_none(db_session) -> None:
    from src.usecases.staff import patch_staff

    assert await patch_staff(
        None, db_session=db_session, id="ghost", data=StaffPatch(first_name="x"),
    ) is None


# ─── event grids (GH #239, pinned BEFORE the demolition — the oracle) ───────


async def test_update_grid_card_only(db_session, subscriber) -> None:
    """Card-only PUT still replaces the position set (PUT semantics: the
    set is ALWAYS part of the body) → {staff, staff_positions} — probed
    against the pre-refactor flow: ``_replace_positions`` marks
    unconditionally, empty set included."""
    from src.usecases.staff import update_staff

    staff = await _add_staff(db_session)
    await db_session.commit()
    _drain(subscriber)

    updated = await update_staff(
        None, db_session=db_session, id=staff.id,
        data=StaffUpdate(first_name="Нов", last_name="Б", position_ids=[]),
    )
    assert updated is not None

    events = _drain(subscriber)
    assert len(events) == 1, f"ONE event batch expected, got {events}"
    entities, origin = events[0]
    assert entities == {"staff", "staff_positions"}, (
        f"card-only PUT replaces the (empty) set → {{'staff', "
        f"'staff_positions'}}, got {events}"
    )
    assert origin is None


async def test_update_grid_full_replacement(db_session, subscriber) -> None:
    """PUT with section upsert + non-empty positions → {staff, masters,
    staff_positions} (+ users when the role actually changes)."""
    from src.usecases.staff import update_staff

    pos = await _add_position(db_session)
    staff = await _add_staff(db_session)
    await db_session.commit()
    _drain(subscriber)

    updated = await update_staff(
        None, db_session=db_session, id=staff.id,
        data=StaffUpdate(
            first_name="А", last_name="Б",
            master={"specialty": "живопись", "color": "#111111"},
            position_ids=[pos.id],
        ),
    )
    assert updated is not None

    events = _drain(subscriber)
    assert len(events) == 1
    assert events[0][0] == {"staff", "masters", "staff_positions"}


async def test_patch_grid_card_only_is_staff(db_session, subscriber) -> None:
    from src.usecases.staff import patch_staff

    staff = await _add_staff(db_session)
    await db_session.commit()
    _drain(subscriber)

    patched = await patch_staff(
        None, db_session=db_session, id=staff.id, data=StaffPatch(first_name="В"),
    )
    assert patched is not None

    events = _drain(subscriber)
    assert len(events) == 1
    assert events[0][0] == {"staff"}


async def test_grid_failure_publishes_nothing(db_session, subscriber) -> None:
    """A failed PUT (unknown position id — the validation raises inside
    the positions step) publishes NOTHING (rollback silence, spec §5)."""
    from src.domain.errors import PositionNotFoundError
    from src.usecases.staff import update_staff

    staff = await _add_staff(db_session)
    await db_session.commit()
    _drain(subscriber)

    with pytest.raises(PositionNotFoundError):
        await update_staff(
            None, db_session=db_session, id=staff.id,
            data=StaffUpdate(
                first_name="А", last_name="Б", position_ids=["ghost-id"],
            ),
        )
    await db_session.rollback()
    assert _drain(subscriber) == [], "a failed update must publish NOTHING"


# ─── atomicity: mid-chain failure → NOTHING persists ────────────────────────


async def test_update_atomicity_position_boom_keeps_pre_state(
    db_session, monkeypatch,
) -> None:
    """The positions step explodes AFTER the card write + section upsert
    are pending → rollback restores card fields AND the section."""
    import src.usecases.staff as staff_module
    from src.services.staff import get_staff_service as real_getter

    class _PositionsBoom:
        def __getattr__(self, name: str) -> Any:
            return getattr(real_getter(), name)

        async def replace_positions(self, *args: Any, **kwargs: Any) -> Any:
            raise StepBoomError("injected: positions replace failed")

    monkeypatch.setattr(
        staff_module, "get_staff_service", lambda: _PositionsBoom(),
    )

    staff = await _add_staff(db_session, first_name="До")
    await db_session.commit()
    staff_id = staff.id

    with pytest.raises(StepBoomError):
        await staff_module.update_staff(
            None, db_session=db_session, id=staff_id,
            data=StaffUpdate(
                first_name="После", last_name="Б",
                master={"specialty": "живопись", "color": "#111111"},
                position_ids=[],
            ),
        )

    await db_session.rollback()
    stored = await db_session.get(Staff, staff_id)
    assert stored is not None
    assert stored.first_name == "До", "card write must be rolled back"
    assert (await db_session.execute(
        select(Master).where(Master.staff_id == staff_id)
    )).scalar_one_or_none() is None, "section upsert must be rolled back"


async def test_patch_atomicity_section_boom_keeps_pre_state(
    db_session, monkeypatch,
) -> None:
    """The section step explodes AFTER the card patch is pending →
    rollback restores the card fields."""
    import src.usecases.staff as staff_module
    from src.services.master import get_master_service as real_getter

    class _SectionBoom:
        def __getattr__(self, name: str) -> Any:
            return getattr(real_getter(), name)

        async def upsert_extension(self, *args: Any, **kwargs: Any) -> Any:
            raise StepBoomError("injected: section upsert failed")

    monkeypatch.setattr(
        staff_module, "get_master_service", lambda: _SectionBoom(),
    )

    staff = await _add_staff(db_session, first_name="До")
    await db_session.commit()
    staff_id = staff.id

    with pytest.raises(StepBoomError):
        await staff_module.patch_staff(
            None, db_session=db_session, id=staff_id,
            data=StaffPatch(
                first_name="После",
                master={"specialty": "живопись", "color": "#111111"},
            ),
        )

    await db_session.rollback()
    stored = await db_session.get(Staff, staff_id)
    assert stored is not None
    assert stored.first_name == "До"
    assert (await db_session.execute(
        select(Master).where(Master.staff_id == staff_id)
    )).scalar_one_or_none() is None
