"""Unit tests for BaseRepository.list + list_custom pagination (GH #206).

Covers the repo-owned paginated list API:
  - BaseRepository.list: filters, None-skip, order_by, limit/offset, total count
  - BaseRepository.list_custom: caller-built stmt + count/slice wrapper
  - selectinload options don't break the count subquery
  - correlated scalar-subquery order key doesn't break the count

No HTTP layer — drives repositories directly via the ``db_session`` fixture.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from src.models.activity import Activity
from src.models.location import Location
from src.models.master import Master
from src.models.service import Service
from src.repositories.generic import get_base_repository

pytestmark = pytest.mark.asyncio


# ─── Helpers ────────────────────────────────────────────────────────────────────


def _master(**overrides) -> Master:
    """Build a Master with sensible defaults, overridable per-test."""
    defaults: dict = dict(
        last_name="T",
        color="#000000",
        position="мастер",
        specialty="живопись",
    )
    defaults.update(overrides)
    return Master(**defaults)


def _service(**overrides) -> Service:
    """Build a Service with the full NOT NULL field set."""
    defaults: dict = dict(
        title="S",
        description="d",
        image_url="http://x",
        specialty="живопись",
        min_age=0,
        duration=60,
        record_info="r",
    )
    defaults.update(overrides)
    return Service(**defaults)


# ─── BaseRepository.list ────────────────────────────────────────────────────────


async def test_list_filters_and_none_skip(db_session) -> None:
    """Filters match; None-valued filters are skipped (not applied as IS NULL)."""
    db_session.add(_master(first_name="A1", position="мастер"))
    db_session.add(_master(first_name="A2", position="мастер"))
    db_session.add(_master(first_name="A3", position="senior"))
    await db_session.flush()
    repo = get_base_repository()
    rows, total = await repo.list(
        db_session,
        Master,
        filters={"position": "мастер", "last_name": None},
        limit=100,
    )
    assert total == 2
    assert len(rows) == 2
    assert all(r.position == "мастер" for r in rows)


async def test_list_limit_offset_slice_and_total(db_session) -> None:
    """total is the full count; rows is the limit/offset slice."""
    for i in range(5):
        db_session.add(_master(first_name=f"M{i}"))
    await db_session.flush()
    repo = get_base_repository()
    rows, total = await repo.list(db_session, Master, limit=2, offset=2)
    assert total == 5
    assert len(rows) == 2
    rows, total = await repo.list(db_session, Master, limit=2, offset=4)
    assert total == 5
    assert len(rows) == 1


async def test_list_order_by_applied(db_session) -> None:
    """order_by sorts rows; total is unaffected by ordering."""
    db_session.add(_master(first_name="Alpha"))
    db_session.add(_master(first_name="Gamma"))
    db_session.add(_master(first_name="Beta"))
    await db_session.flush()
    repo = get_base_repository()
    rows, total = await repo.list(
        db_session,
        Master,
        order_by=[Master.first_name.desc()],
        limit=100,
    )
    assert total == 3
    assert [r.first_name for r in rows] == ["Gamma", "Beta", "Alpha"]


async def test_list_options_selectinload_does_not_break_count(db_session) -> None:
    """selectinload options are stripped from the count subquery; relationships eager-loaded."""
    db_session.add(_service())
    await db_session.flush()
    repo = get_base_repository()
    rows, total = await repo.list(
        db_session,
        Service,
        limit=100,
        options=[selectinload(Service.tariffs), selectinload(Service.tags)],
    )
    assert total == 1
    assert len(rows) == 1
    # Accessing relationships in async context works only if eager-loaded
    # (a bare lazy load would raise MissingGreenlet).
    assert rows[0].tariffs == []
    assert rows[0].tags == []


# ─── BaseRepository.list_custom ─────────────────────────────────────────────────


async def test_list_custom_count_excludes_order_by(db_session) -> None:
    """list_custom counts the unordered stmt; order_by (incl. correlated subquery) doesn't break count."""
    # 3 masters for both cases.
    db_session.add(_master(first_name="B"))
    db_session.add(_master(first_name="A"))
    db_session.add(_master(first_name="C"))
    await db_session.flush()
    repo = get_base_repository()

    # Case A: simple order_by + limit slice.
    rows, total = await repo.list_custom(
        db_session, select(Master), order_by=[Master.first_name], limit=2, offset=0
    )
    assert total == 3
    assert len(rows) == 2
    assert [r.first_name for r in rows] == ["A", "B"]

    # Case B: correlated scalar-subquery order key.
    # Seed an Activity for the "B" master so the subquery returns 1 for it
    # and 0 for the others — desc ordering puts "B" first.
    svc = _service(title="for-activity")
    db_session.add(svc)
    db_session.add(Location(name="L", capacity=10))
    await db_session.flush()
    b_master = next(r for r in rows if r.first_name == "B")  # rows from Case A
    # Re-fetch the "B" master from this session to wire the activity FK.
    b_master = await db_session.get(Master, b_master.id)
    db_session.add(
        Activity(
            master_id=b_master.id,
            service_id=svc.id,
            location_id=(await db_session.execute(
                select(Location).limit(1)
            )).scalar_one().id,
            start=datetime.now(UTC) + timedelta(days=1),
            duration=60,
            capacity=10,
        )
    )
    await db_session.flush()

    sub = (
        select(func.count(Activity.id))
        .where(Activity.master_id == Master.id)
        .correlate(Master)
        .scalar_subquery()
    )
    rows2, total2 = await repo.list_custom(
        db_session, select(Master), order_by=[sub.desc()], limit=100
    )
    assert total2 == 3
    assert len(rows2) == 3
    # The master with the activity (count=1) sorts first under DESC.
    assert rows2[0].first_name == "B"


async def test_list_custom_limit_offset(db_session) -> None:
    """list_custom applies limit/offset; total is the full count."""
    for i in range(4):
        db_session.add(_master(first_name=f"X{i}"))
    await db_session.flush()
    repo = get_base_repository()
    rows, total = await repo.list_custom(
        db_session, select(Master), limit=1, offset=3
    )
    assert total == 4
    assert len(rows) == 1
