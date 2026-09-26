"""Unit tests for the ``delete_activity`` scenario (GH #325 Task 3).

Behavior-preserving extraction of the cascade half of
``ActivityService.delete`` (Corridor 2 — canon docs/domain-rules/
service-layer.md rule 2): the scenario composes the owners'
non-transactional bulk helpers — visits → payments → record_tags+rows →
photo unlink → activity_tags + the activity row — while the ROUTE keeps
transport (the #286 D2 contract: form 422s, dry-run preview, 409/404
mapping) and its ``expected`` verification (fail-closed BEFORE the
scenario runs; not re-done here).

These tests pin the new shape:

- the scenario is decorated ``@transactional`` (ONE transaction + ONE
  event batch) and is called selfless: ``delete_activity(None,
  db_session=..., id=...)``;
- a missing id → ``False`` (the route maps that to 404);
- success: records (with their visits/payments/record_tags links),
  activity_tags links, and the activity row are hard-deleted; photos
  SURVIVE unlinked (activity_id := NULL — #194 G1b);
- event grids (GH #239 §3.3), byte-identical to the former bound-method
  flow: with records — ``{"records", "visits", "payments", "tags",
  "photos", "activities"}``; CLEAN activity (no records) — EXACTLY
  ``{"photos", "tags", "activities"}`` (photos and activity_tags are
  unconditional; the "activities" mark is explicit — the selfless
  wrapper starts with an EMPTY accumulator).

The deferred-delete commit's audit row (GH #344 §4.5) is pinned in
``tests/test_audit_explicit.py`` via this scenario (GH #325 Task 4 —
the former ``ActivityService.delete`` pin moved here with the method's
demolition; the ROUTE now calls this scenario too).
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from src.models.activity import Activity
from src.models.payment import Payment
from src.models.photo import Photo
from src.models.record import Record
from src.models.tag import Tag, activity_tags, record_tags
from src.models.visit import Visit
from src.services.decorators import _TRANSACTIONAL_MARKER

pytestmark = pytest.mark.asyncio


async def _orm_activity(db_session, create_activity) -> Activity:
    """The ``create_activity`` factory rides the API (returns a dict);
    tests here need the ORM row — fetch it by the factory's id."""
    payload = create_activity()
    activity = await db_session.get(Activity, payload["id"])
    assert activity is not None
    return activity


async def _ids(db_session, stmt) -> list[str]:
    return list((await db_session.execute(stmt)).scalars().all())


async def _seed_record(db_session, activity, *, payments: int = 0, tag_ids=()) -> Record:
    """Insert a record + 2 visits (+ optional payments/tag links) directly."""
    from src.schemas.record import VisitItem
    from src.services.record import get_record_service
    from src.services.visit import get_visit_service

    record = await get_record_service().create_row(
        db_session,
        activity_id=activity.id,
        client_id=None,
        seats=2,
        comment=None,
        custom_price=None,
    )
    await get_visit_service().create_visits_bulk(
        db_session,
        record.id,
        [VisitItem(price=1000), VisitItem(price=2000)],
    )
    for _ in range(payments):
        db_session.add(Payment(record_id=record.id, amount=500, method="cash"))
    for tag_id in tag_ids:
        await db_session.execute(record_tags.insert().values(record_id=record.id, tag_id=tag_id))
    await db_session.commit()
    return record


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


# ─── Shape ────────────────────────────────────────────────────────────────────


async def test_usecases_delete_activity_is_transactional():
    """The scenario owns the transaction boundary — it must be wrapped."""
    from src.usecases.activities import delete_activity

    assert hasattr(delete_activity, _TRANSACTIONAL_MARKER), (
        "delete_activity is a Corridor-2 scenario — it must be wrapped by "
        "@transactional (one transaction + one event batch per action)"
    )


async def test_delete_activity_missing_returns_false(db_session):
    """A missing id → False (the route maps that to 404)."""
    from src.usecases.activities import delete_activity

    assert await delete_activity(None, db_session=db_session, id="nonexistent") is False


# ─── Cascade (activity WITH records) ──────────────────────────────────────────


async def test_delete_activity_cascades_hard_deletes_and_unlinks(
    db_session,
    create_activity,
):
    """With records: the activity, its records (with visits/payments/
    record_tags links), and its activity_tags links are hard-deleted;
    photos survive unlinked. Return value True (route → 204)."""
    from src.usecases.activities import delete_activity

    activity = await _orm_activity(db_session, create_activity)
    tag = Tag(title="act-tag")
    db_session.add(tag)
    await db_session.flush()
    await db_session.execute(activity_tags.insert().values(activity_id=activity.id, tag_id=tag.id))
    await db_session.commit()
    r1 = await _seed_record(db_session, activity, payments=1)
    r2 = await _seed_record(db_session, activity)
    photo = Photo(filename="p.jpg", is_public=False, activity_id=activity.id)
    db_session.add(photo)
    await db_session.commit()
    record_ids = [r1.id, r2.id]
    photo_id = photo.id

    result = await delete_activity(None, db_session=db_session, id=activity.id)

    assert result is True
    assert await db_session.get(Activity, activity.id) is None
    assert (
        await _ids(
            db_session,
            select(Record.id).where(Record.activity_id == activity.id),
        )
        == []
    )
    assert (
        await _ids(
            db_session,
            select(Visit.id).where(Visit.record_id.in_(record_ids)),
        )
        == []
    )
    assert (
        await _ids(
            db_session,
            select(Payment.id).where(Payment.record_id.in_(record_ids)),
        )
        == []
    )
    assert (
        await db_session.execute(select(record_tags).where(record_tags.c.record_id.in_(record_ids)))
    ).all() == []
    assert (
        await db_session.execute(
            select(activity_tags).where(activity_tags.c.activity_id == activity.id)
        )
    ).all() == []
    # Photo survives, unlinked (#194 G1b)
    surviving = await db_session.get(Photo, photo_id)
    assert surviving is not None
    assert surviving.activity_id is None


# ─── Event grids (GH #239 §3.3) ───────────────────────────────────────────────


async def test_delete_activity_with_records_grid(
    db_session,
    create_activity,
    subscriber,
):
    """With records the success batch is EXACTLY {"records", "visits",
    "payments", "tags", "photos", "activities"} — the pre-refactor grid
    of ``ActivityService.delete``: the helpers mark THEIRS, the scenario
    marks "activities" explicitly (empty selfless accumulator)."""
    from src.usecases.activities import delete_activity

    activity = await _orm_activity(db_session, create_activity)
    await _seed_record(db_session, activity, payments=1)

    # Discard setup noise: the create_activity API factory publishes its
    # own batches (staff/masters, services, locations, activities).
    _drain(subscriber)

    result = await delete_activity(None, db_session=db_session, id=activity.id)
    assert result is True

    events = _drain(subscriber)
    assert len(events) == 1, f"ONE @transactional = ONE event batch, got {events}"
    published_entities, origin = events[0]
    assert published_entities == {
        "records",
        "visits",
        "payments",
        "tags",
        "photos",
        "activities",
    }
    assert origin is None  # direct scenario call — no middleware envelope


async def test_delete_clean_activity_grid_is_photos_tags_activities(
    db_session,
    create_activity,
    subscriber,
):
    """CLEAN activity (no records): the batch is EXACTLY {"photos",
    "tags", "activities"} — the unconditional half (photo unlink +
    activity_tags) plus the explicit own-entity mark. This grid was NOT
    covered before GH #325 (spec «Марки событий»)."""
    from src.usecases.activities import delete_activity

    activity = await _orm_activity(db_session, create_activity)
    photo = Photo(filename="clean.jpg", is_public=False, activity_id=activity.id)
    db_session.add(photo)
    await db_session.commit()
    photo_id = photo.id

    _drain(subscriber)

    result = await delete_activity(None, db_session=db_session, id=activity.id)
    assert result is True

    # The clean path still unlinks photos (unconditional helper)
    surviving = await db_session.get(Photo, photo_id)
    assert surviving is not None
    assert surviving.activity_id is None
    assert await db_session.get(Activity, activity.id) is None

    events = _drain(subscriber)
    assert len(events) == 1, f"ONE @transactional = ONE event batch, got {events}"
    published_entities, origin = events[0]
    assert published_entities == {"photos", "tags", "activities"}
    assert origin is None
