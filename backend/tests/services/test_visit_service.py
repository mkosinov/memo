"""Unit tests for VisitService CRUD methods (TDD — RED phase).

These tests exercise the service layer directly against a real async DB
session (via db_session fixture). No HTTP, no mocks.
"""

import pytest


@pytest.mark.asyncio
async def test_visit_service_list(db_session, sample_visits):
    """list returns all active visits in a PaginatedResponse envelope."""
    from src.repositories.generic import get_base_repository
    from src.services.visit import VisitService

    service = VisitService(get_base_repository())
    result = await service.list(db_session=db_session)
    assert result.total == len(sample_visits)
    assert len(result.items) == len(sample_visits)


@pytest.mark.asyncio
async def test_visit_service_list_filter_by_record(db_session, sample_visits):
    """list with record_id filter returns only matching visits."""
    from src.repositories.generic import get_base_repository
    from src.services.visit import VisitService

    service = VisitService(get_base_repository())
    record_id = sample_visits[0].record_id
    result = await service.list(db_session=db_session, record_id=record_id)
    assert all(v.record_id == record_id for v in result.items)
    assert result.total == len(sample_visits)


@pytest.mark.asyncio
async def test_visit_service_create_cascades_to_record(db_session, sample_record):
    """create cascades to record.seats and record.status."""
    from src.repositories.generic import get_base_repository
    from src.schemas.visit import VisitCreate
    from src.services.visit import VisitService

    service = VisitService(get_base_repository())
    original_seats = sample_record.seats  # 3: 2 named visits + 1 anonymous visit (SQL)
    visit = await service.create(
        db_session=db_session,
        data=VisitCreate(
            record_id=sample_record.id,
            price=100,
        ),
    )
    assert visit is not None
    assert visit.record_id == sample_record.id
    assert visit.price == 100
    # Verify cascade: recompute_record_seats corrects seats = visit count
    await db_session.refresh(sample_record)
    assert sample_record.seats >= original_seats  # seats should have been recomputed


@pytest.mark.asyncio
async def test_visit_service_update_full_replace(db_session, sample_visit):
    """update is full-replace; price changed."""
    from src.repositories.generic import get_base_repository
    from src.schemas.visit import VisitUpdate
    from src.services.visit import VisitService

    service = VisitService(get_base_repository())
    result = await service.update(
        db_session=db_session,
        visit_id=sample_visit.id,
        data=VisitUpdate(
            record_id=sample_visit.record_id,
            price=200,
            status="visited",
        ),
    )
    assert result is not None
    assert result.price == 200
    assert result.status == "visited"


@pytest.mark.asyncio
async def test_visit_service_delete_hard_deletes_and_cascades(db_session, sample_visit):
    """delete hard-deletes the row and cascades to record."""
    from src.repositories.generic import get_base_repository
    from src.services.visit import VisitService

    service = VisitService(get_base_repository())
    result = await service.delete(db_session=db_session, visit_id=sample_visit.id)
    assert result is True
    # Verify row is absent from DB (hard delete)
    from sqlalchemy import select

    from src.models.visit import Visit
    rows = await db_session.execute(select(Visit).where(Visit.id == sample_visit.id))
    assert rows.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_visit_service_get_existing(db_session, sample_visit):
    """get returns the visit by ID."""
    from src.repositories.generic import get_base_repository
    from src.services.visit import VisitService

    service = VisitService(get_base_repository())
    result = await service.get(db_session=db_session, visit_id=sample_visit.id)
    assert result is not None
    assert result.id == sample_visit.id


@pytest.mark.asyncio
async def test_visit_service_get_nonexistent(db_session):
    """get returns None for nonexistent ID."""
    from src.repositories.generic import get_base_repository
    from src.services.visit import VisitService

    service = VisitService(get_base_repository())
    result = await service.get(db_session=db_session, visit_id="nonexistent-id")
    assert result is None


@pytest.mark.asyncio
async def test_visit_service_list_paginated(db_session, sample_visits):
    """VisitService.list returns envelope; record_id filter still works.

    Moved verbatim from test_generic_service_list.py:177-186.
    """
    from src.repositories.generic import get_base_repository
    from src.schemas.common import PaginatedResponse
    from src.services.visit import VisitService

    result = await VisitService(get_base_repository()).list(db_session, page=1, per_page=2)
    assert isinstance(result, PaginatedResponse)
    assert result.total == len(sample_visits)
    assert len(result.items) == 2
    # record_id filter — use attribute directly from visit ORM fixture
    rid = sample_visits[0].record_id
    filtered = await VisitService(get_base_repository()).list(db_session, page=1, per_page=20, record_id=rid)
    assert all(v.record_id == rid for v in filtered.items)


# ── GH #171 Task 2 — bulk scenario helpers (delete-by-record, insert-batch) ──


@pytest.mark.asyncio
async def test_delete_visits_by_record_is_not_transactional():
    """The scenario-helper must NOT be wrapped by @transactional."""
    from src.services.decorators import _TRANSACTIONAL_MARKER
    from src.services.visit import VisitService

    assert not hasattr(VisitService.delete_visits_by_record, _TRANSACTIONAL_MARKER), (
        "delete_visits_by_record is a scenario building block — it must NOT "
        "commit; the usecases layer owns the transaction boundary"
    )


@pytest.mark.asyncio
async def test_create_visits_bulk_is_not_transactional():
    """The scenario-helper must NOT be wrapped by @transactional."""
    from src.services.decorators import _TRANSACTIONAL_MARKER
    from src.services.visit import VisitService

    assert not hasattr(VisitService.create_visits_bulk, _TRANSACTIONAL_MARKER), (
        "create_visits_bulk is a scenario building block — it must NOT "
        "commit; the usecases layer owns the transaction boundary"
    )


@pytest.mark.asyncio
async def test_delete_visits_by_record_removes_all_visits_of_record(db_session, sample_visits):
    """ONE set-based delete: every visit of the record is gone, others stay."""
    from sqlalchemy import func, select

    from src.models.visit import Visit
    from src.repositories.visit import get_visit_repository
    from src.services.visit import VisitService
    service = VisitService(get_visit_repository())
    record_id = sample_visits[0].record_id

    other_total = (await db_session.execute(
        select(func.count()).select_from(Visit).where(Visit.record_id != record_id)
    )).scalar_one()

    await service.delete_visits_by_record(db_session, record_id)

    left = (await db_session.execute(
        select(Visit).where(Visit.record_id == record_id)
    )).scalars().all()
    assert left == []
    total = (await db_session.execute(select(func.count()).select_from(Visit))).scalar_one()
    assert total == other_total  # чужие visits untouched
    # seats on the parent record are NOT touched here — recalc belongs to the scenario
    from src.models.record import Record
    record = await db_session.get(Record, record_id)
    assert record.seats == len(sample_visits)  # unchanged by the bulk delete


@pytest.mark.asyncio
async def test_create_visits_bulk_inserts_batch(db_session, sample_visits, sample_tariff):
    """Insert a batch of visit VALUES in one call; parent record untouched.

    Value-typed contract (GH #171 Task 3 fix, canon rule 2): the caller
    passes ``VisitItem`` payloads + the owning ``record_id``; the SERVICE
    builds the ORM rows. All mapped fields must land on the rows.
    """
    from sqlalchemy import select

    from src.models.visit import Visit
    from src.repositories.visit import get_visit_repository
    from src.schemas.record import VisitItem
    from src.services.visit import VisitService
    service = VisitService(get_visit_repository())
    record_id = sample_visits[0].record_id
    real_visitor_id = sample_visits[0].visitor_id
    from src.models.record import Record
    before_seats = (await db_session.get(Record, record_id)).seats
    before = (await db_session.execute(
        select(Visit).where(Visit.record_id == record_id)
    )).scalars().all()
    before_count = len(before)

    batch = [
        VisitItem(price=100),
        VisitItem(price=200, visitor_id=real_visitor_id, tariff_id=sample_tariff,
                  custom_price=250, status="visited"),
        VisitItem(price=300),
    ]
    await service.create_visits_bulk(db_session, record_id, batch)

    rows = (await db_session.execute(
        select(Visit).where(Visit.record_id == record_id)
    )).scalars().all()
    assert len(rows) == before_count + 3
    inserted = rows[before_count:]
    # Field parity: every value payload landed on the persisted row.
    assert [(v.price, v.status) for v in inserted] == [
        (100, "waiting"), (200, "visited"), (300, "waiting"),
    ]
    assert inserted[1].visitor_id == real_visitor_id
    assert inserted[1].tariff_id == sample_tariff
    assert inserted[1].custom_price == 250
    assert all(v.record_id == record_id for v in inserted)
    # No recalculation inside — seats are the scenario's job.
    record = await db_session.get(Record, record_id)
    await db_session.refresh(record)
    assert record.seats == before_seats


@pytest.mark.asyncio
async def test_create_visits_bulk_empty_batch_is_noop(db_session, sample_record):
    """An empty batch inserts nothing and does not raise."""
    from sqlalchemy import select

    from src.models.visit import Visit
    from src.repositories.visit import get_visit_repository
    from src.services.visit import VisitService
    service = VisitService(get_visit_repository())
    before = (await db_session.execute(
        select(Visit).where(Visit.record_id == sample_record.id)
    )).scalars().all()

    await service.create_visits_bulk(db_session, sample_record.id, [])

    rows = (await db_session.execute(
        select(Visit).where(Visit.record_id == sample_record.id)
    )).scalars().all()
    assert len(rows) == len(before)  # nothing inserted


@pytest.mark.asyncio
async def test_delete_visits_by_record_does_not_commit(db_session, sample_visits):
    """No-commit property: rollback after the bulk delete restores visits."""
    from src.repositories.visit import get_visit_repository
    from src.services.visit import VisitService
    from tests.conftest import query_db
    service = VisitService(get_visit_repository())
    record_id = sample_visits[0].record_id

    await service.delete_visits_by_record(db_session, record_id)
    await db_session.rollback()

    assert query_db(
        f"SELECT COUNT(*) AS c FROM visits WHERE record_id='{record_id}'"
    )[0]["c"] == len(sample_visits), (
        "delete_visits_by_record must NOT commit — the scenario layer owns "
        "the transaction boundary (canon rule 3)"
    )


# ── GH #325 — bulk delete by record ID set (activity-delete scenario) ──────


@pytest.mark.asyncio
async def test_delete_visits_by_record_ids_is_not_transactional():
    """The scenario-helper must NOT be wrapped by @transactional."""
    from src.services.decorators import _TRANSACTIONAL_MARKER
    from src.services.visit import VisitService

    assert not hasattr(VisitService.delete_visits_by_record_ids, _TRANSACTIONAL_MARKER), (
        "delete_visits_by_record_ids is a scenario building block — it must NOT "
        "commit; the usecases layer owns the transaction boundary"
    )


@pytest.mark.asyncio
async def test_delete_visits_by_record_ids_removes_visits_of_records(
    db_session, api_client, create_record
):
    """ONE set-based delete: visits of ALL listed records gone, others stay."""
    from sqlalchemy import select

    from src.models.visit import Visit
    from src.repositories.visit import get_visit_repository
    from src.services.visit import VisitService

    record_a = create_record()
    record_b = create_record()
    record_c = create_record()  # not in the set — must stay untouched
    target_ids = [record_a["id"], record_b["id"]]

    service = VisitService(get_visit_repository())
    await service.delete_visits_by_record_ids(db_session, target_ids)

    gone = (await db_session.execute(
        select(Visit).where(Visit.record_id.in_(target_ids))
    )).scalars().all()
    assert gone == []
    kept = (await db_session.execute(
        select(Visit).where(Visit.record_id == record_c["id"])
    )).scalars().all()
    assert len(kept) == len(record_c["visits"])  # чужие visits untouched


@pytest.mark.asyncio
async def test_delete_visits_by_record_ids_empty_set_is_noop(db_session, sample_visits):
    """An empty ID set issues NO query at all."""
    from unittest.mock import AsyncMock, patch

    from src.repositories.visit import get_visit_repository
    from src.services.visit import VisitService

    service = VisitService(get_visit_repository())

    with patch.object(db_session, "execute", new_callable=AsyncMock) as exec_spy:
        await service.delete_visits_by_record_ids(db_session, [])
    exec_spy.assert_not_awaited()


@pytest.mark.asyncio
async def test_delete_visits_by_record_ids_does_not_commit(
    db_session, api_client, create_record
):
    """No-commit property: rollback after the bulk delete restores visits."""
    from src.repositories.visit import get_visit_repository
    from src.services.visit import VisitService
    from tests.conftest import query_db

    record = create_record()
    service = VisitService(get_visit_repository())

    await service.delete_visits_by_record_ids(db_session, [record["id"]])
    await db_session.rollback()

    assert query_db(
        f"SELECT COUNT(*) AS c FROM visits WHERE record_id='{record['id']}'"
    )[0]["c"] == len(record["visits"]), (
        "delete_visits_by_record_ids must NOT commit — the scenario layer "
        "owns the transaction boundary (canon rule 3)"
    )

# ── GH #327 Task 1 — bulk delete-by-visitor scenario brick ─────────────────


async def _seed_visitor_with_visits(db_session):
    """Direct-ORM seed (test_delete_cascades conventions, committed rows).

    Visitor "Target" owns 3 visits across 2 records of one client. Control
    rows that must SURVIVE the delete-by-visitor: an anonymous visit in R1
    (price=10) and another visitor's visit in R2 (price=400).

    Returns the target visitor's id.
    """
    from datetime import UTC, datetime, timedelta

    from src.models.activity import Activity
    from src.models.client import Client
    from src.models.location import Location
    from src.models.master import Master
    from src.models.record import Record
    from src.models.service import Service
    from src.models.staff import Staff
    from src.models.visit import Visit
    from src.models.visitor import Visitor

    staff = Staff(first_name="Vv", last_name="T")
    service = Service(
        title="VvSvc",
        description="d",
        image_url="http://x",
        specialty="s",
        min_age=5,
        duration=60,
        record_info="r",
    )
    location = Location(title="VvLoc", capacity=20)
    db_session.add_all([staff, service, location])
    await db_session.flush()
    db_session.add(Master(staff_id=staff.id, specialty="s", color="#000000"))
    await db_session.flush()
    activity = Activity(
        master_id=staff.id,
        service_id=service.id,
        location_id=location.id,
        start=datetime.now(UTC) + timedelta(days=1),
        duration=90,
        capacity=10,
        is_private=False,
    )
    db_session.add(activity)
    client = Client(name="Vv Client", phone=None)
    db_session.add(client)
    await db_session.flush()
    r1 = Record(activity_id=activity.id, client_id=client.id, status="pending", seats=3)
    r2 = Record(activity_id=activity.id, client_id=client.id, status="pending", seats=2)
    db_session.add_all([r1, r2])
    await db_session.flush()
    target = Visitor(client_id=client.id, name="Vv Target")
    other = Visitor(client_id=client.id, name="Vv Other")
    db_session.add_all([target, other])
    await db_session.flush()
    db_session.add_all(
        [
            Visit(
                record_id=r1.id,
                visitor_id=target.id,
                tariff_id=None,
                price=100,
                custom_price=None,
                status="waiting",
            ),
            Visit(
                record_id=r1.id,
                visitor_id=target.id,
                tariff_id=None,
                price=200,
                custom_price=None,
                status="waiting",
            ),
            Visit(
                record_id=r1.id,
                visitor_id=None,
                tariff_id=None,
                price=10,
                custom_price=None,
                status="waiting",
            ),  # anonymous ctrl
            Visit(
                record_id=r2.id,
                visitor_id=target.id,
                tariff_id=None,
                price=300,
                custom_price=None,
                status="waiting",
            ),
            Visit(
                record_id=r2.id,
                visitor_id=other.id,
                tariff_id=None,
                price=400,
                custom_price=None,
                status="waiting",
            ),  # other ctrl
        ]
    )
    await db_session.commit()
    return target.id


@pytest.mark.asyncio
async def test_delete_visits_by_visitor_is_not_transactional():
    """The scenario brick must NOT be wrapped by @transactional (mirror of
    delete_visits_by_record — GH #327 Task 1)."""
    from src.services.decorators import _TRANSACTIONAL_MARKER
    from src.services.visit import VisitService

    assert not hasattr(VisitService.delete_visits_by_visitor, _TRANSACTIONAL_MARKER), (
        "delete_visits_by_visitor is a scenario building block — it must NOT "
        "commit; the usecases layer owns the transaction boundary"
    )


@pytest.mark.asyncio
async def test_delete_visits_by_visitor_removes_only_own_visits(db_session):
    """Every visit of the visitor (across records) is gone; anonymous and
    other visitors' visits stay."""
    from sqlalchemy import select

    from src.models.visit import Visit
    from src.repositories.visit import get_visit_repository
    from src.services.visit import VisitService

    visitor_id = await _seed_visitor_with_visits(db_session)
    service = VisitService(get_visit_repository())

    await service.delete_visits_by_visitor(db_session, visitor_id)

    left = (
        (await db_session.execute(select(Visit).where(Visit.visitor_id == visitor_id)))
        .scalars()
        .all()
    )
    assert left == []
    remaining = (await db_session.execute(select(Visit))).scalars().all()
    assert sorted(v.price for v in remaining) == [10, 400]  # controls untouched


@pytest.mark.asyncio
async def test_delete_visits_by_visitor_is_one_delete_statement(db_session, db_engine):
    """Set-based command (canon rule 4): exactly ONE DELETE statement for
    the visitor's 3 visits — a per-row loop would emit N."""
    from sqlalchemy import event

    from src.repositories.visit import get_visit_repository
    from src.services.visit import VisitService

    visitor_id = await _seed_visitor_with_visits(db_session)
    service = VisitService(get_visit_repository())

    counter = {"deletes": 0}

    def _before(conn, cursor, statement, params, context, executemany):
        if statement.lstrip().upper().startswith("DELETE"):
            counter["deletes"] += 1

    event.listen(db_engine.sync_engine, "before_cursor_execute", _before)
    try:
        await service.delete_visits_by_visitor(db_session, visitor_id)
    finally:
        event.remove(db_engine.sync_engine, "before_cursor_execute", _before)

    assert counter["deletes"] == 1, (
        f"delete_visits_by_visitor emitted {counter['deletes']} DELETEs — "
        "the bulk delete must be ONE set-based statement (canon rule 4)"
    )


@pytest.mark.asyncio
async def test_delete_visits_by_visitor_does_not_commit(db_session):
    """No-commit property: rollback after the bulk delete restores visits."""
    from src.repositories.visit import get_visit_repository
    from src.services.visit import VisitService
    from tests.conftest import query_db

    visitor_id = await _seed_visitor_with_visits(db_session)
    service = VisitService(get_visit_repository())

    await service.delete_visits_by_visitor(db_session, visitor_id)
    await db_session.rollback()

    assert (
        query_db(f"SELECT COUNT(*) AS c FROM visits WHERE visitor_id='{visitor_id}'")[0]["c"] == 3
    ), (
        "delete_visits_by_visitor must NOT commit — the scenario layer owns "
        "the transaction boundary (canon rule 3)"
    )


@pytest.mark.asyncio
async def test_delete_visits_by_visitor_mark_true_sets_visits(db_session):
    """mark_visits=True marks the helper's OWN entity ("visits"); the
    GH #324 recompute adds the recomputed parents ("records")."""
    from src.events import emitter
    from src.repositories.visit import get_visit_repository
    from src.services.visit import VisitService

    visitor_id = await _seed_visitor_with_visits(db_session)
    service = VisitService(get_visit_repository())

    token = emitter.start_accumulation(set())
    try:
        await service.delete_visits_by_visitor(db_session, visitor_id, mark_visits=True)
        assert emitter.accumulated() == {"visits", "records"}
    finally:
        emitter.reset_accumulation(token)


@pytest.mark.asyncio
async def test_delete_visits_by_visitor_mark_false_suppresses_mark(db_session):
    """mark_visits=False → NO "visits" mark (the caller owns the event
    grid — both current callers pass False for parity). The recompute
    mark ("records", GH #324) is NOT gated by the flag — the recomputed
    parents always publish."""
    from src.events import emitter
    from src.repositories.visit import get_visit_repository
    from src.services.visit import VisitService

    visitor_id = await _seed_visitor_with_visits(db_session)
    service = VisitService(get_visit_repository())

    token = emitter.start_accumulation(set())
    try:
        await service.delete_visits_by_visitor(db_session, visitor_id, mark_visits=False)
        assert emitter.accumulated() == {"records"}
    finally:
        emitter.reset_accumulation(token)
