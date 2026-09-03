"""Unit tests for BaseRepository.list + list_custom pagination (GH #206).

Covers the repo-owned paginated list API:
  - BaseRepository.list: filters, None-skip, order_by, limit/offset, total count
  - BaseRepository.list / ArchiveRepository.list: q + search_fields (GH #212) —
    substring narrowing, AND with filters/status, uuid-by-id match, ValueError
    guard, q-absent no-op
  - BaseRepository.list_custom: row-tuple core — multi-column selects return
    Row tuples carrying every declared column (GH #213)
  - BaseRepository.list_entity: entity-only wrapper — TypeVar-enforced, returns
    ORM instances (GH #213); a multi-column select is a mypy [arg-type] error
  - selectinload options don't break the count subquery
  - correlated scalar-subquery order key doesn't break the count

No HTTP layer — drives repositories directly via the ``db_session`` fixture.
"""

from __future__ import annotations

import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.engine import Row
from sqlalchemy.orm import selectinload

from src.models.activity import Activity
from src.models.location import Location
from src.models.master import Master
from src.models.service import Service
from src.repositories.generic import get_archive_repository, get_base_repository
from src.repositories.search import SearchField

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
    rows, total = await repo.list_entity(
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
    rows2, total2 = await repo.list_entity(
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
    rows, total = await repo.list_entity(
        db_session, select(Master), limit=1, offset=3
    )
    assert total == 4
    assert len(rows) == 1


# ─── list_custom row-tuple core + list_entity wrapper (GH #213) ─────────────────


async def test_list_custom_multi_column_returns_rows_with_both_columns(
    db_session,
) -> None:
    """list_custom (row core) returns Row tuples carrying ALL declared columns."""
    db_session.add(_master(first_name="Rowan", last_name="Smith"))
    await db_session.flush()
    repo = get_base_repository()
    stmt = select(Master, Master.first_name.label("name"))
    rows, total = await repo.list_custom(db_session, stmt)
    assert total == 1
    assert len(rows) == 1
    row = rows[0]
    assert isinstance(row, Row), f"expected Row tuple, got {type(row).__name__}"
    assert isinstance(row[0], Master)
    assert row[0].first_name == "Rowan"
    assert row[1] == "Rowan"  # second declared column rides on the Row


async def test_list_entity_returns_model_instances_and_total(db_session) -> None:
    """list_entity takes an entity select and returns ORM instances + total."""
    for name in ("E1", "E2"):
        db_session.add(_master(first_name=name))
    await db_session.flush()
    repo = get_base_repository()
    items, total = await repo.list_entity(
        db_session, select(Master), order_by=[Master.first_name], limit=1
    )
    assert total == 2
    assert len(items) == 1
    assert isinstance(items[0], Master)
    assert items[0].first_name == "E1"


async def test_list_entity_rejects_multi_column_select_under_mypy() -> None:
    """A Select[tuple[A, B]] passed to list_entity is a mypy [arg-type] error.

    Runs mypy (repo config) over ``tests/_mypy_negative_list_entity.py`` —
    a non-collected negative-case snippet with one valid and one invalid
    ``list_entity`` call. Exactly one error is expected: the multi-column
    call, code [arg-type] (TypeVar honesty, spec §5.1).
    """
    backend_root = Path(__file__).resolve().parents[1]
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "mypy",
            # silent: followed src imports are checked but their (pre-existing)
            # errors are suppressed — only the snippet's OWN errors count.
            "--follow-imports=silent",
            "tests/_mypy_negative_list_entity.py",
        ],
        cwd=backend_root,
        capture_output=True,
        text=True,
    )
    errors = [
        line for line in proc.stdout.splitlines() if " error: " in line
    ]
    assert len(errors) == 1, f"expected exactly 1 error, got:\n{proc.stdout}"
    assert "[arg-type]" in errors[0], errors[0]
    assert "list_entity" in errors[0], errors[0]


# ─── q / search_fields on list() (GH #212) ──────────────────────────────────────

_master_search_fields = [
    SearchField(Master.first_name),
    SearchField(Master.last_name),
]


async def test_list_q_substring_narrows_rows_and_total(db_session) -> None:
    """q substring-matches across OR'd fields; total is the FILTERED count."""
    db_session.add(_master(first_name="Анна", last_name="Иванова"))
    db_session.add(_master(first_name="Борис", last_name="Петров"))
    db_session.add(_master(first_name="Виктор", last_name="Аннин"))
    await db_session.flush()
    repo = get_base_repository()
    rows, total = await repo.list(
        db_session,
        Master,
        q="анн",
        search_fields=_master_search_fields,
        limit=100,
    )
    assert total == 2  # not 3 — predicate applied BEFORE the count
    assert {r.first_name for r in rows} == {"Анна", "Виктор"}


async def test_list_q_combines_with_filters_and(db_session) -> None:
    """q ANDs with filters= — intersection, not union."""
    db_session.add(_master(first_name="Анна", position="мастер"))
    db_session.add(_master(first_name="Анна", position="senior"))
    db_session.add(_master(first_name="Борис", position="мастер"))
    await db_session.flush()
    repo = get_base_repository()
    rows, total = await repo.list(
        db_session,
        Master,
        filters={"position": "мастер"},
        q="анн",
        search_fields=_master_search_fields,
        limit=100,
    )
    assert total == 1
    assert rows[0].first_name == "Анна"
    assert rows[0].position == "мастер"


async def test_list_q_without_search_fields_raises(db_session) -> None:
    """q with search_fields=None (or empty) raises ValueError — fail-fast guard."""
    db_session.add(_master(first_name="A"))
    await db_session.flush()
    repo = get_base_repository()
    with pytest.raises(ValueError, match="search_fields"):
        await repo.list(db_session, Master, q="A")
    with pytest.raises(ValueError, match="search_fields"):
        await repo.list(db_session, Master, q="A", search_fields=[])


async def test_list_q_full_uuid_matches_by_id(db_session) -> None:
    """A full-UUID q (any case) matches by id, normalized to stored lowercase."""
    target = _master(first_name="Target")
    db_session.add(target)
    db_session.add(_master(first_name="Other"))
    await db_session.flush()
    repo = get_base_repository()
    fields = _master_search_fields + [SearchField(Master.id, kind="uuid")]
    rows, total = await repo.list(
        db_session, Master, q=target.id.upper(), search_fields=fields, limit=100
    )
    assert total == 1
    assert rows[0].id == target.id


async def test_list_q_absent_behavior_unchanged(db_session) -> None:
    """q absent → no predicate, even when search_fields is passed."""
    for name in ("A", "B", "C"):
        db_session.add(_master(first_name=name))
    await db_session.flush()
    repo = get_base_repository()
    rows, total = await repo.list(
        db_session, Master, search_fields=_master_search_fields, limit=100
    )
    assert total == 3
    assert len(rows) == 3


# ─── q / search_fields on ArchiveRepository.list (GH #212) ──────────────────────


async def test_archive_list_q_narrows_within_status(db_session) -> None:
    """q ANDs with the archive-status predicate; total reflects both."""
    db_session.add(_master(first_name="Анна"))
    db_session.add(_master(first_name="Анна", is_active=False))
    db_session.add(_master(first_name="Борис"))
    await db_session.flush()
    repo = get_archive_repository()
    rows, total = await repo.list(
        db_session,
        Master,
        q="анн",
        search_fields=_master_search_fields,
        limit=100,
    )
    assert total == 1  # archived "Анна" excluded by status, "Борис" by q
    assert [r.first_name for r in rows] == ["Анна"]
    assert rows[0].is_active is True


async def test_archive_list_q_without_search_fields_raises(db_session) -> None:
    """q with no search_fields raises ValueError on the archive path too."""
    db_session.add(_master(first_name="A"))
    await db_session.flush()
    repo = get_archive_repository()
    with pytest.raises(ValueError, match="search_fields"):
        await repo.list(db_session, Master, q="A")
