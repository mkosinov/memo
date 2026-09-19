"""Unit tests for the ``update_record`` / ``patch_record`` scenarios (GH #171 Task 4).

Behavior-preserving extraction of the former ``RecordService.update`` /
``RecordService.patch`` chains (Corridor 2 — canon
docs/domain-rules/service-layer.md rule 2). These tests pin the new shape:

- both scenarios are decorated ``@transactional``;
- a direct call mutates the record in the caller's ONE session/transaction
  (no commit inside the chain);
- visit replacement keeps the MANDATORY interleaving: delete → recompute
  seats → capacity check → bulk insert (US-6 shrink must not 409);
- missing id → ``None`` (the route maps that to 404);
- patch without ``visits`` leaves visits untouched and skips capacity.

CALLING CONVENTION: scenarios are selfless functions, so the
``@transactional`` wrapper binds the first positional arg as ``self`` —
they are invoked with KEYWORD arguments (see the module docstring in
``src/usecases/records.py``).
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from src.models.activity import Activity
from src.models.record import Record
from src.models.visit import Visit
from src.schemas.record import RecordPatch, RecordUpdate, VisitItem
from src.services.decorators import _TRANSACTIONAL_MARKER

pytestmark = pytest.mark.asyncio


async def _orm_activity(db_session, create_activity, capacity=10) -> Activity:
    """The ``create_activity`` factory rides the API (returns a dict);
    tests here need the ORM row — fetch it by the factory's id."""
    payload = create_activity(capacity=capacity)
    activity = await db_session.get(Activity, payload["id"])
    assert activity is not None
    return activity


async def _seed_record(db_session, activity: Activity, prices: list[int]) -> Record:
    """Insert a record + visits directly (row-level ops only)."""
    from src.services.record import get_record_service
    from src.services.visit import get_visit_service

    record = await get_record_service().create_row(
        db_session, activity_id=activity.id, client_id=None,
        seats=len(prices), comment=None, custom_price=None,
    )
    await get_visit_service().create_visits_bulk(
        db_session, record.id,
        [VisitItem(price=p) for p in prices],
    )
    await db_session.commit()
    return record


async def test_usecases_update_and_patch_are_transactional():
    """Both scenarios own the transaction boundary — they must be wrapped."""
    from src.usecases.records import patch_record, update_record

    assert hasattr(update_record, _TRANSACTIONAL_MARKER), (
        "update_record is a Corridor-2 scenario — it must be wrapped by "
        "@transactional (one transaction + one event batch per action)"
    )
    assert hasattr(patch_record, _TRANSACTIONAL_MARKER), (
        "patch_record is a Corridor-2 scenario — it must be wrapped by "
        "@transactional (one transaction + one event batch per action)"
    )


async def test_update_replaces_visits(db_session, create_activity):
    """PUT: old visits gone, new visits inserted, seats recomputed."""
    from src.usecases.records import update_record

    activity = await _orm_activity(db_session, create_activity)
    record = await _seed_record(db_session, activity, [100])
    old_visit_ids = [
        v.id for v in (
            (await db_session.execute(
                select(Visit).where(Visit.record_id == record.id)
            )).scalars().all()
        )
    ]

    data = RecordUpdate(
        activity_id=activity.id,
        comment="replaced",
        custom_price=500,
        visits=[VisitItem(price=200), VisitItem(price=300)],
    )
    updated = await update_record(
        None, db_session=db_session, id=record.id, data=data,
    )

    assert updated is not None
    assert updated.comment == "replaced"
    assert updated.custom_price == 500
    assert updated.seats == 2

    visits = (
        (await db_session.execute(
            select(Visit).where(Visit.record_id == record.id)
        )).scalars().all()
    )
    assert {v.price for v in visits} == {200, 300}
    assert all(v.id not in old_visit_ids for v in visits), "old visits must be deleted"


async def test_update_missing_returns_none(db_session, create_activity):
    """A missing id → None (the route maps that to 404)."""
    from src.usecases.records import update_record

    activity = await _orm_activity(db_session, create_activity)
    data = RecordUpdate(
        activity_id=activity.id,
        visits=[VisitItem(price=100)],
    )
    assert await update_record(
        None, db_session=db_session, id="nonexistent", data=data,
    ) is None


async def test_update_over_capacity_rolls_back(db_session, create_activity):
    """Over-capacity PUT → 409, no partial state (old visits restored)."""
    from fastapi import HTTPException

    from src.usecases.records import update_record

    activity = await _orm_activity(db_session, create_activity, capacity=1)
    await db_session.commit()
    activity_id = activity.id

    record = await _seed_record(db_session, activity, [100])
    record_id = record.id  # rollback expires ORM objects — keep the id

    data = RecordUpdate(
        activity_id=activity_id,
        visits=[VisitItem(price=100), VisitItem(price=200), VisitItem(price=300)],
    )
    with pytest.raises(HTTPException) as exc_info:
        await update_record(None, db_session=db_session, id=record_id, data=data)
    assert exc_info.value.status_code == 409

    # Roll back the aborted transaction — the old visits must be intact.
    await db_session.rollback()
    stored = await db_session.get(Record, record_id)
    assert stored is not None
    assert stored.seats == 1
    visits = (
        (await db_session.execute(
            select(Visit).where(Visit.record_id == record.id)
        )).scalars().all()
    )
    assert [v.price for v in visits] == [100]


async def test_update_shrink_does_not_409(db_session, create_activity):
    """US-6: shrinking visits must NOT 409 — the seats recompute before the
    capacity check resets the record's own contribution (interleaving)."""
    from src.usecases.records import update_record

    activity = await _orm_activity(db_session, create_activity)
    activity.capacity = 1
    await db_session.commit()
    activity_id = activity.id

    record = await _seed_record(db_session, activity, [100, 200])
    assert record.seats == 2

    data = RecordUpdate(
        activity_id=activity_id,
        visits=[VisitItem(price=100)],
    )
    updated = await update_record(
        None, db_session=db_session, id=record.id, data=data,
    )
    assert updated is not None
    assert updated.seats == 1


async def test_patch_visits_replaces_and_recomputes(db_session, create_activity):
    """PATCH with visits: replace + recompute seats/status."""
    from src.usecases.records import patch_record

    activity = await _orm_activity(db_session, create_activity)
    record = await _seed_record(db_session, activity, [100])

    data = RecordPatch(
        visits=[VisitItem(price=150), VisitItem(price=250)],
    )
    patched = await patch_record(
        None, db_session=db_session, id=record.id, data=data,
    )
    assert patched is not None
    assert patched.seats == 2
    visits = (
        (await db_session.execute(
            select(Visit).where(Visit.record_id == record.id)
        )).scalars().all()
    )
    assert {v.price for v in visits} == {150, 250}


async def test_patch_comment_only_leaves_visits(db_session, create_activity):
    """PATCH without visits: comment changed, visits + capacity untouched."""
    from src.usecases.records import patch_record

    activity = await _orm_activity(db_session, create_activity)
    activity.capacity = 1
    await db_session.commit()

    record = await _seed_record(db_session, activity, [100, 200])

    data = RecordPatch(comment="just a note")
    patched = await patch_record(
        None, db_session=db_session, id=record.id, data=data,
    )
    assert patched is not None
    assert patched.comment == "just a note"
    assert patched.seats == 2
    visits = (
        (await db_session.execute(
            select(Visit).where(Visit.record_id == record.id)
        )).scalars().all()
    )
    assert {v.price for v in visits} == {100, 200}


async def test_patch_missing_returns_none(db_session, create_activity):
    """A missing id → None (the route maps that to 404)."""
    from src.usecases.records import patch_record

    assert await patch_record(
        None, db_session=db_session, id="nonexistent", data=RecordPatch(comment="x"),
    ) is None


async def test_patch_over_capacity_rolls_back(db_session, create_activity):
    """Over-capacity PATCH → 409, old visits restored on rollback."""
    from fastapi import HTTPException

    from src.usecases.records import patch_record

    activity = await _orm_activity(db_session, create_activity, capacity=1)
    await db_session.commit()

    record = await _seed_record(db_session, activity, [100])
    record_id = record.id  # rollback expires ORM objects — keep the id

    data = RecordPatch(visits=[VisitItem(price=1), VisitItem(price=2)])
    with pytest.raises(HTTPException) as exc_info:
        await patch_record(None, db_session=db_session, id=record_id, data=data)
    assert exc_info.value.status_code == 409

    await db_session.rollback()
    stored = await db_session.get(Record, record_id)
    assert stored is not None
    assert stored.seats == 1
    visits = (
        (await db_session.execute(
            select(Visit).where(Visit.record_id == record.id)
        )).scalars().all()
    )
    assert [v.price for v in visits] == [100]
