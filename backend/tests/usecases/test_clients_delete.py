"""Unit tests for the ``delete_client`` scenario (GH #327 Task 4).

Behavior-preserving extraction of the execute branch (Corridor 2 —
canon docs/domain-rules/service-layer.md rule 2): the business chain
moves from ``ClientService.resolve_delete`` (the generic
``_resolve_delete_core`` executor + CASCADE_HANDLERS) into the
selfless ``@transactional`` scenario; the ROUTE keeps transport (409
dry-run tree, 404/422 mapping, response format). These tests pin the
new shape:

- the scenario is ``@transactional`` (one transaction + one event
  batch) and is called with the leading ``None`` + keyword args
  convention (``delete_record`` precedent);
- phase order mirrors today's executor: probe → ``mark_changed(
  "clients")`` IMMEDIATELY after the probe (parity: the mark publishes
  on EVERY non-exception branch — 404 included, since today the
  decorated ``resolve_delete`` auto-marked "clients" before returning
  ``False``) → collect deps → blocking check → resolutions validation
  → nullify phase → visitors cascade → client row;
- success grid is EXACTLY ``{"clients", "records", "photos",
  "visitors", "client_tags"}`` byte-for-byte — dependency marks are
  UNCONDITIONAL (by dispatch fact, not row count; also with EMPTY
  resolutions ``{}`` on a dep-free client);
- 404 → exactly ``{"clients"}``; 422 branches (validation exceptions)
  → NO batch (accumulator reset on exception);
- atomicity: a mid-cascade failure (2nd visitor's ``_delete_cascade``
  raise — the SAME singleton monkeypatch point the API atomicity test
  uses) rolls back EVERYTHING and publishes nothing;
- structural regression: NO ``(Client, ...)`` keys in
  ``CASCADE_HANDLERS`` (the Activity-guard precedent) and the clients
  ROUTE's execute branch imports the scenario (guard against silent
  regression to ``resolve_delete`` — the executor silently skips
  handlerless deps, so a fallback would skip the visitors cascade).
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import select

from src.models.activity import Activity
from src.models.client import Client
from src.models.photo import Photo
from src.models.record import Record
from src.models.tag import client_tags
from src.models.visit import Visit
from src.models.visitor import Visitor
from src.services.decorators import _TRANSACTIONAL_MARKER

# asyncio_mode=auto (pyproject) collects the async tests; the two sync
# structural guards at the bottom must NOT carry the asyncio mark.


# ─── helpers ────────────────────────────────────────────────────────────────


async def _add_client(db_session: Any, **kwargs: Any) -> Client:
    kwargs.setdefault("name", "Гость")
    kwargs.setdefault("phone", f"+7999{uuid.uuid4().hex[:7]}")
    kwargs.setdefault("channel", "telegram")
    client = Client(**kwargs)
    db_session.add(client)
    await db_session.flush()
    return client


async def _add_visitor(db_session: Any, client_id: str, name: str = "Алиса") -> Visitor:
    visitor = Visitor(client_id=client_id, name=name)
    db_session.add(visitor)
    await db_session.flush()
    return visitor


async def _orm_activity(db_session, create_activity) -> str:
    """The ``create_activity`` factory rides the API (returns a dict);
    tests here need the ORM row's id (records carry a NOT NULL
    activity_id FK). Same pattern as tests/usecases/test_records_delete."""
    payload = create_activity()
    activity = await db_session.get(Activity, payload["id"])
    assert activity is not None
    return activity.id


async def _add_record(
    db_session: Any, activity_id: str, client_id: str | None
) -> Record:
    """A record linked to the client (activity_id/status NOT NULL)."""
    record = Record(
        activity_id=activity_id, client_id=client_id, status="pending", seats=0
    )
    db_session.add(record)
    await db_session.flush()
    return record


async def _add_visit(db_session: Any, record_id: str, visitor_id: str) -> Visit:
    """A visit of the visitor on the record (record_id/status NOT NULL)."""
    visit = Visit(
        record_id=record_id, visitor_id=visitor_id, price=100, status="waiting"
    )
    db_session.add(visit)
    await db_session.flush()
    return visit


async def _add_photo(db_session: Any, client_id: str | None) -> Photo:
    photo = Photo(
        filename=f"p-{uuid.uuid4().hex[:8]}.png", client_id=client_id
    )
    db_session.add(photo)
    await db_session.flush()
    return photo


async def _link_client_tag(db_session: Any, client_id: str) -> None:
    from src.models.tag import Tag

    tag = Tag(title=f"t-{uuid.uuid4().hex[:8]}")
    db_session.add(tag)
    await db_session.flush()
    await db_session.execute(
        client_tags.insert().values(client_id=client_id, tag_id=tag.id)
    )


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


async def _one(db_session: Any, stmt) -> Any:
    return (await db_session.execute(stmt)).scalar_one_or_none()


async def _all_ids(db_session: Any, stmt) -> list[str]:
    return list((await db_session.execute(stmt)).scalars().all())


class StepBoomError(RuntimeError):
    """Injected mid-cascade failure — must propagate, never be swallowed."""


# ─── canon shape ─────────────────────────────────────────────────────────────


async def test_delete_client_is_transactional() -> None:
    from src.usecases.clients import delete_client

    assert hasattr(delete_client, _TRANSACTIONAL_MARKER), (
        "delete_client is a Corridor-2 scenario — it must be wrapped by "
        "@transactional (one transaction + one event batch per action)"
    )


async def test_delete_client_is_module_level_selfless(db_session) -> None:
    """The scenario resolves its service singletons INSIDE the body on
    every call (no module-level capture) — a monkeypatch of the
    ``VisitorService`` singleton's ``_delete_cascade`` must intercept
    (the API atomicity test's patch point)."""
    import inspect

    from src.usecases.clients import delete_client

    src = inspect.getsource(delete_client)
    assert "get_visitor_service()" in src, (
        "the scenario must resolve the visitor singleton via its factory "
        "inside the function body — a module-level capture would break "
        "the atomicity test's singleton monkeypatch"
    )


# ─── execution branches ──────────────────────────────────────────────────────


async def test_delete_missing_returns_false(db_session, subscriber) -> None:
    """404 branch: ``False``; the published grid is EXACTLY ``{"clients"}``
    — today the decorated ``resolve_delete`` auto-marked "clients" and
    committed/published even on the miss (parity)."""
    from src.usecases.clients import delete_client

    await db_session.commit()
    _drain(subscriber)

    ok = await delete_client(
        None, db_session=db_session, id="ghost", resolutions={}, expected={},
    )

    assert ok is False
    events = _drain(subscriber)
    assert len(events) == 1, f"ONE batch expected on the 404 branch, got {events}"
    assert events[0][0] == {"clients"}, f"404 grid must be exactly {{'clients'}}: {events}"


async def test_delete_missing_returns_false_before_collectors(
    db_session,
) -> None:
    """GH #345 §4.5: the existence probe runs BEFORE the expected check —
    a ghost id with a stale-looking ``expected`` still answers ``False``
    (404), never StaleDependenciesError (the ``delete_staff`` mirror)."""
    from src.usecases.clients import delete_client

    assert await delete_client(
        None, db_session=db_session, id="ghost", resolutions={},
        expected={"records": ["some-id"]},
    ) is False


# ─── GH #345 Task 4: the expected subset verification (§4.1/§4.5) ────────────


async def test_delete_stale_expected_raises_before_validation(
    db_session, create_activity,
) -> None:
    """GH #345 §4.1/§4.5: an UNCONFIRMED dep (``expected`` misses it) →
    ``StaleDependenciesError`` INSIDE the scenario transaction — the
    #285 D7 order pin: the race gate fires BEFORE the resolutions
    validation could turn the race into a 422 (here ``resolutions`` is
    even COMPLETE, only ``expected`` is stale). The fresh tree rides
    the exception (the route renders it as the 409)."""
    from src.domain.deletion import StaleDependenciesError
    from src.usecases.clients import delete_client

    activity_id = await _orm_activity(db_session, create_activity)
    client = await _add_client(db_session)
    await _add_record(db_session, activity_id, client.id)
    visitor = await _add_visitor(db_session, client.id)
    await db_session.commit()
    # Capture ids NOW: the post-rollback asserts below must not touch ORM
    # attrs (rollback expires instances touched by the failed transaction).
    client_id, visitor_id = client.id, visitor.id

    with pytest.raises(StaleDependenciesError) as exc_info:
        await delete_client(
            None, db_session=db_session, id=client_id,
            resolutions={"records": "nullify", "visitors": "cascade"},
            expected={},  # nothing confirmed — every dep is "new"
        )

    # The fresh tree carries the two non-auto nodes (records + visitors);
    # the auto nodes (client_tags/photos) stay absent at zero count.
    assert sorted(d.entity for d in exc_info.value.nodes) == [
        "records", "visitors",
    ]
    # Nothing was written.
    await db_session.rollback()
    assert await db_session.get(Client, client_id) is not None
    assert await db_session.get(Visitor, visitor_id) is not None


async def test_delete_expected_visitor_appeared_blocks(
    db_session, subscriber,
) -> None:
    """S5 race (the visitor side): a visitor that appeared after the
    window → ``StaleDependenciesError``; no batch publishes."""
    from src.domain.deletion import StaleDependenciesError
    from src.usecases.clients import delete_client

    client = await _add_client(db_session)
    await _add_visitor(db_session, client.id, "Алиса")
    await db_session.commit()
    client_id = client.id
    _drain(subscriber)

    # A second visitor lands mid-window — NOT in the confirmed set.
    await _add_visitor(db_session, client_id, "Борис")
    await db_session.commit()
    confirmed = await _all_ids(
        db_session, select(Visitor.id).where(Visitor.client_id == client_id)
    )
    now_boris = confirmed[-1]
    await db_session.commit()

    with pytest.raises(StaleDependenciesError):
        await delete_client(
            None, db_session=db_session, id=client_id,
            resolutions={"visitors": "cascade"},
            expected={"visitors": [now_boris]},  # misses «Алиса»
        )
    assert _drain(subscriber) == [], "the stale branch must publish NO batch"


async def test_delete_expected_disappeared_dep_does_not_block(
    db_session,
) -> None:
    """S5 reverse race: subset semantics — a confirmed dep that vanished
    mid-window does NOT block (``set(now) ⊆ set(expected)`` holds when
    ``expected`` is a superset)."""
    from src.usecases.clients import delete_client

    client = await _add_client(db_session)
    visitor = await _add_visitor(db_session, client.id, "Алиса")
    await db_session.commit()
    client_id, visitor_id = client.id, visitor.id

    # The confirmed set carries a ghost id PLUS the live one — a superset
    # of the current id-set (the ghost "disappeared" mid-window).
    ok = await delete_client(
        None, db_session=db_session, id=client_id,
        resolutions={"visitors": "cascade"},
        expected={"visitors": ["ghost-id", visitor_id]},
    )
    assert ok is True


async def test_422_wrong_action_publishes_nothing(
    db_session, create_activity, subscriber
) -> None:
    """422 branch (§6 rule 1): ``records: "cascade"`` is not an allowed
    action → ``InvalidResolutionError`` BEFORE any write; the accumulator
    resets with NO publish."""
    from src.domain.deletion import InvalidResolutionError
    from src.usecases.clients import delete_client

    activity_id = await _orm_activity(db_session, create_activity)
    client = await _add_client(db_session)
    record = await _add_record(db_session, activity_id, client.id)
    await db_session.commit()
    client_id = client.id
    _drain(subscriber)

    with pytest.raises(InvalidResolutionError):
        await delete_client(
            None, db_session=db_session, id=client_id,
            resolutions={"records": "cascade", "visitors": "cascade"},
            # GH #345: expected confirmed (the stale gate passes) so the
            # INVALID ACTION branch is what fires (order: stale → validate).
            expected={"records": [record.id]},
        )

    await db_session.rollback()
    assert await db_session.get(Client, client_id) is not None
    assert _drain(subscriber) == [], "the 422 branch must publish NO event batch"


async def test_422_missing_visitors_resolution_publishes_nothing(
    db_session, subscriber
) -> None:
    """422 branch (§6 rule 2): a non-auto cascade dep (visitors) without a
    resolution → ``InvalidResolutionError``; no batch."""
    from src.domain.deletion import InvalidResolutionError
    from src.usecases.clients import delete_client

    client = await _add_client(db_session)
    visitor = await _add_visitor(db_session, client.id)
    await db_session.commit()
    client_id = client.id
    _drain(subscriber)

    with pytest.raises(InvalidResolutionError):
        await delete_client(
            None, db_session=db_session, id=client_id, resolutions={},
            expected={"visitors": [visitor.id]},  # confirmed — validation fires
        )

    await db_session.rollback()
    assert await db_session.get(Client, client_id) is not None
    assert _drain(subscriber) == [], "the 422 branch must publish NO event batch"


# ─── event grid (GH #239 — byte-parity with today's executor) ────────────────


async def test_grid_full_family_byte_for_byte(
    db_session, create_activity, subscriber
) -> None:
    """Success grid on a fully-loaded client: EXACTLY
    ``{"clients", "records", "photos", "visitors", "client_tags"}``,
    ONE batch — the pre-refactor ``resolve_delete`` grid (dependency
    marks unconditional by dispatch fact)."""
    from src.usecases.clients import delete_client

    activity_id = await _orm_activity(db_session, create_activity)
    client = await _add_client(db_session)
    record = await _add_record(db_session, activity_id, client.id)
    visitor = await _add_visitor(db_session, client.id)
    await _add_visit(db_session, record.id, visitor.id)
    await _add_photo(db_session, client.id)
    await _link_client_tag(db_session, client.id)
    await db_session.commit()
    client_id = client.id
    _drain(subscriber)

    ok = await delete_client(
        None, db_session=db_session, id=client_id,
        resolutions={"records": "nullify", "visitors": "cascade"},
        expected={"records": [record.id], "visitors": [visitor.id]},
    )
    assert ok is True

    events = _drain(subscriber)
    assert len(events) == 1, f"ONE event batch expected, got {events}"
    assert events[0][0] == {
        "clients", "records", "photos", "visitors", "client_tags",
    }, f"success grid mismatch: {events}"
    assert events[0][1] is None  # direct scenario call — no origin envelope


async def test_grid_empty_resolutions_on_clean_client(db_session, subscriber) -> None:
    """Execute with EMPTY resolutions ``{}`` on a dep-free client — the
    dependency marks are UNCONDITIONAL (by dispatch fact, not row
    count): the grid is still the full five-entity set (parity with
    today's executor, which dispatches every matrix handler on the
    clean path too)."""
    from src.usecases.clients import delete_client

    client = await _add_client(db_session)
    await db_session.commit()
    client_id = client.id
    _drain(subscriber)

    ok = await delete_client(
        None, db_session=db_session, id=client_id, resolutions={},
        expected={},  # GH #345: the clean commit declares the empty state
    )
    assert ok is True

    events = _drain(subscriber)
    assert len(events) == 1, f"ONE event batch expected, got {events}"
    assert events[0][0] == {
        "clients", "records", "photos", "visitors", "client_tags",
    }, f"clean-client grid mismatch: {events}"


async def test_grid_no_visits_mark(db_session, create_activity, subscriber) -> None:
    """The deliberately UNPUBLISHED entity: ``"visits"`` is NOT in the
    grid (spec §8 — the pre-refactor hole is preserved; #375)."""
    from src.usecases.clients import delete_client

    activity_id = await _orm_activity(db_session, create_activity)
    client = await _add_client(db_session)
    record = await _add_record(db_session, activity_id, client.id)
    visitor = await _add_visitor(db_session, client.id)
    await _add_visit(db_session, record.id, visitor.id)
    await db_session.commit()
    _drain(subscriber)

    ok = await delete_client(
        None, db_session=db_session, id=client.id,
        resolutions={"records": "nullify", "visitors": "cascade"},
        expected={"records": [record.id], "visitors": [visitor.id]},
    )
    assert ok is True

    events = _drain(subscriber)
    assert "visits" not in events[0][0], (
        f"'visits' must NOT be published (pre-refactor hole, spec §8): {events}"
    )


# ─── cascade effects ────────────────────────────────────────────────────────


async def test_full_cascade_effects(db_session, create_activity) -> None:
    """The S4 shape at the scenario level: records nullified (client_id
    NULL), photo owner detached, visitors + their visits + visitor's
    tag links gone, client_tags join gone, client row gone."""
    from src.models.tag import Tag, visitor_tags
    from src.usecases.clients import delete_client

    activity_id = await _orm_activity(db_session, create_activity)
    client = await _add_client(db_session)
    record = await _add_record(db_session, activity_id, client.id)
    visitor = await _add_visitor(db_session, client.id)
    await _add_visit(db_session, record.id, visitor.id)
    photo = await _add_photo(db_session, client.id)
    await _link_client_tag(db_session, client.id)
    vtag = Tag(title=f"vt-{uuid.uuid4().hex[:8]}")
    db_session.add(vtag)
    await db_session.flush()
    await db_session.execute(
        visitor_tags.insert().values(visitor_id=visitor.id, tag_id=vtag.id)
    )
    await db_session.commit()
    client_id, record_id, visitor_id, photo_id = (
        client.id, record.id, visitor.id, photo.id,
    )

    ok = await delete_client(
        None, db_session=db_session, id=client_id,
        resolutions={"records": "nullify", "visitors": "cascade"},
        expected={"records": [record_id], "visitors": [visitor_id]},
    )
    assert ok is True

    # Client row physically gone; records nullified; photo detached.
    assert await db_session.get(Client, client_id) is None
    surviving = await db_session.get(Record, record_id)
    assert surviving is not None and surviving.client_id is None
    surviving_photo = await db_session.get(Photo, photo_id)
    assert surviving_photo is not None and surviving_photo.client_id is None
    # Visitors + their visits + both join tables swept.
    assert await db_session.get(Visitor, visitor_id) is None
    assert await _all_ids(
        db_session, select(Visit.id).where(Visit.visitor_id == visitor_id)
    ) == []
    assert await _all_ids(
        db_session, select(client_tags.c.tag_id).where(client_tags.c.client_id == client_id)
    ) == []
    assert await _all_ids(
        db_session, select(visitor_tags.c.tag_id).where(visitor_tags.c.visitor_id == visitor_id)
    ) == []


# ─── atomicity: mid-cascade failure → NOTHING persists ──────────────────────


async def test_atomicity_mid_cascade_failure_rolls_back_everything(
    db_session, create_activity, subscriber, monkeypatch
) -> None:
    """The 2nd visitor's ``_delete_cascade`` raises (the singleton
    monkeypatch point — the API atomicity test's exact shape): rollback
    restores the client, the nullified record's link, BOTH visitors,
    and NOTHING publishes."""
    from src.services.visitor import get_visitor_service
    from src.usecases.clients import delete_client

    activity_id = await _orm_activity(db_session, create_activity)
    client = await _add_client(db_session)
    record = await _add_record(db_session, activity_id, client.id)
    first = await _add_visitor(db_session, client.id, "Алиса")
    second = await _add_visitor(db_session, client.id, "Борис")
    await db_session.commit()
    # Capture ids NOW: the post-rollback asserts below must not touch ORM
    # attrs (rollback expires instances touched by the failed transaction).
    client_id, record_id = client.id, record.id
    first_id, second_id = first.id, second.id
    _drain(subscriber)

    visitor_service = get_visitor_service()
    original = visitor_service._delete_cascade
    call_count = {"n": 0}

    async def patched(db_session_arg, visitor_id):
        call_count["n"] += 1
        if call_count["n"] == 2:
            raise StepBoomError("mid-cascade simulated failure")
        return await original(db_session_arg, visitor_id)

    monkeypatch.setattr(visitor_service, "_delete_cascade", patched)

    with pytest.raises(StepBoomError):
        await delete_client(
            None, db_session=db_session, id=client_id,
            resolutions={"records": "nullify", "visitors": "cascade"},
            expected={
                "records": [record_id],
                "visitors": [first_id, second_id],
            },
        )

    await db_session.rollback()
    # Everything is still there — no partial cascade, no partial nullify.
    assert await db_session.get(Client, client_id) is not None
    assert (await db_session.get(Record, record_id)).client_id == client_id
    assert await db_session.get(Visitor, first_id) is not None
    assert await db_session.get(Visitor, second_id) is not None
    assert call_count["n"] == 2  # the 1st-processed visitor was rolled back
    assert _drain(subscriber) == [], (
        "a mid-cascade failure must publish NO event batch"
    )


# ─── structural regression (spec §4.5 — the load-bearing guard) ─────────────


def test_no_client_keys_in_cascade_handlers() -> None:
    """Precedent: the Activity-guard in tests/domain/test_deletion.py.
    After the scenario migration, NO ``(Client, ...)`` key may remain
    in ``CASCADE_HANDLERS`` — a leftover would be dead code, and a
    reverted route could silently redispatch through the executor."""
    from src.domain.deletion import CASCADE_HANDLERS

    assert not any(model is Client for model, _ in CASCADE_HANDLERS), (
        "CASCADE_HANDLERS must carry no Client keys — the client cascade "
        "lives in the usecases.clients.delete_client scenario (spec §4.5)"
    )


def test_route_execute_branch_imports_the_scenario() -> None:
    """Guard against a silent regression to ``service.resolve_delete``:
    the clients route module must import the scenario under the
    ``delete_client_scenario`` alias (the route handler itself owns the
    ``delete_client`` name) and the execute branch calls it. The
    executor silently skips handlerless deps, so a fallback would skip
    the visitors cascade."""
    import src.api.v1.clients as route_module
    import src.usecases.clients as scenario_module

    assert (
        getattr(route_module, "delete_client_scenario", None)
        is scenario_module.delete_client
    ), (
        "api/v1/clients.py must import the delete_client scenario "
        "(aliased) for its execute branch — regression to resolve_delete "
        "would silently skip the visitors cascade"
    )
