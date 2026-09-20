"""Atomicity tests — one per record scenario, US1–US4 (GH #171 Task 7).

Spec § Тесты п. 3 (docs/specs/2026-09-18-service-usecases-design.md):
a forced mid-scenario step failure must leave NO partial changes in the
database — no orphaned visits, no payments, no record row. The
``@transactional`` boundary owns this: on any raise it skips the commit
and the caller's rollback undoes every pending write of the scenario.

METHOD: each test seeds a known baseline state (committed), then
monkeypatches a service getter in the SCENARIO MODULE's namespace with a
wrapper that lets the early steps run for real and explodes with
``_StepBoom`` on a LATER step — always AFTER real writes are already
pending in the session:

- US1 ``create_record`` — client + visitor + record row are written,
  then the bulk visit insert explodes;
- US2 ``update_record`` — the record row is updated and the OLD visits
  deleted, then the new-batch insert explodes;
- US3 ``patch_record`` — the comment is patched and the old visits
  deleted, then the new-batch insert explodes;
- US4 ``delete_record`` — visits are cascaded away, then the payments
  step explodes (the payments/record row/tags must survive).

Each fake records that it WAS called (``calls``), proving the injection
fired mid-scenario after the partial writes — and the exact-type
``pytest.raises(_StepBoom)`` fails with ``DID NOT RAISE`` if the
scenario never reaches the step or swallows the error.

How the tests were validated to be ABLE to fail (TDD RED-equivalent,
no production code touched): a scratch test simulated a broken
decorator by calling ``await db_session.commit()`` AFTER the scenario
raised (committing the partial writes on purpose) — every assertion
then failed on the leftover rows, i.e. the assertions below genuinely
discriminate "rolled back" from "partially committed". Scratch removed;
the committed tests pass against the real rollback behavior.

CALLING CONVENTION: scenarios are selfless functions — invoked with a
leading ``None`` and keyword arguments (see the module docstring in
``src/usecases/records.py``).
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

from src.models.activity import Activity
from src.models.payment import Payment
from src.models.record import Record
from src.models.tag import record_tags
from src.models.visit import Visit
from src.models.visitor import Visitor
from src.schemas.record import RecordCreate, RecordPatch, RecordUpdate, VisitItem

pytestmark = pytest.mark.asyncio


class _StepBoom(RuntimeError):
    """Injected mid-scenario failure — must propagate, never be swallowed."""


# ─── Seed helpers (row-level ops only, per the sibling files' pattern) ──────


async def _orm_activity(db_session, create_activity, capacity=10) -> Activity:
    """The ``create_activity`` factory rides the API (returns a dict);
    tests here need the ORM row — fetch it by the factory's id."""
    payload = create_activity(capacity=capacity)
    activity = await db_session.get(Activity, payload["id"])
    assert activity is not None
    return activity


async def _seed_record(db_session, activity, prices, payments=(), tag_ids=()) -> Record:
    """Insert a record + visits (+ payments / tag links) directly; commit."""
    from src.services.record import get_record_service
    from src.services.visit import get_visit_service

    record = await get_record_service().create_row(
        db_session, activity_id=activity.id, client_id=None,
        seats=len(prices), comment="seed comment", custom_price=None,
    )
    await get_visit_service().create_visits_bulk(
        db_session, record.id,
        [VisitItem(price=p) for p in prices],
    )
    for amount in payments:
        db_session.add(Payment(record_id=record.id, amount=amount))
    for tag_id in tag_ids:
        await db_session.execute(
            record_tags.insert().values(record_id=record.id, tag_id=tag_id)
        )
    await db_session.commit()
    return record


async def _insert_tag(db_session) -> str:
    """Insert a tag row directly; return its id (link target for record_tags)."""
    from src.models.tag import Tag

    tag_id = str(uuid.uuid4())
    db_session.add(Tag(id=tag_id, title=f"tag-{tag_id[:8]}"))
    await db_session.commit()
    return tag_id


async def _count(db_session, stmt) -> int:
    return (await db_session.execute(stmt)).scalar_one()


# ─── Failure-injection fakes ─────────────────────────────────────────────────


def _visit_service_boom_on_insert(calls: list[str]):
    """Wrapper around the REAL VisitService: deletes pass through (they are
    the partial writes we want pending), the batch insert explodes."""
    from src.services.visit import get_visit_service as real_getter

    class _VisitsExplodeOnInsert:
        def __getattr__(self, name):
            return getattr(real_getter(), name)

        async def delete_visits_by_record(self, *args, **kwargs):
            calls.append("delete_visits_by_record")
            return await real_getter().delete_visits_by_record(*args, **kwargs)

        async def create_visits_bulk(self, *args, **kwargs):
            calls.append("create_visits_bulk")
            raise _StepBoom("injected: bulk visit insert failed")

    return lambda: _VisitsExplodeOnInsert()


def _payment_service_boom_on_delete(calls: list[str]):
    """Wrapper around the REAL PaymentService: the payments cascade step
    explodes (called AFTER the visits cascade has already run)."""
    from src.services.payment import get_payment_service as real_getter

    class _PaymentsExplodeOnDelete:
        def __getattr__(self, name):
            return getattr(real_getter(), name)

        async def delete_by_record(self, *args, **kwargs):
            calls.append("delete_by_record")
            raise _StepBoom("injected: payments cascade failed")

    return lambda: _PaymentsExplodeOnDelete()


# ─── US1: create_record ──────────────────────────────────────────────────────


async def test_create_record_mid_step_failure_leaves_no_partial_state(
    db_session, create_activity, monkeypatch,
):
    """US1: the bulk-visit insert explodes AFTER client + visitor + record
    row are already pending → nothing persists: no record, no client, no
    visitor, no visits."""
    import src.usecases.records as records_module

    calls: list[str] = []
    monkeypatch.setattr(
        records_module, "get_visit_service", _visit_service_boom_on_insert(calls),
    )

    activity = await _orm_activity(db_session, create_activity)
    baseline_records = await _count(db_session, select(func.count()).select_from(Record))
    baseline_visits = await _count(db_session, select(func.count()).select_from(Visit))
    baseline_clients = await _count(db_session, select(func.count()).select_from(Visitor))
    phone = "+79996007070"

    data = RecordCreate(
        activity_id=activity.id,
        phone=phone,
        visits=[VisitItem(name="Атом", price=100)],
        comment="boom",
    )
    with pytest.raises(_StepBoom):
        await records_module.create_record(None, db_session=db_session, data=data)

    # The injection genuinely fired mid-scenario (past the client/visitor/
    # record writes, at the visit batch step).
    assert calls == ["create_visits_bulk"]

    await db_session.rollback()
    assert await _count(db_session, select(func.count()).select_from(Record)) == baseline_records
    assert await _count(db_session, select(func.count()).select_from(Visit)) == baseline_visits
    # The find-or-created client and its visitor are gone too (fresh query).
    assert (
        await _count(db_session, select(func.count()).select_from(Visitor))
        == baseline_clients
    ), "no orphaned visitors may survive the failed create"
    clients_left = (
        (await db_session.execute(
            select(Visitor).where(Visitor.name == "Атом"),
        )).scalars().all()
    )
    assert clients_left == [], "no orphaned visitor may survive the failed create"
    from src.models.client import Client

    assert (
        (await db_session.execute(
            select(Client).where(Client.phone == phone),
        )).scalars().all()
        == []
    ), "no orphaned client may survive the failed create"


# ─── US2: update_record ──────────────────────────────────────────────────────


async def test_update_record_mid_step_failure_leaves_no_partial_state(
    db_session, create_activity, monkeypatch,
):
    """US2: the new-batch insert explodes AFTER the row update and the OLD
    visits were deleted → the record keeps its pre-state (comment, seats)
    and the old visits are intact."""
    import src.usecases.records as records_module

    calls: list[str] = []
    monkeypatch.setattr(
        records_module, "get_visit_service", _visit_service_boom_on_insert(calls),
    )

    activity = await _orm_activity(db_session, create_activity)
    record = await _seed_record(db_session, activity, [100, 200])
    record_id = record.id  # rollback expires ORM objects — keep the id
    baseline_visits = await _count(
        db_session, select(func.count()).select_from(Visit).where(Visit.record_id == record_id),
    )
    assert baseline_visits == 2

    data = RecordUpdate(
        activity_id=activity.id,
        comment="replaced then boomed",
        custom_price=999,
        visits=[VisitItem(price=300)],
    )
    with pytest.raises(_StepBoom):
        await records_module.update_record(
            None, db_session=db_session, id=record_id, data=data,
        )

    # Both earlier visit steps ran for real (delete → insert exploded):
    # the rollback must restore the deleted visits.
    assert calls == ["delete_visits_by_record", "create_visits_bulk"]

    await db_session.rollback()
    stored = await db_session.get(Record, record_id)
    assert stored is not None, "the record row must survive"
    assert stored.comment == "seed comment"
    assert stored.custom_price is None
    assert stored.seats == 2
    visits = (
        (await db_session.execute(
            select(Visit).where(Visit.record_id == record_id),
        )).scalars().all()
    )
    assert sorted(v.price for v in visits) == [100, 200], (
        "the deleted old visits must be restored — no partial replacement"
    )


# ─── US3: patch_record ───────────────────────────────────────────────────────


async def test_patch_record_mid_step_failure_leaves_no_partial_state(
    db_session, create_activity, monkeypatch,
):
    """US3: the new-batch insert explodes AFTER the comment patch and the
    old visits were deleted → comment AND visits revert to pre-state."""
    import src.usecases.records as records_module

    calls: list[str] = []
    monkeypatch.setattr(
        records_module, "get_visit_service", _visit_service_boom_on_insert(calls),
    )

    activity = await _orm_activity(db_session, create_activity)
    record = await _seed_record(db_session, activity, [150])
    record_id = record.id

    data = RecordPatch(comment="patched then boomed", visits=[VisitItem(price=777)])
    with pytest.raises(_StepBoom):
        await records_module.patch_record(
            None, db_session=db_session, id=record_id, data=data,
        )

    assert calls == ["delete_visits_by_record", "create_visits_bulk"]

    await db_session.rollback()
    stored = await db_session.get(Record, record_id)
    assert stored is not None
    assert stored.comment == "seed comment"
    assert stored.seats == 1
    visits = (
        (await db_session.execute(
            select(Visit).where(Visit.record_id == record_id),
        )).scalars().all()
    )
    assert [v.price for v in visits] == [150]


# ─── US4: delete_record ──────────────────────────────────────────────────────


async def test_delete_record_mid_step_failure_leaves_no_partial_state(
    db_session, create_activity, monkeypatch,
):
    """US4: the payments cascade explodes AFTER the visits cascade already
    ran → the rollback restores the visits; record row, payments and tag
    links all survive (all-or-nothing, #285)."""
    import src.usecases.records as records_module

    calls: list[str] = []
    monkeypatch.setattr(
        records_module, "get_payment_service", _payment_service_boom_on_delete(calls),
    )

    activity = await _orm_activity(db_session, create_activity)
    tag_id = await _insert_tag(db_session)
    record = await _seed_record(
        db_session, activity, [100, 200], payments=[300, 400], tag_ids=[tag_id],
    )
    record_id = record.id
    visit_ids = [
        v.id for v in (
            (await db_session.execute(
                select(Visit).where(Visit.record_id == record_id),
            )).scalars().all()
        )
    ]
    payment_ids = [
        p.id for p in (
            (await db_session.execute(
                select(Payment).where(Payment.record_id == record_id),
            )).scalars().all()
        )
    ]
    assert len(visit_ids) == 2 and len(payment_ids) == 2

    with pytest.raises(_StepBoom):
        await records_module.delete_record(
            None, db_session=db_session, id=record_id,
            resolutions={"visits": "cascade", "payments": "cascade"},
            expected={"visits": visit_ids, "payments": payment_ids},
        )

    # The visits cascade really ran before the payments step exploded —
    # the rollback must have restored it.
    assert calls == ["delete_by_record"]

    await db_session.rollback()
    assert await db_session.get(Record, record_id) is not None, "record row survives"
    visits = (
        (await db_session.execute(
            select(Visit).where(Visit.record_id == record_id),
        )).scalars().all()
    )
    assert sorted(v.price for v in visits) == [100, 200], (
        "the cascaded-away visits must be restored — no partial delete"
    )
    payments = (
        (await db_session.execute(
            select(Payment).where(Payment.record_id == record_id),
        )).scalars().all()
    )
    assert sorted(p.amount for p in payments) == [300, 400], "payments survive"
    tags = (
        (await db_session.execute(
            select(record_tags).where(record_tags.c.record_id == record_id),
        )).all()
    )
    assert len(tags) == 1, "record_tags links survive"
