"""Unit tests for the ``delete_staff`` scenario (GH #326 Task 4).

Behavior-preserving extraction of the DELETE commit branch (Corridor 2 —
canon docs/domain-rules/service-layer.md rule 2): the executing body of
``GenericService.resolve_delete`` moved into the non-decorated core
``_resolve_delete_core`` (rule 3 — thin decorated method over a shared
transactionless core, the ``VisitorService._delete_cascade`` precedent);
the ``delete_staff`` scenario owns the transaction + the own-entity mark
and calls the core on the staff service instance (the undecorated call
is allowed — canon rule 5 forbids only NESTED decorated calls).

The ROUTE keeps transport (contract #207 — NOT the records shape: no
``dry_run`` / ``expected``): the preview branch (``collect_dependencies``
→ 409 + tree) stays in the route; missing id → 404; ResolutionError →
422. Pinned here at the scenario level:

- the scenario is ``@transactional`` and delegates to the CORE, never to
  the decorated ``resolve_delete`` (rule 5);
- BOTH execution branches publish ONE batch with the SAME grid:
  {"staff", "users", "masters", "master_tags", "staff_positions"} — the
  core dispatches EVERY matrix handler regardless of dep count (spec
  §2.7 — «extra invalidations are cheap/correct», the executor idiom),
  and byte-parity with today's ``resolve_delete`` holds on both; the
  bare-clean branch hard-deletes just the row, the resolutions branch
  wipes the auto-cascade family (users / masters / master_tags /
  staff_positions; the tag and position DICTIONARY rows survive);
- activities still block (``BlockingDepsError``; nothing deleted, no
  event batch);
- atomicity: a mid-cascade failure rolls back EVERYTHING and publishes
  nothing.

CALLING CONVENTION: selfless function — leading ``None`` + keyword
arguments (see ``src/usecases/staff.py``).
"""

from __future__ import annotations

import uuid as _uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import select

from src.models.activity import Activity
from src.models.location import Location
from src.models.master import Master
from src.models.position import Position, staff_positions
from src.models.service import Service
from src.models.staff import Staff
from src.models.tag import Tag, master_tags
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


async def _link_master_tag(db_session: Any, staff_id: str) -> Tag:
    """A tag row + its master_tags join link (FK: masters.staff_id)."""
    tag = Tag(title=f"t-{staff_id[:6]}")
    db_session.add(tag)
    await db_session.flush()
    await db_session.execute(
        master_tags.insert().values(master_id=staff_id, tag_id=tag.id)
    )
    return tag


async def _link_position(db_session: Any, staff_id: str) -> Position:
    position = Position(title="СММ")
    db_session.add(position)
    await db_session.flush()
    await db_session.execute(
        staff_positions.insert().values(staff_id=staff_id, position_id=position.id)
    )
    return position


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
    """Injected mid-cascade failure — must propagate, never be swallowed."""


# ─── canon shape ─────────────────────────────────────────────────────────────


async def test_delete_staff_is_transactional() -> None:
    from src.usecases.staff import delete_staff

    assert hasattr(delete_staff, _TRANSACTIONAL_MARKER), (
        "delete_staff is a Corridor-2 scenario — it must be wrapped by "
        "@transactional (one transaction + one event batch per action)"
    )


async def test_resolve_delete_core_extraction_shape() -> None:
    """Rule 3: the executing body lives in a NON-decorated core; the
    decorated ``resolve_delete`` stays a thin wrapper for the other heirs
    (Tag/Client/Activity/… — behavior unchanged)."""
    from src.services.generic import GenericService

    assert hasattr(GenericService, "_resolve_delete_core"), (
        "GenericService must expose the transactionless _resolve_delete_core "
        "(rule 3 — the delete_staff scenario calls it on the staff instance)"
    )
    assert hasattr(GenericService.resolve_delete, _TRANSACTIONAL_MARKER), (
        "resolve_delete must KEEP its @transactional wrapper — the other "
        "heirs (Tag/Client/Activity/…) still call it directly from routes"
    )
    assert not hasattr(
        GenericService._resolve_delete_core, _TRANSACTIONAL_MARKER
    ), "the core must NOT be decorated — the scenario owns the transaction"


async def test_scenario_calls_the_core_not_the_decorated_method(
    db_session, monkeypatch
) -> None:
    """The scenario delegates to ``_resolve_delete_core`` (undecorated —
    canon rule 5 allows it); calling the decorated ``resolve_delete``
    from inside the scenario would be a NESTED decorated call (rule 5
    violation: double commit + a second event batch)."""
    import src.usecases.staff as staff_module
    from src.services.staff import get_staff_service

    real = get_staff_service()
    calls: list[str] = []

    class _Recorder:
        def __getattr__(self, name: str) -> Any:
            attr = getattr(real, name)
            if name in ("resolve_delete", "_resolve_delete_core"):
                async def wrapped(*args: Any, **kwargs: Any) -> Any:
                    calls.append(name)
                    return await attr(*args, **kwargs)
                return wrapped
            return attr

    monkeypatch.setattr(staff_module, "get_staff_service", lambda: _Recorder())

    staff = await _add_staff(db_session)

    ok = await staff_module.delete_staff(
        None, db_session=db_session, id=staff.id, resolutions={},
    )
    assert ok is True
    assert calls == ["_resolve_delete_core"], (
        f"the scenario must call the CORE exactly once, got {calls}"
    )


# ─── execution branches ──────────────────────────────────────────────────────


async def test_delete_missing_returns_false(db_session) -> None:
    from src.usecases.staff import delete_staff

    assert await delete_staff(
        None, db_session=db_session, id="ghost", resolutions={},
    ) is False


async def test_delete_bare_clean_removes_row(db_session) -> None:
    """Bare-clean branch: no dependencies → the card row is hard-deleted."""
    from src.usecases.staff import delete_staff

    staff = await _add_staff(db_session)
    await db_session.commit()
    staff_id = staff.id

    ok = await delete_staff(
        None, db_session=db_session, id=staff_id, resolutions={},
    )
    assert ok is True
    assert await db_session.get(Staff, staff_id) is None


async def test_delete_with_resolutions_cascades_all(db_session) -> None:
    """Resolutions branch: the auto-cascade wipes users / masters /
    master_tags / staff_positions in the same transaction; the tag and
    position DICTIONARY rows survive (§16: user-sent actions for auto
    deps are silently accepted — ``{"masters": "cascade"}`` is a no-op
    value, not an error)."""
    from src.usecases.staff import delete_staff

    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)
    await _add_user(db_session, staff.id)
    tag = await _link_master_tag(db_session, staff.id)
    position = await _link_position(db_session, staff.id)
    await db_session.commit()
    staff_id = staff.id

    ok = await delete_staff(
        None, db_session=db_session, id=staff_id,
        resolutions={"masters": "cascade"},
    )
    assert ok is True

    assert await db_session.get(Staff, staff_id) is None
    assert (await db_session.execute(
        select(Master).where(Master.staff_id == staff_id)
    )).scalar_one_or_none() is None
    assert (await db_session.execute(
        select(User).where(User.staff_id == staff_id)
    )).scalar_one_or_none() is None
    assert (await db_session.execute(
        select(master_tags).where(master_tags.c.master_id == staff_id)
    )).all() == []
    assert (await db_session.execute(
        select(staff_positions.c.position_id)
        .where(staff_positions.c.staff_id == staff_id)
    )).scalars().all() == []
    # dictionaries survive
    assert await db_session.get(Tag, tag.id) is not None
    assert await db_session.get(Position, position.id) is not None


async def test_delete_blocked_by_activities_raises(db_session, subscriber) -> None:
    """Activities still block (the matrix did not change): the core raises
    ``BlockingDepsError`` (route → 422); nothing is deleted and NO event
    batch publishes (rollback silence)."""
    from src.domain.deletion import BlockingDepsError
    from src.usecases.staff import delete_staff

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
    await db_session.commit()  # persist setup — the rollback below must
    staff_id = staff.id        # only undo the failed delete, not the fixture
    _drain(subscriber)

    with pytest.raises(BlockingDepsError):
        await delete_staff(
            None, db_session=db_session, id=staff_id, resolutions={},
        )

    await db_session.rollback()
    assert await db_session.get(Staff, staff_id) is not None
    assert _drain(subscriber) == [], (
        "the blocked branch must not publish an event batch"
    )


# ─── event grid (GH #239 — byte-parity with today's resolve_delete) ─────────


async def test_grid_bare_clean(db_session, subscriber) -> None:
    """Bare-clean branch grid: the executor dispatches handlers from the
    MATRIX (not from the collected counts) — a clean card still runs the
    0-row cascade DELETEs, so every dispatched dep is marked regardless
    of count (parity with today's executor: «extra invalidations are
    cheap/correct, spec §2.7» — pinned by the Client executor test).
    Grid = {"staff"} + all four dep entities, ONE batch."""
    from src.usecases.staff import delete_staff

    staff = await _add_staff(db_session)
    await db_session.commit()
    staff_id = staff.id
    _drain(subscriber)

    ok = await delete_staff(
        None, db_session=db_session, id=staff_id, resolutions={},
    )
    assert ok is True

    events = _drain(subscriber)
    assert len(events) == 1, f"ONE event batch expected, got {events}"
    assert events[0][0] == {
        "staff", "users", "masters", "master_tags", "staff_positions",
    }, f"bare-clean grid: {events}"
    assert events[0][1] is None  # direct scenario call — no origin envelope


async def test_grid_full_cascade_marks_every_dispatched_dep(
    db_session, subscriber
) -> None:
    """Resolutions branch: the core sows ``mark_changed(dep.entity)`` for
    every dispatched handler → {"staff"} + {users, masters, master_tags,
    staff_positions} — byte-parity with today's executor grid."""
    from src.usecases.staff import delete_staff

    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)
    await _add_user(db_session, staff.id)
    await _link_master_tag(db_session, staff.id)
    await _link_position(db_session, staff.id)
    await db_session.commit()
    staff_id = staff.id
    _drain(subscriber)

    ok = await delete_staff(
        None, db_session=db_session, id=staff_id, resolutions={},
    )
    assert ok is True

    events = _drain(subscriber)
    assert len(events) == 1, f"ONE event batch expected, got {events}"
    assert events[0][0] == {
        "staff", "users", "masters", "master_tags", "staff_positions",
    }, f"full-cascade grid: {events}"


# ─── atomicity: mid-cascade failure → NOTHING persists ──────────────────────


async def test_atomicity_mid_cascade_failure_rolls_back_everything(
    db_session, subscriber, monkeypatch
) -> None:
    """The users/masters handlers have already run when the master_tags
    handler explodes → rollback must restore the card, the extension row
    AND the account (no partial dismissal), and NOTHING publishes (spec
    §8 — one outer transaction; the decorator skips commit on raise)."""
    import src.services.generic as generic_module
    from src.usecases.staff import delete_staff

    async def _boom(*args: Any, **kwargs: Any) -> None:
        raise StepBoomError("injected: master_tags cascade failed")

    monkeypatch.setitem(
        generic_module.CASCADE_HANDLERS, (Staff, "master_tags"), _boom
    )

    staff = await _add_staff(db_session)
    await _add_master_ext(db_session, staff.id)
    await _add_user(db_session, staff.id)
    await _link_master_tag(db_session, staff.id)
    await db_session.commit()
    staff_id = staff.id
    _drain(subscriber)

    with pytest.raises(StepBoomError):
        await delete_staff(
            None, db_session=db_session, id=staff_id, resolutions={},
        )

    await db_session.rollback()
    # Everything is still there — no partial cascade.
    assert await db_session.get(Staff, staff_id) is not None
    assert (await db_session.execute(
        select(Master).where(Master.staff_id == staff_id)
    )).scalar_one_or_none() is not None, (
        "the masters extension must survive a mid-cascade failure"
    )
    assert (await db_session.execute(
        select(User).where(User.staff_id == staff_id)
    )).scalar_one_or_none() is not None, (
        "the account (deleted BEFORE the boom) must be rolled back"
    )
    assert (await db_session.execute(
        select(master_tags).where(master_tags.c.master_id == staff_id)
    )).all() != [], "the master_tags link must survive"
    # Failure branch publishes NOTHING.
    assert _drain(subscriber) == [], (
        "a mid-cascade failure must publish NO event batch"
    )
