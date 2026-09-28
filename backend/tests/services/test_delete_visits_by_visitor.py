"""GH #324 Task 2 — the visitor's visits batch-delete block + record recompute.

Spec §5 (``docs/specs/2026-09-21-delete-family-remaining-324-design.md``):

* ``VisitService.delete_visits_by_visitor`` — the единый строительный блок:
  collect the affected ``record_id``s → bulk-delete the visitor's visits →
  recompute EVERY affected record (seats + status via
  ``recompute_record_seats``/``recompute_record_status`` — the single-visit
  delete precedent) → SSE markers ``visits`` + ``records``.
* ``VisitorService._delete_cascade`` delegates its internals to the block
  (signature + transactional semantics unchanged — the client-cascade
  atomicity monkeypatch test ``test_api_clients.py`` stays green UNMODIFIED).
* The ``(Visitor, "visits")`` CASCADE_HANDLERS slot dispatches the block
  (the Task-1 deferral comment prescribed exactly this wiring).
* Client cascade inherits the recompute through the common ``_delete_cascade``
  path — no separate client-flow code («наследование пересчёта», spec §5).
* Empty visitor (no visits) → full no-op: no DELETE, no idle recompute.

Service-level unit tests: direct ORM setup, real services, no HTTP.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select

from src.models.activity import Activity
from src.models.client import Client
from src.models.location import Location
from src.models.master import Master
from src.models.record import Record
from src.models.service import Service
from src.models.staff import Staff
from src.models.tag import Tag, visitor_tags
from src.models.visit import Visit
from src.models.visitor import Visitor
from src.services.visit import get_visit_service
from src.services.visitor import get_visitor_service

# asyncio_mode = "auto" (pyproject) — async tests collect without marks.


# ─── Direct-ORM setup helpers (mirror tests/services/test_delete_cascades.py) ──


async def _world(db_session) -> Activity:
    """Insert Staff + master extension + Service + Location + Activity."""
    staff = Staff(first_name="М", last_name="Л")
    service = Service(
        title="S",
        description="d",
        image_url="i",
        specialty="s",
        min_age=5,
        duration=60,
        record_info="r",
    )
    location = Location(title="L", capacity=20)
    db_session.add_all([staff, service, location])
    await db_session.flush()
    db_session.add(Master(staff_id=staff.id, specialty="s", color="#000000"))
    await db_session.flush()
    activity = Activity(
        master_id=staff.id,
        service_id=service.id,
        location_id=location.id,
        start=datetime(2030, 1, 1, 12, 0),
        duration=90,
        capacity=10,
        is_private=False,
    )
    db_session.add(activity)
    await db_session.flush()
    return activity


async def _client_row(db_session, name: str = "Мария") -> Client:
    client = Client(name=name, phone=None)
    db_session.add(client)
    await db_session.flush()
    return client


async def _visitor_row(db_session, client: Client, name: str = "Алиса") -> Visitor:
    visitor = Visitor(client_id=client.id, name=name)
    db_session.add(visitor)
    await db_session.flush()
    return visitor


async def _record_row(
    db_session,
    activity: Activity,
    client: Client | None,
    *,
    status: str,
    seats: int,
) -> Record:
    record = Record(
        activity_id=activity.id,
        client_id=client.id if client else None,
        status=status,
        seats=seats,
    )
    db_session.add(record)
    await db_session.flush()
    return record


async def _visit_row(
    db_session,
    record: Record,
    *,
    visitor_id: str | None = None,
    status: str = "waiting",
) -> Visit:
    visit = Visit(
        record_id=record.id,
        visitor_id=visitor_id,
        tariff_id=None,
        price=1000,
        custom_price=None,
        status=status,
    )
    db_session.add(visit)
    await db_session.flush()
    return visit


async def _tag_row(db_session, title: str = "VIP") -> Tag:
    tag = Tag(title=title)
    db_session.add(tag)
    await db_session.flush()
    return tag


# ─── The block itself ───────────────────────────────────────────────────────────


class TestDeleteVisitsByVisitorBlock:
    async def test_deletes_visits_and_recomputes_every_affected_record(
        self,
        db_session,
    ) -> None:
        """Block: visitor's visits die across ALL his records; every affected
        record is recomputed (seats AND status); other visitors'/anonymous
        visits survive untouched."""
        activity = await _world(db_session)
        client = await _client_row(db_session)
        alice = await _visitor_row(db_session, client, "Алиса")
        # record1: only Alice's visited seat → after: seats 0, waiting (0
        # visits edge case of compute_record_status).
        record1 = await _record_row(db_session, activity, client, status="visited", seats=1)
        await _visit_row(db_session, record1, visitor_id=alice.id, status="visited")
        # record2: Alice's visited seat + an anonymous waiting seat → after:
        # seats 1 (anonymous survives), status waiting (was visited).
        record2 = await _record_row(db_session, activity, client, status="visited", seats=2)
        await _visit_row(db_session, record2, visitor_id=alice.id, status="visited")
        anon = await _visit_row(db_session, record2, visitor_id=None, status="waiting")
        await db_session.commit()

        await get_visit_service().delete_visits_by_visitor(db_session, alice.id)

        # Alice's visits gone everywhere.
        left = (
            (await db_session.execute(select(Visit).where(Visit.visitor_id == alice.id)))
            .scalars()
            .all()
        )
        assert left == []
        # The anonymous seat of record2 survives.
        assert await db_session.get(Visit, anon.id) is not None
        # record1 recomputed: seats 0, status waiting.
        assert record1.seats == 0
        assert record1.status == "waiting"
        # record2 recomputed: seats 1, status waiting (visited seat died).
        assert record2.seats == 1
        assert record2.status == "waiting"

    async def test_block_is_not_transactional(self) -> None:
        """Building block — the executor owns the transaction boundary (same
        contract as ``delete_visits_by_record``/``create_visits_bulk``)."""
        from src.services.decorators import _TRANSACTIONAL_MARKER
        from src.services.visit import VisitService

        assert not hasattr(VisitService.delete_visits_by_visitor, _TRANSACTIONAL_MARKER), (
            "delete_visits_by_visitor is a building block for executors "
            "(Visitor resolve_delete / _delete_cascade / future delete_client) "
            "— it must NOT commit; the caller owns the transaction boundary"
        )

    async def test_marks_visits_and_records(self, db_session) -> None:
        """The block marks SSE ``visits`` + ``records`` (like the single path)."""
        from src.events import emitter

        activity = await _world(db_session)
        client = await _client_row(db_session)
        alice = await _visitor_row(db_session, client)
        record = await _record_row(db_session, activity, client, status="waiting", seats=1)
        await _visit_row(db_session, record, visitor_id=alice.id)
        await db_session.commit()

        token = emitter.start_accumulation(set())
        try:
            await get_visit_service().delete_visits_by_visitor(db_session, alice.id)
            assert emitter.accumulated() == {"visits", "records"}
        finally:
            emitter.reset_accumulation(token)


# ─── VisitorService._delete_cascade delegation ─────────────────────────────────


class TestVisitorDeleteCascadeDelegation:
    async def test_visitor_delete_removes_visits_tags_and_recomputes_records(
        self,
        db_session,
    ) -> None:
        """``VisitorService.delete`` → ``_delete_cascade`` → the block: visitor
        row, his visits and visitor_tags join rows all die; the tag survives;
        the affected record is recomputed."""
        activity = await _world(db_session)
        client = await _client_row(db_session)
        alice = await _visitor_row(db_session, client)
        tag = await _tag_row(db_session, "VIP")
        await db_session.execute(visitor_tags.insert().values(visitor_id=alice.id, tag_id=tag.id))
        record = await _record_row(db_session, activity, client, status="visited", seats=2)
        await _visit_row(db_session, record, visitor_id=alice.id, status="visited")
        anon = await _visit_row(db_session, record, visitor_id=None, status="waiting")
        await db_session.commit()

        result = await get_visitor_service().delete(db_session=db_session, id=alice.id)

        assert result is True
        assert await db_session.get(Visitor, alice.id) is None
        # Visits of the visitor gone; the anonymous seat survives.
        assert (
            await db_session.execute(select(Visit).where(Visit.visitor_id == alice.id))
        ).scalars().all() == []
        assert await db_session.get(Visit, anon.id) is not None
        # visitor_tags join rows gone; the tag survives.
        assert (
            await db_session.execute(
                select(visitor_tags).where(visitor_tags.c.visitor_id == alice.id)
            )
        ).all() == []
        assert await db_session.get(Tag, tag.id) is not None
        # The record is recomputed (seats + status honest).
        assert record.seats == 1
        assert record.status == "waiting"

    async def test_visitor_without_visits_triggers_no_recompute(
        self,
        db_session,
        monkeypatch,
    ) -> None:
        """Empty visitor (no visits): no idle recompute calls — the block
        early-returns before the bulk DELETE and the recompute loop."""
        import src.services.visit as visit_module

        client = await _client_row(db_session)
        empty = await _visitor_row(db_session, client, "Пустой")
        await db_session.commit()

        calls = {"seats": 0, "status": 0}
        real_seats = visit_module.recompute_record_seats
        real_status = visit_module.recompute_record_status

        async def spy_seats(session, record_id):
            calls["seats"] += 1
            return await real_seats(session, record_id)

        async def spy_status(session, record_id):
            calls["status"] += 1
            return await real_status(session, record_id)

        monkeypatch.setattr(visit_module, "recompute_record_seats", spy_seats)
        monkeypatch.setattr(visit_module, "recompute_record_status", spy_status)

        result = await get_visitor_service().delete(db_session=db_session, id=empty.id)

        assert result is True
        assert await db_session.get(Visitor, empty.id) is None
        assert calls == {"seats": 0, "status": 0}


# ─── Client cascade inherits the recompute (spec §5 «наследование») ────────────


class TestClientCascadeInheritsRecompute:
    async def test_client_resolve_delete_recomputes_nullified_records(
        self,
        db_session,
    ) -> None:
        """Client → visitors cascade runs the same shared brick path, so
        the records (nullified, surviving) get honest seats/status — no
        separate client-flow code (invariant: визит удалён → запись
        пересчитана).

        Rebase #324/#327: the client execute branch is the
        ``usecases.clients.delete_client`` scenario (the generic
        ``resolve_delete`` no longer carries client CASCADE handlers);
        the scenario's visitor loop calls the SAME
        ``delete_visits_by_visitor`` brick, so the recompute inheritance
        survives the migration unchanged.

        GH #345 Task 4: the scenario carries the mandatory ``expected``
        subset-verification — pass the fresh id-sets for the non-auto
        deps (records/visitors; auto deps are exempt), mirroring how
        ``test_api_clients.py`` builds ``expected`` from the tree."""
        from src.usecases.clients import delete_client

        activity = await _world(db_session)
        client = await _client_row(db_session)
        v1 = await _visitor_row(db_session, client, "Один")
        v2 = await _visitor_row(db_session, client, "Два")  # empty visitor
        # record1: v1's visited seat + anonymous waiting → 2 seats, visited.
        record1 = await _record_row(db_session, activity, client, status="visited", seats=2)
        await _visit_row(db_session, record1, visitor_id=v1.id, status="visited")
        await _visit_row(db_session, record1, visitor_id=None, status="waiting")
        # record2: only v1's seat → 1 seat, waiting → after: 0 seats, waiting.
        record2 = await _record_row(db_session, activity, client, status="waiting", seats=1)
        await _visit_row(db_session, record2, visitor_id=v1.id, status="waiting")
        await db_session.commit()

        ok = await delete_client(
            None,
            db_session=db_session,
            id=client.id,
            resolutions={"records": "nullify", "visitors": "cascade"},
            # GH #345 Task 4: fresh snapshot of the non-auto deps —
            # records/visitors ids as str uuids, mirroring the API tests'
            # ``_expected_from_tree`` builder (ids are Mapped[str]).
            expected={
                "records": [record1.id, record2.id],
                "visitors": [v1.id, v2.id],
            },
        )

        assert ok is True
        assert await db_session.get(Client, client.id) is None
        assert await db_session.get(Visitor, v1.id) is None
        assert await db_session.get(Visitor, v2.id) is None
        # Records survive, nullified (anonymous) — and recomputed.
        r1 = await db_session.get(Record, record1.id)
        r2 = await db_session.get(Record, record2.id)
        assert r1 is not None and r1.client_id is None
        assert r2 is not None and r2.client_id is None
        assert r1.seats == 1
        assert r1.status == "waiting"  # only the anonymous waiting seat remains
        assert r2.seats == 0
        assert r2.status == "waiting"


# ─── (Visitor, "visits") executor wiring ────────────────────────────────────────


class TestVisitorVisitsBatchHandlerWiring:
    def test_batch_handler_registered_in_cascade_handlers(self) -> None:
        """The Task-1 deferral comment prescribed wiring the batch handler as
        the ``(Visitor, "visits")`` slot — the guard mirror of the Task-1 set."""
        from src.domain.deletion import CASCADE_HANDLERS

        assert (Visitor, "visits") in CASCADE_HANDLERS

    async def test_visitor_resolve_delete_dispatches_batch_handler(
        self,
        db_session,
    ) -> None:
        """resolve_delete on a visitor WITH visits: the batch handler deletes
        the visits + recomputes the record; visitor_tags is auto (empty
        resolutions entry is fine); the tag survives; the visitor row dies."""
        activity = await _world(db_session)
        client = await _client_row(db_session)
        alice = await _visitor_row(db_session, client)
        tag = await _tag_row(db_session, "VIP")
        await db_session.execute(visitor_tags.insert().values(visitor_id=alice.id, tag_id=tag.id))
        record = await _record_row(db_session, activity, client, status="visited", seats=2)
        await _visit_row(db_session, record, visitor_id=alice.id, status="visited")
        anon = await _visit_row(db_session, record, visitor_id=None, status="waiting")
        await db_session.commit()

        ok = await get_visitor_service().resolve_delete(
            db_session,
            alice.id,
            {"visits": "cascade"},
        )
        await db_session.commit()

        assert ok is True
        assert await db_session.get(Visitor, alice.id) is None
        assert (
            await db_session.execute(select(Visit).where(Visit.visitor_id == alice.id))
        ).scalars().all() == []
        assert await db_session.get(Visit, anon.id) is not None
        assert (
            await db_session.execute(
                select(visitor_tags).where(visitor_tags.c.visitor_id == alice.id)
            )
        ).all() == []
        assert await db_session.get(Tag, tag.id) is not None
        # The affected record recomputed through the executor path too.
        assert record.seats == 1
        assert record.status == "waiting"
