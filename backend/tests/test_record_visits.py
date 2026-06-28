"""Unit tests for src/domain/record_visits.py free functions."""
import pytest


@pytest.mark.asyncio
async def test_recompute_record_seats_counts_active_visits(db_session, sample_record):
    """Scenario 16: recompute_record_seats sets seats = count(active visits) + anonym_visits."""
    from src.domain.record_visits import recompute_record_seats

    record = await recompute_record_seats(db_session, sample_record.id)
    assert record.seats == len([v for v in sample_record.visits if v.is_active]) + sample_record.anonym_visits


@pytest.mark.asyncio
async def test_recompute_record_status_derives_from_visits(db_session, sample_record_with_visits):
    """recompute_record_status derives status from active visits."""
    from src.domain.record_visits import recompute_record_status

    record = await recompute_record_status(db_session, sample_record_with_visits.id)
    from src.domain.visit_status import compute_record_status, VisitItem
    expected = compute_record_status([
        VisitItem(id=v.id, status=v.status)
        for v in sample_record_with_visits.visits if v.is_active
    ]).value
    assert record.status == expected


@pytest.mark.asyncio
async def test_check_activity_capacity_passes_when_room(db_session, sample_activity_with_capacity):
    """check_activity_capacity does not raise when capacity available."""
    from src.domain.record_visits import check_activity_capacity

    # Should not raise
    await check_activity_capacity(db_session, sample_activity_with_capacity.id, seats=1)


@pytest.mark.asyncio
async def test_check_activity_capacity_raises_409_when_full(db_session, sample_activity_at_capacity):
    """Scenario 19: check_activity_capacity raises 409 ACTIVITY_AT_CAPACITY when full."""
    from fastapi import HTTPException
    from src.domain.record_visits import check_activity_capacity

    with pytest.raises(HTTPException) as exc_info:
        await check_activity_capacity(db_session, sample_activity_at_capacity.id, seats=1)
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "ACTIVITY_AT_CAPACITY"
