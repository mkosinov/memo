"""Unit tests for owner-repository bulk commands (GH #171 Task 1).

Canon rule 1/4 (docs/domain-rules/service-layer.md): bulk = ONE set-based
command filtered on the entity's OWN reference column — never a Python loop;
commands live in the persistence layer of the OWNER entity:
  - PaymentRepository.delete_by_record_id — one DELETE on payments.record_id
  - VisitRepository.delete_by_record_id  — one DELETE on visits.record_id
  - VisitRepository.create_bulk          — one INSERT of a batch of visits
  - RecordRepository.delete_tags_by_record_id — one DELETE on record_tags
    (the record's OWN edge — canon rule 1: record_tags belongs to the
    records side)

No HTTP layer — drives repositories directly via the ``db_session`` fixture.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from src.models.activity import Activity
from src.models.location import Location
from src.models.master import Master
from src.models.payment import Payment
from src.models.record import Record
from src.models.service import Service
from src.models.staff import Staff
from src.models.tag import Tag, record_tags
from src.models.visit import Visit
from src.repositories.payment import PaymentRepository, get_payment_repository
from src.repositories.record import RecordRepository, get_record_repository
from src.repositories.visit import VisitRepository, get_visit_repository

pytestmark = pytest.mark.asyncio


# ─── Helpers ────────────────────────────────────────────────────────────────────


def _service() -> Service:
    return Service(
        title="S",
        description="d",
        image_url="http://x",
        specialty="живопись",
        min_age=0,
        duration=60,
        record_info="r",
    )


def _location() -> Location:
    return Location(title="L", address="a", capacity=20)


async def _activity(db_session, **overrides) -> Activity:
    staff_id = overrides.get("staff_id") or _mk_staff(db_session)
    master = overrides.get("master") or Master(
        staff_id=staff_id,
        specialty="живопись",
        color="#000000",
    )
    db_session.add(master)
    service = overrides.get("service") or _service()
    db_session.add(service)
    location = overrides.get("location") or _location()
    db_session.add(location)
    await db_session.flush()
    activity = Activity(
        master_id=master.staff_id,
        service_id=service.id,
        location_id=location.id,
        start=datetime.now(UTC) + timedelta(days=1),
        duration=60,
        capacity=10,
        is_private=False,
    )
    db_session.add(activity)
    await db_session.flush()
    return activity


def _mk_staff(db_session) -> str:
    """Add a Staff card row, return the staff_id (for the Master extension).

    The id is generated explicitly (mirroring the ORM uuid default) so the
    Master extension row can reference it before any flush.
    """
    staff_id = str(uuid.uuid4())
    db_session.add(
        Staff(id=staff_id, first_name="F", last_name=f"T{uuid.uuid4().hex[:6]}", sort_order=0)
    )
    return staff_id


def _record(activity: Activity, **overrides) -> Record:
    defaults: dict = dict(
        activity_id=activity.id,
        client_id=None,
        status="pending",
        seats=0,
        comment=None,
        custom_price=None,
    )
    defaults.update(overrides)
    return Record(**defaults)


def _visit(record_id: str, **overrides) -> Visit:
    defaults: dict = dict(
        record_id=record_id,
        visitor_id=None,
        tariff_id=None,
        price=1000,
        custom_price=None,
        status="waiting",
    )
    defaults.update(overrides)
    return Visit(**defaults)


def _payment(record_id: str, **overrides) -> Payment:
    defaults: dict = dict(
        record_id=record_id,
        amount=500,
        method="cash",
    )
    defaults.update(overrides)
    return Payment(**defaults)


# ─── PaymentRepository.delete_by_record_id ─────────────────────────────────────


async def test_payment_delete_by_record_id_removes_only_own(db_session) -> None:
    """One DELETE on payments.record_id removes that record's payments only."""
    activity = await _activity(db_session)
    r1 = _record(activity)
    r2 = _record(activity)
    db_session.add_all([r1, r2])
    await db_session.flush()
    db_session.add_all(
        [
            _payment(r1.id, amount=100),
            _payment(r1.id, amount=200),
            _payment(r2.id, amount=300),
        ]
    )
    await db_session.flush()

    repo = get_payment_repository()
    await repo.delete_by_record_id(db_session, r1.id)

    remaining = (await db_session.execute(select(Payment))).scalars().all()
    assert [p.record_id for p in remaining] == [r2.id]
    assert remaining[0].amount == 300


async def test_payment_delete_by_record_id_no_match_is_noop(db_session) -> None:
    """Deleting payments of an unknown record_id affects nothing (and no error)."""
    activity = await _activity(db_session)
    record = _record(activity)
    db_session.add(record)
    await db_session.flush()
    db_session.add(_payment(record.id, amount=42))
    await db_session.flush()

    repo = PaymentRepository()
    await repo.delete_by_record_id(db_session, "no-such-record")

    remaining = (await db_session.execute(select(Payment))).scalars().all()
    assert len(remaining) == 1


# ─── VisitRepository.delete_by_record_id ───────────────────────────────────────


async def test_visit_delete_by_record_id_removes_only_own(db_session) -> None:
    """One DELETE on visits.record_id removes that record's visits only."""
    activity = await _activity(db_session)
    r1 = _record(activity)
    r2 = _record(activity)
    db_session.add_all([r1, r2])
    await db_session.flush()
    db_session.add_all(
        [
            _visit(r1.id, price=1),
            _visit(r1.id, price=2),
            _visit(r2.id, price=3),
        ]
    )
    await db_session.flush()

    repo = get_visit_repository()
    await repo.delete_by_record_id(db_session, r1.id)

    remaining = (await db_session.execute(select(Visit))).scalars().all()
    assert [v.record_id for v in remaining] == [r2.id]
    assert remaining[0].price == 3


async def test_visit_delete_by_record_id_no_match_is_noop(db_session) -> None:
    """Deleting visits of an unknown record_id affects nothing (and no error)."""
    activity = await _activity(db_session)
    record = _record(activity)
    db_session.add(record)
    await db_session.flush()
    db_session.add(_visit(record.id))
    await db_session.flush()

    repo = VisitRepository()
    await repo.delete_by_record_id(db_session, "no-such-record")

    remaining = (await db_session.execute(select(Visit))).scalars().all()
    assert len(remaining) == 1


# ─── VisitRepository.create_bulk ───────────────────────────────────────────────


async def test_visit_create_bulk_inserts_batch(db_session) -> None:
    """One bulk INSERT persists a batch of visits bound to the record."""
    activity = await _activity(db_session)
    record = _record(activity)
    db_session.add(record)
    await db_session.flush()

    repo = get_visit_repository()
    batch = [
        _visit(record.id, price=100),
        _visit(record.id, price=200, status="visited"),
        _visit(record.id, price=300, visitor_id=None),
    ]
    await repo.create_bulk(db_session, batch)

    rows = (
        (await db_session.execute(select(Visit).where(Visit.record_id == record.id)))
        .scalars()
        .all()
    )
    assert sorted(v.price for v in rows) == [100, 200, 300]
    assert all(v.record_id == record.id for v in rows)


async def test_visit_create_bulk_empty_batch_is_noop(db_session) -> None:
    """An empty batch inserts nothing (and no error)."""
    repo = VisitRepository()
    await repo.create_bulk(db_session, [])

    total = (await db_session.execute(select(func.count()).select_from(Visit))).scalar_one()
    assert total == 0


# ─── RecordRepository.delete_tags_by_record_id ─────────────────────────────────


async def test_record_delete_tags_by_record_id_removes_only_own(db_session) -> None:
    """One DELETE on record_tags.record_id removes that record's tag links only
    (record_tags is the record's OWN edge — canon rule 1)."""
    activity = await _activity(db_session)
    r1 = _record(activity)
    r2 = _record(activity)
    db_session.add_all([r1, r2])
    t1 = Tag(title=f"tag1-{uuid.uuid4().hex[:6]}")
    t2 = Tag(title=f"tag2-{uuid.uuid4().hex[:6]}")
    db_session.add_all([t1, t2])
    await db_session.flush()
    await db_session.execute(
        record_tags.insert(),
        [
            {"record_id": r1.id, "tag_id": t1.id},
            {"record_id": r1.id, "tag_id": t2.id},
            {"record_id": r2.id, "tag_id": t1.id},
        ],
    )
    await db_session.flush()

    repo = get_record_repository()
    await repo.delete_tags_by_record_id(db_session, r1.id)

    rows = (await db_session.execute(select(record_tags))).all()
    assert len(rows) == 1
    assert rows[0].record_id == r2.id  # type: ignore[attr-defined]


async def test_record_delete_tags_by_record_id_no_match_is_noop(db_session) -> None:
    """Deleting tag links of an unknown record_id affects nothing (and no error)."""
    activity = await _activity(db_session)
    record = _record(activity)
    tag = Tag(title=f"tag-{uuid.uuid4().hex[:6]}")
    db_session.add_all([record, tag])
    await db_session.flush()
    await db_session.execute(record_tags.insert().values(record_id=record.id, tag_id=tag.id))
    await db_session.flush()

    repo = RecordRepository()
    await repo.delete_tags_by_record_id(db_session, "no-such-record")

    rows = (await db_session.execute(select(record_tags))).all()
    assert len(rows) == 1
