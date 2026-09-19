"""Unit tests for VisitService CRUD methods (TDD — RED phase).

These tests exercise the service layer directly against a real async DB
session (via db_session fixture). No HTTP, no mocks.
"""

import pytest


@pytest.mark.asyncio
async def test_visit_service_list(db_session, sample_visits):
    """list returns all active visits in a PaginatedResponse envelope."""
    from src.services.visit import VisitService
    from src.repositories.generic import get_base_repository

    service = VisitService(get_base_repository())
    result = await service.list(db_session=db_session)
    assert result.total == len(sample_visits)
    assert len(result.items) == len(sample_visits)


@pytest.mark.asyncio
async def test_visit_service_list_filter_by_record(db_session, sample_visits):
    """list with record_id filter returns only matching visits."""
    from src.services.visit import VisitService
    from src.repositories.generic import get_base_repository

    service = VisitService(get_base_repository())
    record_id = sample_visits[0].record_id
    result = await service.list(db_session=db_session, record_id=record_id)
    assert all(v.record_id == record_id for v in result.items)
    assert result.total == len(sample_visits)


@pytest.mark.asyncio
async def test_visit_service_create_cascades_to_record(db_session, sample_record):
    """create cascades to record.seats and record.status."""
    from src.services.visit import VisitService
    from src.repositories.generic import get_base_repository
    from src.schemas.visit import VisitCreate

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
    from src.services.visit import VisitService
    from src.repositories.generic import get_base_repository
    from src.schemas.visit import VisitUpdate

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
    from src.services.visit import VisitService
    from src.repositories.generic import get_base_repository

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
    from src.services.visit import VisitService
    from src.repositories.generic import get_base_repository

    service = VisitService(get_base_repository())
    result = await service.get(db_session=db_session, visit_id=sample_visit.id)
    assert result is not None
    assert result.id == sample_visit.id


@pytest.mark.asyncio
async def test_visit_service_get_nonexistent(db_session):
    """get returns None for nonexistent ID."""
    from src.services.visit import VisitService
    from src.repositories.generic import get_base_repository

    service = VisitService(get_base_repository())
    result = await service.get(db_session=db_session, visit_id="nonexistent-id")
    assert result is None


@pytest.mark.asyncio
async def test_visit_service_list_paginated(db_session, sample_visits):
    """VisitService.list returns envelope; record_id filter still works.

    Moved verbatim from test_generic_service_list.py:177-186.
    """
    from src.schemas.common import PaginatedResponse
    from src.services.visit import VisitService
    from src.repositories.generic import get_base_repository

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
    from sqlalchemy import select, func
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
async def test_create_visits_bulk_inserts_batch(db_session, sample_record):
    """Insert a batch of visits in one call; parent record untouched (no recalc)."""
    from sqlalchemy import select
    from src.models.visit import Visit

    from src.repositories.visit import get_visit_repository
    from src.services.visit import VisitService
    service = VisitService(get_visit_repository())
    before_seats = sample_record.seats
    before = (await db_session.execute(
        select(Visit).where(Visit.record_id == sample_record.id)
    )).scalars().all()
    before_count = len(before)

    batch = [
        Visit(record_id=sample_record.id, price=100, status="waiting"),
        Visit(record_id=sample_record.id, price=200, status="waiting"),
        Visit(record_id=sample_record.id, price=300, status="waiting"),
    ]
    await service.create_visits_bulk(db_session, batch)

    for v in batch:
        assert v.id is not None  # flushed — ids assigned
    rows = (await db_session.execute(
        select(Visit).where(Visit.record_id == sample_record.id)
    )).scalars().all()
    assert len(rows) == before_count + 3
    # No recalculation inside — seats are the scenario's job.
    await db_session.refresh(sample_record)
    assert sample_record.seats == before_seats


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

    await service.create_visits_bulk(db_session, [])

    rows = (await db_session.execute(
        select(Visit).where(Visit.record_id == sample_record.id)
    )).scalars().all()
    assert len(rows) == len(before)  # nothing inserted


@pytest.mark.asyncio
async def test_delete_visits_by_record_does_not_commit(db_session, sample_visits):
    """No-commit property: rollback after the bulk delete restores visits."""
    from tests.conftest import query_db

    from src.repositories.visit import get_visit_repository
    from src.services.visit import VisitService
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
