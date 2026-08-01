"""Cascade hard-delete tests for Record, Activity, and Visitor services.

These are SERVICE-LEVEL tests: they call the service methods directly against
a real async ``db_session`` and verify the resulting DB state with ORM selects.
No HTTP, no Pydantic response schemas — this sidesteps the in-flight
schema refactor (#194 Task 6) where response schemas still require ``is_active``
for the now-hard-delete entities.

Data is set up via direct ORM inserts (committed) rather than the API factories,
because the ``create_activity``/``create_record``/``create_visitor`` factories go
through response serialization that currently raises ValidationError.

Cascade contract (#194 Task 5):
  * RecordService.delete       → delete record + its visits + its payments
  * ActivityService.delete     → delete activity + its records (+ their visits/payments)
                                 + unlink photos (activity_id := NULL)
  * VisitorService.delete      → delete visitor + its visits
                                 + unlink photos (visitor_id := NULL)
All cascade deletes are explicit SQL inside ONE ``@transactional`` transaction,
so a mid-cascade failure rolls back the whole unit (atomicity test).
"""

from __future__ import annotations

from datetime import datetime

import pytest

from src.models.activity import Activity
from src.models.client import Client
from src.models.location import Location
from src.models.master import Master
from src.models.payment import Payment
from src.models.photo import Photo
from src.models.record import Record
from src.models.service import Service
from src.models.visit import Visit
from src.models.visitor import Visitor
from src.services.activity import get_activity_service
from src.services.record import get_record_service
from src.services.visitor import get_visitor_service
from sqlalchemy import select

pytestmark = pytest.mark.asyncio


# ─── Direct-ORM setup helpers (bypass broken response schemas) ──────────────────

async def _insert_activity(db_session) -> Activity:
    """Insert Master + Service + Location + Activity (committed)."""
    master = Master(first_name="M", last_name="L", color="#000000",
                    position="p", specialty="s")
    service = Service(title="S", description="d", image_url="http://x",
                     specialty="s", min_age=5, duration=60, record_info="r")
    location = Location(name="L", capacity=20)
    db_session.add_all([master, service, location])
    await db_session.flush()
    activity = Activity(
        master_id=master.id, service_id=service.id, location_id=location.id,
        start=datetime(2030, 1, 1, 12, 0), duration=90, capacity=10,
        is_private=False,
    )
    db_session.add(activity)
    await db_session.commit()
    return activity


async def _insert_client(db_session) -> Client:
    """Insert a Client (committed)."""
    client = Client(name="C", phone=None)
    db_session.add(client)
    await db_session.commit()
    return client


async def _insert_record(
    db_session, activity: Activity, client: Client,
    *, num_visits: int = 1, num_payments: int = 0,
) -> Record:
    """Insert a Record with N visits and M payments (committed)."""
    record = Record(
        activity_id=activity.id, client_id=client.id, status="pending",
        seats=num_visits, anonym_visits=0,
    )
    db_session.add(record)
    await db_session.flush()
    for _ in range(num_visits):
        db_session.add(Visit(
            record_id=record.id, visitor_id=None, tariff_id=None,
            price=1000, custom_price=None, status="waiting",
        ))
    for _ in range(num_payments):
        db_session.add(Payment(record_id=record.id, amount=500, method="cash"))
    await db_session.commit()
    return record


async def _insert_visitor(db_session, client: Client, name: str = "V") -> Visitor:
    """Insert a Visitor (committed)."""
    visitor = Visitor(client_id=client.id, name=name)
    db_session.add(visitor)
    await db_session.commit()
    return visitor


async def _insert_photo(
    db_session, *, activity_id: str | None = None, visitor_id: str | None = None,
) -> Photo:
    """Insert a Photo (committed)."""
    photo = Photo(filename="p.jpg", is_public=False,
                  activity_id=activity_id, visitor_id=visitor_id)
    db_session.add(photo)
    await db_session.commit()
    return photo


async def _await_scalar(db_session, stmt):
    """Run a select and return scalar_one_or_none()."""
    return (await db_session.execute(stmt)).scalar_one_or_none()


async def _await_all(db_session, stmt):
    """Run a select and return scalars().all()."""
    return (await db_session.execute(stmt)).scalars().all()


# ─── RecordService.delete ──────────────────────────────────────────────────────

async def test_record_delete_removes_visits_and_payments(db_session):
    """RecordService.delete hard-deletes the record plus its visits and payments.

    repo.get afterwards returns None; unrelated activity + client survive.
    """
    activity = await _insert_activity(db_session)
    client = await _insert_client(db_session)
    record = await _insert_record(
        db_session, activity, client, num_visits=2, num_payments=1,
    )
    record_id = record.id

    service = get_record_service()
    result = await service.delete(db_session=db_session, id=record_id)

    assert result is True
    # Record gone
    assert await _await_scalar(db_session, select(Record).where(Record.id == record_id)) is None
    # Service-level: repo.get returns None afterwards
    assert await service._repository.get(db_session, Record, record_id) is None
    # Visits for this record gone
    assert await _await_all(
        db_session, select(Visit).where(Visit.record_id == record_id),
    ) == []
    # Payments for this record gone
    assert await _await_all(
        db_session, select(Payment).where(Payment.record_id == record_id),
    ) == []
    # Activity + client untouched
    assert await _await_scalar(db_session, select(Activity).where(Activity.id == activity.id)) is not None
    assert await _await_scalar(db_session, select(Client).where(Client.id == client.id)) is not None


# ─── ActivityService.delete ─────────────────────────────────────────────────────

async def test_activity_delete_cascades_to_records_visits_payments_and_nullifies_photos(db_session):
    """ActivityService.delete removes the activity, all its records (with their
    visits/payments); linked photos survive with activity_id IS NULL.
    """
    activity = await _insert_activity(db_session)
    client = await _insert_client(db_session)
    r1 = await _insert_record(db_session, activity, client, num_visits=2, num_payments=1)
    r2 = await _insert_record(db_session, activity, client, num_visits=1, num_payments=1)
    photo = await _insert_photo(db_session, activity_id=activity.id)
    record_ids = {r1.id, r2.id}

    service = get_activity_service()
    result = await service.delete(db_session=db_session, id=activity.id)

    assert result is True
    # Activity gone
    assert await _await_scalar(db_session, select(Activity).where(Activity.id == activity.id)) is None
    # All its records gone
    assert await _await_all(
        db_session, select(Record).where(Record.activity_id == activity.id),
    ) == []
    # Visits that belonged to those records gone
    assert await _await_all(
        db_session, select(Visit).where(Visit.record_id.in_(record_ids)),
    ) == []
    # Payments that belonged to those records gone
    assert await _await_all(
        db_session, select(Payment).where(Payment.record_id.in_(record_ids)),
    ) == []
    # Photo survives, unlinked (activity_id IS NULL)
    surviving = await _await_scalar(db_session, select(Photo).where(Photo.id == photo.id))
    assert surviving is not None
    assert surviving.activity_id is None


async def test_activity_delete_with_no_records_or_photos_succeeds(db_session):
    """An activity with no records and no photos deletes cleanly."""
    activity = await _insert_activity(db_session)

    service = get_activity_service()
    result = await service.delete(db_session=db_session, id=activity.id)

    assert result is True
    assert await _await_scalar(db_session, select(Activity).where(Activity.id == activity.id)) is None


# ─── VisitorService.delete ──────────────────────────────────────────────────────

async def test_visitor_delete_cascades_to_visits_and_nullifies_photos(db_session):
    """VisitorService.delete removes the visitor and its visits; linked photos
    survive with visitor_id IS NULL; the visit's parent record is untouched.
    """
    activity = await _insert_activity(db_session)
    client = await _insert_client(db_session)
    # Visitor belongs to the client
    visitor = await _insert_visitor(db_session, client, name="Alice")
    # A record with one visit linked to that visitor
    record = Record(
        activity_id=activity.id, client_id=client.id, status="pending",
        seats=1, anonym_visits=0,
    )
    db_session.add(record)
    await db_session.flush()
    visit = Visit(
        record_id=record.id, visitor_id=visitor.id, tariff_id=None,
        price=2000, custom_price=None, status="waiting",
    )
    db_session.add(visit)
    # A photo linked to that visitor
    photo = Photo(filename="visitor.jpg", is_public=False, visitor_id=visitor.id)
    db_session.add(photo)
    await db_session.commit()
    visit_id = visit.id

    service = get_visitor_service()
    result = await service.delete(db_session=db_session, id=visitor.id)

    assert result is True
    # Visitor gone
    assert await _await_scalar(db_session, select(Visitor).where(Visitor.id == visitor.id)) is None
    # The visit linked to the visitor gone
    assert await _await_scalar(db_session, select(Visit).where(Visit.id == visit_id)) is None
    assert await _await_all(
        db_session, select(Visit).where(Visit.visitor_id == visitor.id),
    ) == []
    # Photo survives, unlinked (visitor_id IS NULL)
    surviving = await _await_scalar(db_session, select(Photo).where(Photo.id == photo.id))
    assert surviving is not None
    assert surviving.visitor_id is None
    # Parent record untouched
    assert await _await_scalar(db_session, select(Record).where(Record.id == record.id)) is not None


# ─── Atomicity ──────────────────────────────────────────────────────────────────

async def test_activity_delete_is_atomic_on_partial_failure(db_session, monkeypatch):
    """If a mid-cascade statement raises, NOTHING persists.

    The whole cascade runs inside ONE ``@transactional`` transaction: the
    decorator only commits after the method returns successfully, so a
    mid-cascade raise propagates WITHOUT committing. We make the
    payments-table ``delete()`` statement raise at construction time — it
    is the 2nd cascade delete (after the visits delete has already executed
    in the open, uncommitted transaction, but before the records/activity
    deletes) — by monkeypatching the ``delete`` symbol in the activity
    service module. The raise happens synchronously (no greenlet) inside
    the service body.

    After the raise we explicitly roll back the open transaction (undoing
    the uncommitted visits delete and releasing the write lock) and read
    the DB through a plain ``sqlite3`` connection (``query_db`` — no async
    pool, no greenlet) to assert the activity, its records, their visits
    AND their payments are ALL still present — proving the partial visits
    delete was undone and no changes persisted.
    """
    activity = await _insert_activity(db_session)
    client = await _insert_client(db_session)
    await _insert_record(db_session, activity, client, num_visits=1, num_payments=1)
    await _insert_record(db_session, activity, client, num_visits=1, num_payments=1)

    # Snapshot committed counts (2 records, 2 visits, 2 payments, 1 activity).
    n_records = len(await _await_all(db_session, select(Record)))
    n_visits = len(await _await_all(db_session, select(Visit)))
    n_payments = len(await _await_all(db_session, select(Payment)))
    assert n_records == 2 and n_visits == 2 and n_payments == 2

    service = get_activity_service()

    # Make ``delete(Payment)`` raise at construction time. The cascade calls
    # ``delete(Visit)`` (runs), then ``delete(Payment)`` (raises here, before
    # ``.where`` / ``execute``), so the records + activity deletes never run.
    import src.services.activity as activity_module
    real_delete = activity_module.delete

    def patched_delete(target, *args, **kwargs):
        if target is Payment:
            raise RuntimeError("simulated payments-delete failure")
        return real_delete(target, *args, **kwargs)

    monkeypatch.setattr(activity_module, "delete", patched_delete)

    with pytest.raises(RuntimeError, match="simulated payments-delete failure"):
        await service.delete(db_session=db_session, id=activity.id)

    # @transactional did NOT commit (exception propagated). Roll back the open
    # transaction so the uncommitted in-progress visits delete is undone and
    # the write lock is released.
    await db_session.rollback()

    # NOTHING persisted: activity + all records + visits + payments remain.
    # Verify through a raw sqlite connection (query_db) — independent of the
    # async session/pool — so the read reflects only the committed state and
    # the rolled-back visits delete is shown to have left no trace.
    from tests.conftest import query_db
    assert query_db("SELECT COUNT(*) AS c FROM activities")[0]["c"] == 1
    assert query_db("SELECT COUNT(*) AS c FROM records")[0]["c"] == n_records
    assert query_db("SELECT COUNT(*) AS c FROM visits")[0]["c"] == n_visits
    assert query_db("SELECT COUNT(*) AS c FROM payments")[0]["c"] == n_payments