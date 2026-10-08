"""VisitorService structural + no-commit test for `_delete_cascade` (#207 Task 7).

Task 7 extracts the body of ``VisitorService.delete`` into a NON-DECORATED
inner method ``_delete_cascade(self, db_session, visitor_id)`` that performs the
visit→photo(SET NULL)→visitor_tags→visitor cascade WITHOUT committing. The
public ``@transactional delete`` becomes a thin wrapper that calls it. This
lets ``ClientService.resolve_delete`` (Task 10) call ``_delete_cascade`` inside
its OWN ``@transactional`` outer cascade loop on a SHARED session — atomicity
with ONE commit at the outer boundary, not N mid-loop commits.

This test verifies ONLY the structural extraction + the no-commit property.
The full atomicity fault-injection test (visitor cascade rolled back inside a
Client outer transaction on mid-cascade failure) lives in Task 14 — it requires
``ClientService.resolve_delete`` (Task 10). DO NOT add it here.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from src.models.client import Client
from src.models.visitor import Visitor
from src.services.decorators import _TRANSACTIONAL_MARKER
from src.services.visitor import VisitorService, get_visitor_service

pytestmark = pytest.mark.asyncio


async def test_delete_cascade_is_non_decorated_core_that_does_not_commit(db_session):
    """Task 7 contract: ``_delete_cascade`` is a non-decorated method on
    ``VisitorService`` that performs the cascade WITHOUT committing.

    Two facets of the SAME behavior (the extraction contract), checked in one
    test so the structural assertion yields a CLEAN RED before the extraction
    lands:

    1. Structural — ``hasattr(VisitorService, "_delete_cascade")``. False
       before Task 7 → ``AssertionError`` (a clean failure, not an
       ``AttributeError`` error) — the test never reaches the
       ``_delete_cascade`` call below.
    2. No-commit — the caller owns the transaction. Proof is mock-free, following
       the existing atomicity-test pattern: insert a visitor (committed), call
       ``_delete_cascade`` (which issues the DELETE but must NOT commit), then
       ROLL BACK the session. Because nothing was committed, the rollback
       undoes the pending delete and the visitor is STILL present in the
       committed DB snapshot (read via a raw sqlite connection, ``query_db``).

       Had ``_delete_cascade`` committed, the rollback could NOT undo it and
       the visitor would be gone — which would fail this assertion. Therefore
       the visitor's survival IS conclusive proof of the no-commit property.
    """
    from tests.conftest import query_db

    # ── 1. Structural: `_delete_cascade` exists on VisitorService (clean RED) ──
    assert hasattr(VisitorService, "_delete_cascade"), (
        "VisitorService must expose `_delete_cascade` (Task 7 extraction) for "
        "atomic reuse by ClientService.resolve_delete (Task 10)"
    )
    assert callable(VisitorService._delete_cascade)

    # ── 2. Setup: a visitor (committed), owned by a client ──
    client = Client(name="C", phone=None)
    db_session.add(client)
    await db_session.commit()
    visitor = Visitor(client_id=client.id, name="Alice")
    db_session.add(visitor)
    await db_session.commit()
    visitor_id = visitor.id

    # Sanity: the visitor is in the committed DB before the cascade runs.
    assert query_db(
        f"SELECT COUNT(*) AS c FROM visitors WHERE id='{visitor_id}'"
    )[0]["c"] == 1

    # ── 3. Act: run the non-decorated cascade core (NO caller commit) ──
    service = get_visitor_service()
    result = await service._delete_cascade(db_session, visitor_id)

    assert result is True

    # ── 4. Assert: NO commit happened — roll back and the visitor survives ──
    # `_delete_cascade` must NOT have committed: rolling back the session
    # undoes the pending (uncommitted) DELETE, so the visitor is still present
    # in the committed DB snapshot. If it had committed, rollback couldn't
    # undo it and the visitor would be gone.
    await db_session.rollback()

    assert query_db(
        f"SELECT COUNT(*) AS c FROM visitors WHERE id='{visitor_id}'"
    )[0]["c"] == 1, (
        "_delete_cascade must NOT commit — the caller owns the transaction "
        "boundary. If the visitor is gone after rollback, the extracted core "
        "committed mid-cascade, breaking atomicity for the Client→visitors "
        "outer @transactional (Task 10 / atomicity fault-injection Task 14)."
    )


# ── GH #171 Task 2 — get_or_create_by_name (move from RecordService) ────────


async def test_get_or_create_by_name_is_not_transactional():
    """The scenario-helper must NOT be wrapped by @transactional."""
    assert not hasattr(VisitorService.get_or_create_by_name, _TRANSACTIONAL_MARKER), (
        "get_or_create_by_name is a scenario building block — it must NOT "
        "commit; the usecases layer owns the transaction boundary"
    )


async def test_get_or_create_by_name_finds_existing_visitor(db_session):
    """(client_id, name) hit returns the existing row — no second visitor."""
    client = Client(name="C")
    db_session.add(client)
    await db_session.commit()
    existing = Visitor(client_id=client.id, name="Алиса", age=30)
    db_session.add(existing)
    await db_session.commit()

    service = get_visitor_service()
    visitor = await service.get_or_create_by_name(db_session, client.id, "Алиса")

    assert visitor.id == existing.id
    assert visitor.age == 30  # untouched on hit — no defaults applied
    rows = (await db_session.execute(select(Visitor))).scalars().all()
    assert len(rows) == 1


async def test_get_or_create_by_name_creates_with_age(db_session):
    """Miss → new visitor with the caller's name and age, flushed."""
    client = Client(name="C")
    db_session.add(client)
    await db_session.commit()

    service = get_visitor_service()
    visitor = await service.get_or_create_by_name(
        db_session, client.id, "Борис", age=35
    )

    assert visitor.id is not None  # flushed — id assigned
    assert visitor.client_id == client.id
    assert visitor.name == "Борис"
    assert visitor.age == 35
    rows = (await db_session.execute(select(Visitor))).scalars().all()
    assert len(rows) == 1


async def test_get_or_create_by_name_same_name_different_clients(db_session):
    """Lookup keys on (client_id, name) — the same name under another client
    does NOT hit (mirrors the RecordService resolver's two-column filter)."""
    c1 = Client(name="C1")
    c2 = Client(name="C2")
    db_session.add_all([c1, c2])
    await db_session.commit()
    db_session.add(Visitor(client_id=c1.id, name="Алиса"))
    await db_session.commit()

    service = get_visitor_service()
    visitor = await service.get_or_create_by_name(db_session, c2.id, "Алиса")

    assert visitor.client_id == c2.id
    rows = (await db_session.execute(select(Visitor))).scalars().all()
    assert len(rows) == 2


async def test_get_or_create_by_name_does_not_commit(db_session):
    """No-commit property: rollback after a creation undoes it (mock-free)."""
    from tests.conftest import query_db

    client = Client(name="C")
    db_session.add(client)
    await db_session.commit()

    service = get_visitor_service()
    visitor = await service.get_or_create_by_name(db_session, client.id, "Гость")
    await db_session.rollback()

    assert query_db(
        f"SELECT COUNT(*) AS c FROM visitors WHERE id='{visitor.id}'"
    )[0]["c"] == 0, (
        "get_or_create_by_name must NOT commit — the scenario layer owns "
        "the transaction boundary (canon rule 3)"
    )


# ── GH #327 Task 2 — _delete_cascade becomes an own-edge command ──────────────


async def test_delete_cascade_is_own_edge_visitor_tags_and_row_only(
    db_session, db_engine
):
    """Direct ``_delete_cascade`` removes the visitor row and its
    visitor_tags join rows but issues NO DELETE against the ``visits``
    table — visits belong to the OWNER service
    (``VisitService.delete_visits_by_visitor`` → GH #327 Task 1); the
    standalone ``delete`` composes that brick BEFORE the own-edge core.

    Observation is at the SQL-statement level, not the row level: the
    schema FK ``visits.visitor_id → visitors`` is ``ON DELETE CASCADE``
    (migration b7c8d9e0f1a2) and FKs are enforced (``PRAGMA
    foreign_keys=ON`` in the engine checkout listener), so the visit ROW
    legitimately dies WITH the visitor row at DB level — the own-edge
    contract under test is that the SERVICE issues no visits-table SQL
    (canon rule 1: one writer per table; statement-counter pattern of
    ``test_delete_visits_by_visitor_is_one_delete_statement``).
    """
    from datetime import datetime

    from sqlalchemy import event

    # Setup: a visitor with a tag join row and one linked visit
    # (committed) — the same shape as test_visitor_delete_cascades_to_visits.
    from src.models.activity import Activity
    from src.models.location import Location
    from src.models.master import Master
    from src.models.record import Record
    from src.models.service import Service
    from src.models.staff import Staff
    from src.models.tag import Tag, visitor_tags
    from src.models.visit import Visit

    staff = Staff(first_name="Oe", last_name="T")
    service = Service(title="OeSvc", description="d", image_url="http://x",
                      specialty="s", min_age=5, duration=60, record_info="r")
    location = Location(title="OeLoc", capacity=20)
    db_session.add_all([staff, service, location])
    await db_session.flush()
    db_session.add(Master(staff_id=staff.id, specialty="s", color="#000000"))
    await db_session.flush()
    activity = Activity(
        master_id=staff.id, service_id=service.id, location_id=location.id,
        start=datetime(2030, 1, 1, 12, 0), duration=90, capacity=10,
        is_private=False,
    )
    db_session.add(activity)
    client = Client(name="Oe Client", phone=None)
    db_session.add(client)
    await db_session.flush()
    record = Record(activity_id=activity.id, client_id=client.id,
                    status="pending", seats=1)
    db_session.add(record)
    visitor = Visitor(client_id=client.id, name="Alice")
    db_session.add(visitor)
    await db_session.flush()
    tag = Tag(title="oe-tag")
    db_session.add(tag)
    await db_session.flush()
    await db_session.execute(
        visitor_tags.insert().values(visitor_id=visitor.id, tag_id=tag.id)
    )
    db_session.add(Visit(record_id=record.id, visitor_id=visitor.id,
                         tariff_id=None, price=2000, custom_price=None,
                         status="waiting"))
    await db_session.commit()
    visitor_id = visitor.id

    # Act: direct call of the own-edge core, counting visits-table DELETEs.
    visits_deletes = {"n": 0}

    def _before(conn, cursor, statement, params, context, executemany):
        if (
            statement.lstrip().upper().startswith("DELETE")
            and " FROM visits" in statement
        ):
            visits_deletes["n"] += 1

    event.listen(db_engine.sync_engine, "before_cursor_execute", _before)
    try:
        result = await get_visitor_service()._delete_cascade(db_session, visitor_id)
    finally:
        event.remove(db_engine.sync_engine, "before_cursor_execute", _before)

    # Visitor row and its tag join rows are gone (own edge executed)…
    from tests.conftest import query_db

    await db_session.rollback()  # un-observe the uncommitted deletes
    assert result is True
    assert query_db(
        f"SELECT COUNT(*) AS c FROM visitor_tags WHERE visitor_id='{visitor_id}'"
    )[0]["c"] == 1  # pre-state sanity: the join row existed
    # …and the service issued ZERO DELETEs against the visits table.
    assert visits_deletes["n"] == 0, (
        "_delete_cascade must NOT touch the visits table — visits are "
        "deleted by the owner service (VisitService.delete_visits_by_visitor, "
        "GH #327 Task 1); the standalone delete composes that brick before "
        "the own-edge core (canon rule 1: one writer per table)"
    )
