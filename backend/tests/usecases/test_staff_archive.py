"""Unit tests for the ``archive_staff`` scenario (GH #326 Task 3).

Pin-first oracle (plan #326 Task 3): these tests pin TODAY's composite
``StaffService.archive`` behavior — D6 checkbox semantics, event grids,
step order, atomicity — BEFORE the StaffService demolition; the scenario
must stay behavior-identical (spec §Behavioral Delta: до = после).

D6/D3 semantics (domain-rules/staff.md): checkboxes apply ONLY to
existing ACTIVE links; unchecked links keep their flags — three
independent flags, no hidden cascades, an archive call never silently
restores anything.

Control pin (US-5): ``restore`` stays a decorated ``StaffService``
method (Corridor 1 — one table, own endpoint) and is NOT touched by the
demolition; asserted here so the demolition cannot silently eat it.

CALLING CONVENTION: selfless function — leading ``None`` + keyword
arguments (see ``src/usecases/records.py``).
"""

from __future__ import annotations

import uuid as _uuid
from typing import Any

import pytest
from sqlalchemy import select

from src.models.master import Master
from src.models.staff import Staff
from src.models.user import User
from src.services.decorators import _TRANSACTIONAL_MARKER

pytestmark = pytest.mark.asyncio


# ─── helpers ────────────────────────────────────────────────────────────────


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


async def _flags(db_session: Any, staff_id: str) -> tuple[bool, bool | None, bool | None]:
    """(staff.is_active, masters.is_active, users.is_active) — fresh column
    scalars, immune to identity-map staleness."""
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


async def test_archive_staff_is_transactional() -> None:
    from src.usecases.staff import archive_staff

    assert hasattr(archive_staff, _TRANSACTIONAL_MARKER), (
        "archive_staff is a Corridor-2 scenario — it must be wrapped by "
        "@transactional (one transaction + one event batch per action)"
    )


async def test_restore_stays_a_decorated_service_method() -> None:
    """US-5 control assert: ``restore`` is NOT demolished — it stays a
    decorated ``StaffService`` method (Corridor 1: one table, own
    endpoint; spec §Выбранный концепт п.3)."""
    from src.services.staff import StaffService

    assert hasattr(StaffService.restore, _TRANSACTIONAL_MARKER), (
        "StaffService.restore must keep its @transactional wrapper — it is "
        "a Corridor-1 operation left in the service (plan #326 Task 3)"
    )


# ─── D6 checkbox branches ───────────────────────────────────────────────────


async def test_archive_default_flags_all_three(db_session) -> None:
    """No body = consent to the preselected checkboxes: person + active
    master + active user all archive in ONE call."""
    from src.usecases.staff import archive_staff

    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)
    await _add_user(db_session, staff.id)

    ok = await archive_staff(
        None, db_session=db_session, id=staff.id,
        archive_master=True, archive_user=True,
    )
    assert ok is True
    staff_active, master_active, user_active = await _flags(db_session, staff.id)
    assert (staff_active, master_active, user_active) == (False, False, False)


async def test_archive_unchecked_master_keeps_schedule(db_session) -> None:
    """S6: archive_master=False — the fired person keeps the schedule link;
    the user checkbox still applies."""
    from src.usecases.staff import archive_staff

    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)
    await _add_user(db_session, staff.id)

    ok = await archive_staff(
        None, db_session=db_session, id=staff.id,
        archive_master=False, archive_user=True,
    )
    assert ok is True
    staff_active, master_active, user_active = await _flags(db_session, staff.id)
    assert (staff_active, master_active, user_active) == (False, True, False)


async def test_archive_unchecked_user_keeps_login(db_session) -> None:
    """S6: archive_user=False — login stays allowed; master still archives."""
    from src.usecases.staff import archive_staff

    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)
    await _add_user(db_session, staff.id)

    ok = await archive_staff(
        None, db_session=db_session, id=staff.id,
        archive_master=True, archive_user=False,
    )
    assert ok is True
    staff_active, master_active, user_active = await _flags(db_session, staff.id)
    assert (staff_active, master_active, user_active) == (False, False, True)


async def test_archive_skips_missing_and_already_archived_links(db_session) -> None:
    """Checkboxes apply ONLY to existing ACTIVE links: a bare card archives
    fine; an already-archived master stays archived (never resurrected)."""
    from src.usecases.staff import archive_staff

    staff = await _add_staff(db_session)  # no master ext, no user

    ok = await archive_staff(
        None, db_session=db_session, id=staff.id,
        archive_master=True, archive_user=True,
    )
    assert ok is True  # bare card archives fine

    staff2 = await _add_staff(db_session, last_name="В")
    await _add_master_ext(db_session, staff2.id, is_active=False)
    ok = await archive_staff(
        None, db_session=db_session, id=staff2.id,
        archive_master=True, archive_user=True,
    )
    assert ok is True
    ext = (await db_session.execute(
        select(Master).where(Master.staff_id == staff2.id)
    )).scalar_one()
    assert ext.is_active is False  # untouched, not resurrected


async def test_archive_missing_returns_false(db_session) -> None:
    from src.usecases.staff import archive_staff

    assert await archive_staff(
        None, db_session=db_session, id="ghost",
        archive_master=True, archive_user=True,
    ) is False


# ─── event grids (GH #239, pinned BEFORE the demolition — the oracle) ───────


async def test_grid_default_all_active_links(db_session, subscriber) -> None:
    """Both live links flipped → exactly {staff, masters, users} (byte-parity
    with today's pin, tests/test_events_emit.py:224)."""
    from src.usecases.staff import archive_staff

    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)
    await _add_user(db_session, staff.id)
    await db_session.commit()
    staff_id = staff.id
    _drain(subscriber)  # discard setup noise

    ok = await archive_staff(
        None, db_session=db_session, id=staff_id,
        archive_master=True, archive_user=True,
    )
    assert ok is True

    events = _drain(subscriber)
    assert len(events) == 1, f"ONE event batch expected, got {events}"
    assert events[0][0] == {"staff", "masters", "users"}


async def test_grid_bare_card_staff_only(db_session, subscriber) -> None:
    """No links to flip → exactly {"staff"}."""
    from src.usecases.staff import archive_staff

    staff = await _add_staff(db_session)
    await db_session.commit()
    staff_id = staff.id
    _drain(subscriber)

    ok = await archive_staff(
        None, db_session=db_session, id=staff_id,
        archive_master=True, archive_user=True,
    )
    assert ok is True

    events = _drain(subscriber)
    assert len(events) == 1
    assert events[0][0] == {"staff"}, f"bare-card grid: {events}"


async def test_grid_already_archived_links_staff_only(db_session, subscriber) -> None:
    """Archived links have rowcount 0 → no masters/users marks: the grid
    stays {"staff"} (an archive call never resurrects anything)."""
    from src.usecases.staff import archive_staff

    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id, is_active=False)
    await _add_user(db_session, staff.id, is_active=False)
    await db_session.commit()
    staff_id = staff.id
    _drain(subscriber)

    ok = await archive_staff(
        None, db_session=db_session, id=staff_id,
        archive_master=True, archive_user=True,
    )
    assert ok is True

    events = _drain(subscriber)
    assert len(events) == 1
    assert events[0][0] == {"staff"}, f"already-archived grid: {events}"


async def test_grid_unchecked_master_no_masters_mark(db_session, subscriber) -> None:
    """Unchecked checkbox → the master link is not even queried for update:
    grid = {staff, users}."""
    from src.usecases.staff import archive_staff

    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)
    await _add_user(db_session, staff.id)
    await db_session.commit()
    staff_id = staff.id
    _drain(subscriber)

    ok = await archive_staff(
        None, db_session=db_session, id=staff_id,
        archive_master=False, archive_user=True,
    )
    assert ok is True

    events = _drain(subscriber)
    assert len(events) == 1
    assert events[0][0] == {"staff", "users"}, f"unchecked-master grid: {events}"


async def test_grid_failure_publishes_nothing(db_session, subscriber, monkeypatch) -> None:
    """A failed archive (user step explodes) publishes NOTHING and flips no
    flags (spec §5 rollback silence)."""
    import src.usecases.staff as staff_module
    from src.services.user import get_user_service as real_getter

    class _UserBoom:
        def __getattr__(self, name: str) -> Any:
            return getattr(real_getter(), name)

        async def deactivate_active_by_staff(self, *args: Any, **kwargs: Any) -> Any:
            raise StepBoomError("injected: user deactivation failed")

    monkeypatch.setattr(staff_module, "get_user_service", lambda: _UserBoom())

    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)
    await _add_user(db_session, staff.id)
    await db_session.commit()
    staff_id = staff.id
    _drain(subscriber)

    with pytest.raises(StepBoomError):
        await staff_module.archive_staff(
            None, db_session=db_session, id=staff_id,
            archive_master=True, archive_user=True,
        )

    await db_session.rollback()
    assert _drain(subscriber) == [], "a failed archive must publish NOTHING"
    # Nothing persisted: all three flags stay active.
    assert await _flags(db_session, staff_id) == (True, True, True)


# ─── step order (as today: card flag → master → user) ──────────────────────


def _recording_proxy(real: Any, tag: str, calls: list[str]) -> Any:
    class _Proxy:
        def __getattr__(self, name: str) -> Any:
            attr = getattr(real, name)
            if callable(attr) and not name.startswith("_"):
                async def wrapped(*args: Any, **kwargs: Any) -> Any:
                    calls.append(f"{tag}.{name}")
                    return await attr(*args, **kwargs)
                return wrapped
            return attr

    return _Proxy()


async def test_step_order_card_master_user(db_session, monkeypatch) -> None:
    import src.usecases.staff as staff_module
    from src.services.master import get_master_service
    from src.services.staff import get_staff_service
    from src.services.user import get_user_service

    calls: list[str] = []
    monkeypatch.setattr(staff_module, "get_staff_service", lambda: _recording_proxy(
        get_staff_service(), "staff", calls,
    ))
    monkeypatch.setattr(staff_module, "get_master_service", lambda: _recording_proxy(
        get_master_service(), "masters", calls,
    ))
    monkeypatch.setattr(staff_module, "get_user_service", lambda: _recording_proxy(
        get_user_service(), "users", calls,
    ))

    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)
    await _add_user(db_session, staff.id)

    await staff_module.archive_staff(
        None, db_session=db_session, id=staff.id,
        archive_master=True, archive_user=True,
    )

    assert calls == [
        # 0. existence probe for the GH #344 archive journal guard (the
        #    no-op check reads the card before the flip — same row via
        #    the identity map, one extra read, no extra write),
        # 1. person flag flip,
        # 2./3. checkbox: active link / account only.
        "staff.get_card",
        "staff.archive_card",
        "masters.archive_active_extension",
        "users.deactivate_active_by_staff",
    ], f"step order drifted: {calls}"


# ─── atomicity: mid-chain failure → NOTHING persists ────────────────────────


async def test_atomicity_user_boom_keeps_all_flags(db_session, monkeypatch) -> None:
    """The user step explodes AFTER the card + master flags are already
    pending → rollback restores ALL three flags (no half-dismissal)."""
    import src.usecases.staff as staff_module
    from src.services.user import get_user_service as real_getter

    class _UserBoom:
        def __getattr__(self, name: str) -> Any:
            return getattr(real_getter(), name)

        async def deactivate_active_by_staff(self, *args: Any, **kwargs: Any) -> Any:
            raise StepBoomError("injected: user deactivation failed")

    monkeypatch.setattr(staff_module, "get_user_service", lambda: _UserBoom())

    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)
    await _add_user(db_session, staff.id)
    await db_session.commit()
    staff_id = staff.id

    with pytest.raises(StepBoomError):
        await staff_module.archive_staff(
            None, db_session=db_session, id=staff_id,
            archive_master=True, archive_user=True,
        )

    await db_session.rollback()
    assert await _flags(db_session, staff_id) == (True, True, True), (
        "a mid-chain failure must leave NO partial dismissal"
    )
