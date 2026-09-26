"""Tests for the PhotoService scenario building blocks (GH #325)."""

from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import select

from src.models.activity import Activity
from src.models.location import Location
from src.models.master import Master
from src.models.photo import Photo
from src.models.service import Service
from src.models.staff import Staff
from src.services.decorators import _TRANSACTIONAL_MARKER
from src.services.photo import PhotoService


async def _insert_activity(db_session) -> Activity:
    """Insert a bare Activity (committed) — the FK target for photos."""
    staff = Staff(first_name="M", last_name="L")
    service = Service(title="S", description="d", image_url="http://x",
                      specialty="s", min_age=5, duration=60, record_info="r")
    location = Location(title="L", capacity=20)
    db_session.add_all([staff, service, location])
    await db_session.flush()
    db_session.add(Master(staff_id=staff.id, specialty="s", color="#000000"))
    await db_session.flush()
    activity = Activity(
        master_id=staff.id, service_id=service.id, location_id=location.id,
        start=datetime(2030, 1, 1, 12, 0), duration=90, capacity=10,
        is_private=False,
    )
    db_session.add(activity)
    await db_session.commit()
    return activity


# ── GH #325 — unlink photos from a dying activity (activity-delete scenario) ──


def test_unlink_from_activity_is_not_transactional() -> None:
    """The scenario-helper must NOT be wrapped by @transactional."""
    assert not hasattr(PhotoService.unlink_from_activity, _TRANSACTIONAL_MARKER), (
        "unlink_from_activity is a scenario building block — it must NOT "
        "commit; the usecases layer owns the transaction boundary"
    )


@pytest.mark.asyncio
async def test_unlink_from_activity_nullifies_photos_and_keeps_rows(db_session):
    """ONE bulk UPDATE: every photo of the activity survives with
    activity_id IS NULL; another activity's photos stay untouched."""
    target = await _insert_activity(db_session)
    other = await _insert_activity(db_session)
    own_a = Photo(filename="a.jpg", is_public=False, activity_id=target.id)
    own_b = Photo(filename="b.jpg", is_public=True, activity_id=target.id)
    foreign = Photo(filename="c.jpg", is_public=False, activity_id=other.id)
    ownerless = Photo(filename="d.jpg", is_public=False, activity_id=None)
    db_session.add_all([own_a, own_b, foreign, ownerless])
    await db_session.commit()

    from src.services.photo import get_photo_service
    await get_photo_service().unlink_from_activity(db_session, target.id)

    rows = {
        p.filename: p.activity_id
        for p in (await db_session.execute(select(Photo))).scalars().all()
    }
    assert rows == {
        "a.jpg": None,  # unlinked, row survives (#194, G1b)
        "b.jpg": None,  # unlinked, row survives
        "c.jpg": other.id,  # чужая activity untouched
        "d.jpg": None,  # was already ownerless — stays so
    }


@pytest.mark.asyncio
async def test_unlink_from_activity_runs_without_records(db_session):
    """The unlink is UNCONDITIONAL — one UPDATE runs even when the activity
    has no records (photos may exist regardless, GH #239 §3.3)."""
    activity = await _insert_activity(db_session)
    photo = Photo(filename="lonely.jpg", is_public=False, activity_id=activity.id)
    db_session.add(photo)
    await db_session.commit()

    from src.services.photo import get_photo_service
    await get_photo_service().unlink_from_activity(db_session, activity.id)

    assert (await db_session.get(Photo, photo.id)).activity_id is None


@pytest.mark.asyncio
async def test_unlink_from_activity_does_not_commit(db_session):
    """No-commit property: rollback after the unlink restores the link."""
    activity = await _insert_activity(db_session)
    photo = Photo(filename="rb.jpg", is_public=False, activity_id=activity.id)
    db_session.add(photo)
    await db_session.commit()

    from src.services.photo import get_photo_service
    photo_id, activity_id = photo.id, activity.id
    await get_photo_service().unlink_from_activity(db_session, activity_id)
    await db_session.rollback()

    from tests.conftest import query_db
    assert query_db(
        f"SELECT COUNT(*) AS c FROM photos WHERE id='{photo_id}' "
        f"AND activity_id='{activity_id}'"
    )[0]["c"] == 1, (
        "unlink_from_activity must NOT commit — the scenario layer owns "
        "the transaction boundary (canon rule 3)"
    )
