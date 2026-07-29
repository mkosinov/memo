"""Contract tests for GenericService.list() pagination (#182)."""

from __future__ import annotations

import pytest

from src.models.master import Master
from src.models.service import Service
from src.models.tag import Tag
from src.schemas.common import PaginatedResponse
from src.services.master import MasterService, get_master_service
from src.services.record import get_record_service
from src.services.service import ServiceService, get_service_service
from src.services.tag import TagService, get_tag_service
from src.services.visit import VisitService

pytestmark = pytest.mark.asyncio


# ─── Helpers ────────────────────────────────────────────────────────────────────

async def _create_masters(db_session, n: int) -> None:
    for i in range(n):
        db_session.add(Master(
            first_name=f"M{i}", last_name="T", color="#000000",
            position="p", specialty="s",
        ))
    await db_session.flush()


async def _create_tags(db_session, n: int) -> None:
    for i in range(n):
        db_session.add(Tag(tag=f"tag-{i}"))
    await db_session.flush()


# ─── Contract tests (MasterService) ─────────────────────────────────────────────

async def test_list_returns_paginated_envelope(db_session):
    """list() returns PaginatedResponse with items/total/page/per_page."""
    await _create_masters(db_session, 3)
    service = get_master_service()
    result = await service.list(db_session, page=1, per_page=20)
    assert result.total == 3
    assert result.page == 1
    assert result.per_page == 20
    assert len(result.items) == 3


async def test_list_total_independent_of_per_page(db_session):
    """total reflects ALL matching rows, items only the requested page."""
    await _create_masters(db_session, 5)
    service = get_master_service()
    page1 = await service.list(db_session, page=1, per_page=2)
    page2 = await service.list(db_session, page=2, per_page=2)
    page3 = await service.list(db_session, page=3, per_page=2)
    assert page1.total == 5 and len(page1.items) == 2
    assert page2.total == 5 and len(page2.items) == 2
    assert page3.total == 5 and len(page3.items) == 1
    ids_p1 = {m.id for m in page1.items}
    ids_p2 = {m.id for m in page2.items}
    assert ids_p1.isdisjoint(ids_p2)


async def test_list_out_of_range_page_returns_empty_items(db_session):
    """Page beyond the end -> empty items, correct total."""
    await _create_masters(db_session, 2)
    service = get_master_service()
    result = await service.list(db_session, page=5, per_page=20)
    assert result.total == 2
    assert result.items == []


async def test_list_excludes_inactive(db_session):
    """Soft-deleted (is_active=False) rows are excluded from items AND total."""
    await _create_masters(db_session, 2)
    inactive = Master(
        first_name="X", last_name="Y", color="#111111",
        position="p", specialty="s", is_active=False,
    )
    db_session.add(inactive)
    await db_session.flush()
    service = get_master_service()
    result = await service.list(db_session, page=1, per_page=20)
    assert result.total == 2
    assert all(m.is_active for m in result.items)


async def test_list_filters_apply_to_total(db_session):
    """Filters narrow both items and total."""
    await _create_masters(db_session, 2)
    service = get_master_service()
    result = await service.list(db_session, page=1, per_page=20, first_name="M0")
    assert result.total == 1
    assert result.items[0].first_name == "M0"


# ─── Contract tests (TagService — second service parameterization) ──────────────

async def test_list_returns_paginated_envelope_tag(db_session):
    """list() returns PaginatedResponse for TagService too."""
    await _create_tags(db_session, 4)
    service = get_tag_service()
    result = await service.list(db_session, page=1, per_page=3)
    assert result.total == 4
    assert result.page == 1
    assert result.per_page == 3
    assert len(result.items) == 3


async def test_list_excludes_inactive_tag(db_session):
    """Soft-deleted tags excluded from items AND total."""
    await _create_tags(db_session, 2)
    inactive = Tag(tag="inactive-tag", is_active=False)
    db_session.add(inactive)
    await db_session.flush()
    service = get_tag_service()
    result = await service.list(db_session, page=1, per_page=20)
    # total=2 proves the inactive row is excluded from the count
    assert result.total == 2
    assert len(result.items) == 2
    # The inactive tag's id must not appear in items
    tag_values = {t.tag for t in result.items}
    assert "inactive-tag" not in tag_values


# ─── ServiceService.list pagination (2a) ────────────────────────────────────────

async def test_service_service_list_paginated(db_session):
    """ServiceService.list returns envelope with eager-loaded tariffs/tags."""
    for i in range(3):
        db_session.add(Service(
            title=f"S{i}", description="d", image_url="http://x",
            specialty="s", min_age=5, duration=60, record_info="r",
        ))
    await db_session.flush()
    service = get_service_service()
    result = await service.list(db_session, page=1, per_page=2)
    assert isinstance(result, PaginatedResponse)
    assert result.total == 3
    assert len(result.items) == 2
    assert hasattr(result.items[0], "tariffs")
    assert hasattr(result.items[0], "tags")


# ─── RecordService.list pagination (2b) ─────────────────────────────────────────

async def test_record_service_list_paginated_with_client_filter(db_session, sample_visits):
    """RecordService.list paginates and filters by client_id."""
    from src.models.record import Record
    # Get the record to access client_id (sample_visits are Visit ORM objects)
    record_id = sample_visits[0].record_id
    record = await db_session.get(Record, record_id)
    client_id = record.client_id
    
    service = get_record_service()
    result = await service.list(db_session, page=1, per_page=20, client_id=client_id)
    assert isinstance(result, PaginatedResponse)
    assert result.total >= 1
    result_other = await service.list(db_session, page=1, per_page=20, client_id="nonexistent")
    assert result_other.total == 0


# ─── VisitService.list pagination (2d) ──────────────────────────────────────────

async def test_visit_service_list_paginated(db_session, sample_visits):
    """VisitService.list returns envelope; record_id filter still works."""
    result = await VisitService().list(db_session, page=1, per_page=2)
    assert isinstance(result, PaginatedResponse)
    assert result.total == len(sample_visits)
    assert len(result.items) == 2
    # record_id filter — use attribute directly from visit ORM fixture
    rid = sample_visits[0].record_id
    filtered = await VisitService().list(db_session, page=1, per_page=20, record_id=rid)
    assert all(v.record_id == rid for v in filtered.items)
