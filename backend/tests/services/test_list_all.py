"""Service-level tests for GenericService.list_all (#205).

Covers the shared unpaginated list path:
- plain GenericService (Tag) — no status filter;
- ArchiveService (Master) — status parity with list();
- order_by application;
- BARE_LIST_MAX_ROWS protective limit (1001 -> raise, 1000 -> OK);
- ServiceService override eager-loads tariffs+tags (no MissingGreenlet).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import asc, insert

from src.domain.errors import BareListLimitExceededError
from src.models.enums import ArchiveStatus
from src.models.master import Master
from src.models.tag import Tag
from src.services.generic import BARE_LIST_MAX_ROWS
from src.services.master import get_master_service
from src.services.service import get_service_service
from src.services.tag import get_tag_service

pytestmark = pytest.mark.asyncio


# 1. returns full list, no envelope
async def test_list_all_returns_all_rows(db_session, create_master):
    created = create_master()
    result = await get_master_service().list_all(db_session)
    assert isinstance(result, list)
    assert [m.id for m in result] == [created["id"]]


# 2. ArchiveService status filter parity
async def test_list_all_status_filter(db_session, create_master):
    m = create_master()
    svc = get_master_service()
    await svc.archive(db_session, m["id"])  # ArchiveService.archive — generic.py:227
    assert await svc.list_all(db_session) == []
    assert len(await svc.list_all(db_session, status=ArchiveStatus.ALL)) == 1
    assert len(await svc.list_all(db_session, status=ArchiveStatus.ARCHIVED)) == 1


# 3. order_by applied
async def test_list_all_order_by(db_session, create_master):
    b = create_master(first_name="Boris")
    a = create_master(first_name="Anna")
    result = await get_master_service().list_all(
        db_session, order_by=[asc(Master.first_name)]
    )
    ids = [m.id for m in result]
    assert ids.index(a["id"]) < ids.index(b["id"])


# 4. limit: 1001 rows -> raise; message names table + limit
async def test_list_all_limit_raises(db_session):
    now = datetime.now(UTC)
    rows = [
        {
            "id": uuid.uuid4().hex,
            "tag": f"bulk-{i:05d}",
            "created_at": now,
            "updated_at": now,
        }
        for i in range(BARE_LIST_MAX_ROWS + 1)
    ]
    await db_session.execute(insert(Tag), rows)
    await db_session.commit()
    with pytest.raises(BareListLimitExceededError, match="tags.*1000"):
        await get_tag_service().list_all(db_session)


# 5. boundary: exactly 1000 -> OK
async def test_list_all_boundary_ok(db_session):
    now = datetime.now(UTC)
    rows = [
        {
            "id": uuid.uuid4().hex,
            "tag": f"bulk-{i:05d}",
            "created_at": now,
            "updated_at": now,
        }
        for i in range(BARE_LIST_MAX_ROWS)
    ]
    await db_session.execute(insert(Tag), rows)
    await db_session.commit()
    assert len(await get_tag_service().list_all(db_session)) == BARE_LIST_MAX_ROWS


# 6. ServiceService: eager loads tariffs+tags (no MissingGreenlet)
async def test_service_list_all_eager_loads(db_session, create_service):
    # Factory creates a service with empty tariffs/tags lists; the point of
    # this test is that accessing the relationships under async SQLAlchemy
    # does not raise MissingGreenlet — which requires selectinload eager
    # loading in ServiceService.list_all (spec §4.1).
    create_service()
    result = await get_service_service().list_all(db_session)
    assert isinstance(result, list)
    assert len(result) == 1
    assert result[0].tariffs is not None
    assert result[0].tags is not None
