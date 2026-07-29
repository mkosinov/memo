"""Unit tests for VisitService CRUD methods (TDD — RED phase).

These tests exercise the service layer directly against a real async DB
session (via db_session fixture). No HTTP, no mocks.
"""

import pytest


@pytest.mark.asyncio
async def test_visit_service_list(db_session, sample_visits):
    """list returns all active visits in a PaginatedResponse envelope."""
    from src.services.visit import VisitService

    service = VisitService()
    result = await service.list(db_session=db_session)
    assert result.total == len(sample_visits)
    assert len(result.items) == len(sample_visits)


@pytest.mark.asyncio
async def test_visit_service_list_filter_by_record(db_session, sample_visits):
    """list with record_id filter returns only matching visits."""
    from src.services.visit import VisitService

    service = VisitService()
    record_id = sample_visits[0].record_id
    result = await service.list(db_session=db_session, record_id=record_id)
    assert all(v.record_id == record_id for v in result.items)
    assert result.total == len(sample_visits)


@pytest.mark.asyncio
async def test_visit_service_create_cascades_to_record(db_session, sample_record):
    """create cascades to record.seats and record.status."""
    from src.services.visit import VisitService
    from src.schemas.visit import VisitCreate

    service = VisitService()
    original_seats = sample_record.seats  # API set seats=2, anonym_visits=1 set via SQL
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
    # Verify cascade: recompute_record_seats corrects seats = active_count + anonym_visits
    await db_session.refresh(sample_record)
    assert sample_record.seats >= original_seats  # seats should have been recomputed


@pytest.mark.asyncio
async def test_visit_service_update_full_replace(db_session, sample_visit):
    """update is full-replace; price changed."""
    from src.services.visit import VisitService
    from src.schemas.visit import VisitUpdate

    service = VisitService()
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
async def test_visit_service_patch_partial(db_session, sample_visit):
    """patch only updates sent fields, others unchanged."""
    from src.services.visit import VisitService
    from src.schemas.visit import VisitPatch

    service = VisitService()
    original_price = sample_visit.price
    result = await service.patch(
        db_session=db_session,
        visit_id=sample_visit.id,
        data=VisitPatch(status="visited"),
    )
    assert result is not None
    assert result.status == "visited"
    # Price unchanged (not in patch)
    assert result.price == original_price


@pytest.mark.asyncio
async def test_visit_service_delete_hard_deletes_and_cascades(db_session, sample_visit):
    """delete hard-deletes the row and cascades to record."""
    from src.services.visit import VisitService

    service = VisitService()
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

    service = VisitService()
    result = await service.get(db_session=db_session, visit_id=sample_visit.id)
    assert result is not None
    assert result.id == sample_visit.id


@pytest.mark.asyncio
async def test_visit_service_get_nonexistent(db_session):
    """get returns None for nonexistent ID."""
    from src.services.visit import VisitService

    service = VisitService()
    result = await service.get(db_session=db_session, visit_id="nonexistent-id")
    assert result is None
