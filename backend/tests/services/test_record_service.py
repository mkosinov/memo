"""Per-entity RecordService tests (contract exception — own list semantics with client filter)."""

from __future__ import annotations

import pytest

from src.schemas.common import PaginatedResponse
from src.schemas.record import RecordListParams
from src.services.record import get_record_service

pytestmark = pytest.mark.asyncio


# ─── RecordService.list pagination (moved from test_generic_service_list.py:159-172) ─

async def test_record_service_list_paginated_with_client_filter(db_session, sample_visits):
    """RecordService.list paginates and filters by client_id."""
    from src.models.record import Record
    # Get the record to access client_id (sample_visits are Visit ORM objects)
    record_id = sample_visits[0].record_id
    record = await db_session.get(Record, record_id)
    client_id = record.client_id

    service = get_record_service()
    result = await service.list(
        db_session=db_session,
        params=RecordListParams(client_id=client_id, per_page=20),
    )
    assert isinstance(result, PaginatedResponse)
    assert result.total >= 1
    result_other = await service.list(
        db_session=db_session,
        params=RecordListParams(client_id="nonexistent", per_page=20),
    )
    assert result_other.total == 0