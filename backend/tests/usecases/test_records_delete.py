"""Unit tests for the ``delete_record`` scenario (GH #171 Task 5).

Behavior-preserving extraction of the deferred-delete business chain
(Corridor 2 — canon docs/domain-rules/service-layer.md rule 2): the
scenario takes dependency collection, snapshot verification
(``expected``), resolutions validation, and the cascade from the route +
``RecordService.resolve_delete``; the ROUTE keeps transport (form 422s,
scope probe, dry-run preview, 409/404/422 mapping, response format).
The #285 contract is unchanged.

These tests pin the new shape:

- the scenario is decorated ``@transactional``;
- internal order: existence probe (missing id → ``None``, route → 404)
  → collect deps → blocking check (``BlockingDepsError``) → stale
  expected check (``StaleDependenciesError`` carries the tree) →
  resolutions validation (``InvalidResolutionError``) → own-entity mark
  → cascade visits → payments → record_tags → record row;
- a failed branch raises BEFORE the cascade — nothing is deleted and the
  decorator aborts (no commit, NO event batch);
- success publishes EXACTLY ``{"records", "visits", "payments"}`` — the
  pre-refactor grid of ``RecordService.delete`` (auto-mark "records" is
  now the scenario's explicit ``mark_changed``; the visit/payment
  helpers mark THEIRS).

CALLING CONVENTION: scenarios are selfless functions, so the
``@transactional`` wrapper binds the first positional arg as ``self`` —
they are invoked with KEYWORD arguments (see the module docstring in
``src/usecases/records.py``).
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from src.models.activity import Activity
from src.models.payment import Payment
from src.models.record import Record
from src.models.tag import record_tags
from src.models.visit import Visit
from src.schemas.record import VisitItem
from src.services.decorators import _TRANSACTIONAL_MARKER

pytestmark = pytest.mark.asyncio


async def _orm_activity(db_session, create_activity, capacity=10) -> Activity:
    """The ``create_activity`` factory rides the API (returns a dict);
    tests here need the ORM row — fetch it by the factory's id."""
    payload = create_activity(capacity=capacity)
    activity = await db_session.get(Activity, payload["id"])
    assert activity is not None
    return activity


async def _seed_record(db_session, activity, prices, tag_ids=(), payments=()):
    """Insert a record + visits (+ optional payments and tag links) directly."""
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
    for amount in payments:
        db_session.add(Payment(record_id=record.id, amount=amount))
    for tag_id in tag_ids:
        await db_session.execute(
            record_tags.insert().values(record_id=record.id, tag_id=tag_id)
        )
    await db_session.commit()
    return record


async def _insert_tag(db_session) -> str:
    """Insert a tag row directly; return its id (link target for record_tags)."""
    from src.models.tag import Tag

    tag_id = str(uuid.uuid4())
    db_session.add(Tag(id=tag_id, title=f"tag-{tag_id[:8]}"))
    await db_session.commit()
    return tag_id


async def _ids(db_session, stmt) -> list[str]:
    return list((await db_session.execute(stmt)).scalars().all())


async def test_usecases_delete_record_is_transactional():
    """The scenario owns the transaction boundary — it must be wrapped."""
    from src.usecases.records import delete_record

    assert hasattr(delete_record, _TRANSACTIONAL_MARKER), (
        "delete_record is a Corridor-2 scenario — it must be wrapped by "
        "@transactional (one transaction + one event batch per action)"
    )


async def test_delete_missing_returns_none(db_session, create_activity):
    """A missing id → None (the route maps that to 404)."""
    from src.usecases.records import delete_record

    assert await delete_record(
        None, db_session=db_session, id="nonexistent",
        resolutions=None, expected={},
    ) is None


async def test_delete_stale_expected_raises_and_keeps_rows(
    db_session, create_activity, subscriber,
):
    """A dep ABSENT from ``expected`` → StaleDependenciesError carrying the
    tree; nothing is deleted; NO event batch publishes (the decorator
    aborts on the raise — the 409 branch must not invalidate caches)."""
    from src.domain.deletion import StaleDependenciesError
    from src.usecases.records import delete_record

    activity = await _orm_activity(db_session, create_activity)
    record = await _seed_record(db_session, activity, [100], payments=[500])
    record_id = record.id  # rollback expires ORM objects — keep the id

    # Discard setup noise: the create_activity API factory publishes its own
    # batches (staff/masters, services, locations, activities).
    _drain(subscriber)

    # The caller confirmed NOTHING (empty expected) — the payment is stale.
    with pytest.raises(StaleDependenciesError) as exc_info:
        await delete_record(
            None, db_session=db_session, id=record_id,
            resolutions={"visits": "cascade", "payments": "cascade"},
            expected={},
        )

    entities = {node.entity for node in exc_info.value.nodes}
    assert "payments" in entities, "the tree must carry the stale dep"

    # Nothing was deleted — the raise aborts before the cascade.
    await db_session.rollback()
    assert await db_session.get(Record, record_id) is not None
    payments_left = await _ids(
        db_session, select(Payment.id).where(Payment.record_id == record_id),
    )
    assert payments_left, "the stale branch must NOT run the cascade"

    # Failure branch publishes NOTHING — the @transactional decorator
    # aborts on the raise before emitting the event batch (GH #239 grid).
    assert _drain(subscriber) == [], (
        "the stale branch must not invalidate caches — no event batch"
    )


async def test_delete_invalid_resolutions_raises_and_keeps_rows(
    db_session, create_activity, subscriber,
):
    """A wrong resolution action → InvalidResolutionError (route → 422);
    nothing is deleted."""
    from src.domain.deletion import InvalidResolutionError
    from src.usecases.records import delete_record

    activity = await _orm_activity(db_session, create_activity)
    record = await _seed_record(db_session, activity, [100])
    record_id = record.id  # rollback expires ORM objects — keep the id
    visit_ids = await _ids(db_session, select(Visit.id).where(Visit.record_id == record_id))

    # Discard setup noise: the create_activity API factory publishes its own
    # batches (staff/masters, services, locations, activities).
    _drain(subscriber)

    with pytest.raises(InvalidResolutionError):
        await delete_record(
            None, db_session=db_session, id=record_id,
            resolutions={"visits": "archive"},  # not an allowed action
            expected={"visits": visit_ids},
        )

    await db_session.rollback()
    assert await db_session.get(Record, record_id) is not None
    assert await _ids(db_session, select(Visit).where(Visit.record_id == record_id)) != []

    # Failure branch publishes NOTHING (the decorator aborts on the raise).
    assert _drain(subscriber) == [], (
        "the invalid-resolutions branch must not publish an event batch"
    )


async def test_delete_cascades_and_returns_true(db_session, create_activity):
    """Success: visits, payments, record_tags links, and the record row are
    all hard-deleted; the return value is True (route → 204)."""
    from src.usecases.records import delete_record

    activity = await _orm_activity(db_session, create_activity)
    tag_id = await _insert_tag(db_session)
    record = await _seed_record(
        db_session, activity, [100, 200],
        tag_ids=[tag_id], payments=[300],
    )
    visit_ids = await _ids(db_session, select(Visit.id).where(Visit.record_id == record.id))
    payment_ids = await _ids(db_session, select(Payment.id).where(Payment.record_id == record.id))

    result = await delete_record(
        None, db_session=db_session, id=record.id,
        resolutions={"visits": "cascade", "payments": "cascade"},
        expected={"visits": visit_ids, "payments": payment_ids},
    )
    assert result is True

    assert await db_session.get(Record, record.id) is None
    assert await _ids(db_session, select(Visit).where(Visit.record_id == record.id)) == []
    assert await _ids(db_session, select(Payment).where(Payment.record_id == record.id)) == []
    assert (
        await db_session.execute(
            select(record_tags).where(record_tags.c.record_id == record.id)
        )
    ).all() == []


async def test_delete_clean_path_resolutions_none(db_session, create_activity):
    """Clean commit (no deps, ``resolutions=None``): the clean-path
    declaration — validates trivially and deletes (route: body
    ``{"expected": {}}`` → 204, the pre-refactor flow)."""
    from src.usecases.records import delete_record

    activity = await _orm_activity(db_session, create_activity)
    record = await _seed_record(db_session, activity, [])  # NO visits — clean

    result = await delete_record(
        None, db_session=db_session, id=record.id,
        resolutions=None, expected={},
    )
    assert result is True
    assert await db_session.get(Record, record.id) is None


# ─── Event grid (GH #239) ────────────────────────────────────────────────────


def _drain(q) -> list[tuple[set[str], object]]:
    """Collect everything currently sitting in the hub queue (the same
    drain helper pattern as tests/test_events_emit.py)."""
    events = []
    while not q.empty():
        events.append(q.get_nowait())
    return events


@pytest.fixture
def subscriber():
    """Subscribe to the module-level event hub for ONE test; drain on exit."""
    from src.events.hub import hub

    q = hub.subscribe()
    try:
        yield q
    finally:
        hub.unsubscribe(q)


async def test_delete_success_grid_is_records_visits_payments(
    db_session, create_activity, subscriber,
):
    """The success path publishes EXACTLY {"records", "visits", "payments"} —
    the pre-refactor grid of ``RecordService.delete``: the scenario marks
    its own entity ("records"), the visit/payment helpers mark THEIRS."""
    from src.usecases.records import delete_record

    activity = await _orm_activity(db_session, create_activity)
    record = await _seed_record(db_session, activity, [100], payments=[50])
    record_id = record.id
    visit_ids = await _ids(db_session, select(Visit.id).where(Visit.record_id == record_id))
    payment_ids = await _ids(db_session, select(Payment.id).where(Payment.record_id == record_id))

    # Discard setup noise: the create_activity API factory publishes its own
    # batches (staff/masters, services, locations, activities).
    _drain(subscriber)

    result = await delete_record(
        None, db_session=db_session, id=record_id,
        resolutions={"visits": "cascade", "payments": "cascade"},
        expected={"visits": visit_ids, "payments": payment_ids},
    )
    assert result is True

    events = _drain(subscriber)
    assert len(events) == 1, f"ONE @transactional = ONE event batch, got {events}"
    published_entities, origin = events[0]
    assert published_entities == {"records", "visits", "payments"}
    assert origin is None  # direct scenario call — no middleware envelope
