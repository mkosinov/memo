"""Per-entity RecordService tests (contract exception — own list semantics with client filter).

GH #171 Task 6: the record-delete cascade tests (formerly here via
``RecordService.delete`` — moved to the ``usecases.records.delete_record``
scenario in Task 5) are rebound to the SCENARIO entry point; the service
keeps reads and record-row operations only.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from src.models.activity import Activity
from src.models.client import Client
from src.models.payment import Payment
from src.models.record import Record
from src.models.tag import Tag, record_tags
from src.models.visit import Visit
from src.schemas.common import PaginatedResponse
from src.schemas.record import RecordListParams
from src.services.decorators import _TRANSACTIONAL_MARKER
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


# ─── Record delete cascade, rebound to the ``delete_record`` scenario (Task 6) ───
# Formerly tests of ``RecordService.delete`` (moved to ``usecases.records.delete_record``
# in Task 5); same DB-state assertions, driven through the scenario entry point.
# Setup is direct ORM inserts (the pattern of the former test_delete_cascades.py).

async def _insert_record_cascade(db_session, activity: Activity, client: Client,
                                 *, num_visits: int = 1, num_payments: int = 0) -> Record:
    """Insert a Record with N visits and M payments (committed)."""
    record = Record(
        activity_id=activity.id, client_id=client.id, status="pending",
        seats=num_visits,
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


async def test_delete_record_scenario_removes_visits_and_payments(db_session, create_activity):
    """The ``delete_record`` scenario hard-deletes the record plus its visits
    and payments (rebind of the former ``RecordService.delete`` cascade test)."""
    from src.usecases.records import delete_record

    payload = create_activity()
    activity = await db_session.get(Activity, payload["id"])
    client = Client(name="C", phone=None)
    db_session.add(client)
    await db_session.commit()
    record = await _insert_record_cascade(
        db_session, activity, client, num_visits=2, num_payments=1,
    )
    record_id = record.id
    visit_ids = list((await db_session.execute(
        select(Visit.id).where(Visit.record_id == record_id)
    )).scalars().all())
    payment_ids = list((await db_session.execute(
        select(Payment.id).where(Payment.record_id == record_id)
    )).scalars().all())

    result = await delete_record(
        None, db_session=db_session, id=record_id,
        resolutions={"visits": "cascade", "payments": "cascade"},
        expected={"visits": visit_ids, "payments": payment_ids},
    )

    assert result is True
    # Record gone
    assert await db_session.get(Record, record_id) is None
    # Visits for this record gone
    assert list((await db_session.execute(
        select(Visit).where(Visit.record_id == record_id)
    )).scalars().all()) == []
    # Payments for this record gone
    assert list((await db_session.execute(
        select(Payment).where(Payment.record_id == record_id)
    )).scalars().all()) == []
    # Activity + client untouched
    assert await db_session.get(Activity, activity.id) is not None
    assert await db_session.get(Client, client.id) is not None


async def test_delete_record_scenario_cleans_record_tags_join_rows(db_session, create_activity):
    """Deleting a tagged record removes its record_tags join rows; the tag
    survives (rebind of the former ``RecordService.delete`` tag-cleanup test)."""
    from src.usecases.records import delete_record

    payload = create_activity()
    activity = await db_session.get(Activity, payload["id"])
    client = Client(name="C", phone=None)
    db_session.add(client)
    await db_session.commit()
    record = await _insert_record_cascade(db_session, activity, client)
    tag = Tag(title="rec-tag")
    db_session.add(tag)
    await db_session.flush()
    await db_session.execute(
        record_tags.insert().values(record_id=record.id, tag_id=tag.id)
    )
    await db_session.commit()
    visit_ids = list((await db_session.execute(
        select(Visit.id).where(Visit.record_id == record.id)
    )).scalars().all())

    result = await delete_record(
        None, db_session=db_session, id=record.id,
        resolutions={"visits": "cascade"},
        expected={"visits": visit_ids},
    )

    assert result is True
    # join rows gone
    assert list((await db_session.execute(
        select(record_tags).where(record_tags.c.record_id == record.id)
    )).all()) == []
    # tag row survives (independent entity)
    assert await db_session.get(Tag, tag.id) is not None


# ── GH #325 — bulk delete by record ID set (activity-delete scenario) ──────


@pytest.mark.asyncio
async def test_delete_rows_with_tags_bulk_is_not_transactional():
    """The scenario-helper must NOT be wrapped by @transactional."""
    from src.services.record import RecordService

    assert not hasattr(RecordService.delete_rows_with_tags_bulk, _TRANSACTIONAL_MARKER), (
        "delete_rows_with_tags_bulk is a scenario building block — it must NOT "
        "commit; the usecases layer owns the transaction boundary"
    )


@pytest.mark.asyncio
async def test_delete_rows_with_tags_bulk_removes_records_and_join_rows(
    db_session, create_activity
):
    """ONE set-based pair of deletes: record_tags + rows of ALL listed
    records gone; other records, their join rows and the tag rows stay."""
    payload = create_activity()
    activity = await db_session.get(Activity, payload["id"])
    client = Client(name="C", phone=None)
    db_session.add(client)
    await db_session.commit()
    # num_visits=0: visits/payments removal is the scenario's job (Task 1
    # helpers) — this pair-test covers only record_tags + record rows.
    record_a = await _insert_record_cascade(db_session, activity, client, num_visits=0)
    record_b = await _insert_record_cascade(db_session, activity, client, num_visits=0)
    record_c = await _insert_record_cascade(db_session, activity, client, num_visits=0)  # not in the set
    tag = Tag(title="bulk-tag")
    db_session.add(tag)
    await db_session.flush()
    for record_id in (record_a.id, record_b.id, record_c.id):
        await db_session.execute(
            record_tags.insert().values(record_id=record_id, tag_id=tag.id)
        )
    await db_session.commit()
    target_ids = [record_a.id, record_b.id]

    from src.services.record import get_record_service
    await get_record_service().delete_rows_with_tags_bulk(db_session, target_ids)

    # Join rows of the targets gone
    assert list((await db_session.execute(
        select(record_tags).where(record_tags.c.record_id.in_(target_ids))
    )).all()) == []
    # Target record rows gone
    assert list((await db_session.execute(
        select(Record).where(Record.id.in_(target_ids))
    )).scalars().all()) == []
    # The untouched record keeps its row AND its join row
    assert await db_session.get(Record, record_c.id) is not None
    assert list((await db_session.execute(
        select(record_tags).where(record_tags.c.record_id == record_c.id)
    )).all()) != []
    # Tag row survives (independent entity)
    assert await db_session.get(Tag, tag.id) is not None


@pytest.mark.asyncio
async def test_delete_rows_with_tags_bulk_empty_set_is_noop(db_session):
    """An empty ID set issues NO query at all."""
    from unittest.mock import AsyncMock, patch

    from src.services.record import get_record_service

    with patch.object(db_session, "execute", new_callable=AsyncMock) as exec_spy:
        await get_record_service().delete_rows_with_tags_bulk(db_session, [])
    exec_spy.assert_not_awaited()


@pytest.mark.asyncio
async def test_delete_rows_with_tags_bulk_does_not_commit(
    db_session, create_activity
):
    """No-commit property: rollback after the bulk delete restores the
    records and their join rows."""
    payload = create_activity()
    activity = await db_session.get(Activity, payload["id"])
    client = Client(name="C", phone=None)
    db_session.add(client)
    await db_session.commit()
    # num_visits=0: visits/payments removal is the scenario's job (Task 1
    # helpers) — this pair-test covers only record_tags + record rows.
    record = await _insert_record_cascade(db_session, activity, client, num_visits=0)
    tag = Tag(title="rb-tag")
    db_session.add(tag)
    await db_session.flush()
    await db_session.execute(
        record_tags.insert().values(record_id=record.id, tag_id=tag.id)
    )
    await db_session.commit()

    from src.services.record import get_record_service
    record_id = record.id
    await get_record_service().delete_rows_with_tags_bulk(db_session, [record_id])
    await db_session.rollback()

    from tests.conftest import query_db
    assert query_db(
        f"SELECT COUNT(*) AS c FROM records WHERE id='{record_id}'"
    )[0]["c"] == 1, (
        "delete_rows_with_tags_bulk must NOT commit — the scenario layer "
        "owns the transaction boundary (canon rule 3)"
    )
    assert query_db(
        f"SELECT COUNT(*) AS c FROM record_tags WHERE record_id='{record_id}'"
    )[0]["c"] == 1, (
        "the record_tags leg must NOT commit either — one transaction "
        "boundary for the whole pair of statements"
    )
