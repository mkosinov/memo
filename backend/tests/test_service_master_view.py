"""list_masters_view / list_all_masters_view — masters view free functions.

Service-level contract tests for the masters view reads (GH #217 Task 2,
Corridor 3 free functions in the masters view module — ADR 007 / canon
rule 8), rebound from the former ``MasterViewService`` methods (behavior
unchanged):

- paginated envelope rides ``BaseRepository.list_custom`` (order arrives
  as a PARAMETER — the statement carries no baked order/limit);
- COUNT EQUIVALENCE GATE (spec §3 п.3): ``list_custom``'s subquery count
  equals the former handwritten ``func.count() over Staff INNER JOIN
  Master`` — the join is one-to-one (staff_id PK), so no row
  duplication; pinned by a separate test;
- archive statuses (#267: active/archived/all) survive as a parameter in
  BOTH functions;
- the flat ``/all`` list keeps its function-side ``BARE_LIST_MAX_ROWS +
  1`` probe → ``BareListLimitExceededError`` (#205 — the list mechanics
  don't provide the guard).
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import asc, func, insert, select

from src.domain.errors import BareListLimitExceededError
from src.models.enums import ArchiveStatus
from src.models.master import Master
from src.models.staff import Staff
from src.schemas.common import PaginatedResponse
from src.services.generic import BARE_LIST_MAX_ROWS
from src.services.master import list_all_masters_view, list_masters_view
from tests.conftest import query_db

pytestmark = pytest.mark.asyncio

_ORDER = [asc(Staff.first_name), asc(Staff.id)]


def _archive_master(staff_id: str) -> None:
    """Flip the master extension's schedule flag (masters.is_active=0)."""
    query_db(f"UPDATE masters SET is_active=0 WHERE staff_id='{staff_id}'")


# ─── Paginated view ────────────────────────────────────────────────────────


async def test_paginated_returns_active_only_ordered(db_session, create_master):
    anna = create_master(first_name="Anna")
    boris = create_master(first_name="Boris")
    archived = create_master(first_name="Cyril")
    _archive_master(archived["id"])

    page = await list_masters_view(db_session, page=1, per_page=20, order_by=_ORDER)

    assert isinstance(page, PaginatedResponse)
    assert page.total == 2
    assert [m.id for m in page.items] == [anna["id"], boris["id"]]
    assert all(m.archived is False for m in page.items)


async def test_paginated_slice_page_two(db_session, create_master):
    anna = create_master(first_name="Anna")
    boris = create_master(first_name="Boris")

    first = await list_masters_view(db_session, page=1, per_page=1, order_by=_ORDER)
    second = await list_masters_view(db_session, page=2, per_page=1, order_by=_ORDER)

    assert first.total == second.total == 2
    assert [m.id for m in first.items] == [anna["id"]]
    assert [m.id for m in second.items] == [boris["id"]]


@pytest.mark.parametrize(
    ("status", "expected_names"),
    [
        (ArchiveStatus.ACTIVE, ["Anna"]),
        (ArchiveStatus.ARCHIVED, ["Boris"]),
        (ArchiveStatus.ALL, ["Anna", "Boris"]),
    ],
)
async def test_paginated_status_parameter(
    db_session, create_master, status, expected_names
):
    """#267: active/archived/all survive as a parameter in the paginated
    function too (the route keeps the acting-only default)."""
    create_master(first_name="Anna")
    archived = create_master(first_name="Boris")
    _archive_master(archived["id"])

    page = await list_masters_view(
        db_session, page=1, per_page=20, order_by=_ORDER, status=status
    )

    assert [m.first_name for m in page.items] == expected_names
    assert page.total == len(expected_names)


async def test_paginated_count_equivalence_with_handwritten_join(
    db_session, create_master
):
    """COUNT EQUIVALENCE GATE (GH #217 Task 2, spec §3 п.3).

    ``list_custom`` counts via ``select(func.count()).select_from(
    stmt.subquery())`` over the two-column staff ⨝ masters select; the
    former ``MasterViewService.list`` counted by hand over
    ``select(func.count()).select_from(Staff).join(Master, ...).where(
    Master.is_active)``. The join is one-to-one (``masters.staff_id`` is
    the PK), so the subquery projection cannot duplicate rows — this test
    pins that equivalence, including the INNER-join edge (a staff card
    WITHOUT a master extension is excluded from both counts).
    """
    acting1 = create_master(first_name="Anna")
    acting2 = create_master(first_name="Boris")
    archived = create_master(first_name="Cyril")
    _archive_master(archived["id"])
    # Staff card with no master extension — INNER JOIN drops it in BOTH
    # count shapes.
    db_session.add(Staff(first_name="NoExt", last_name="Person"))
    await db_session.flush()

    handwritten_active = (
        await db_session.execute(
            select(func.count())
            .select_from(Staff)
            .join(Master, Master.staff_id == Staff.id)
            .where(Master.is_active)
        )
    ).scalar_one()
    view = await list_masters_view(db_session, page=1, per_page=10, order_by=_ORDER)

    assert handwritten_active == 2
    assert {m.id for m in view.items} == {acting1["id"], acting2["id"]}
    assert view.total == handwritten_active

    handwritten_archived = (
        await db_session.execute(
            select(func.count())
            .select_from(Staff)
            .join(Master, Master.staff_id == Staff.id)
            .where(Master.is_active.is_(False))
        )
    ).scalar_one()
    archived_view = await list_masters_view(
        db_session, page=1, per_page=10, order_by=_ORDER,
        status=ArchiveStatus.ARCHIVED,
    )
    assert handwritten_archived == 1
    assert archived_view.total == handwritten_archived


# ─── Flat /all view ────────────────────────────────────────────────────────


async def test_list_all_returns_flat_list_ordered(db_session, create_master):
    anna = create_master(first_name="Anna")
    boris = create_master(first_name="Boris")

    items = await list_all_masters_view(db_session, order_by=_ORDER)

    assert isinstance(items, list)
    assert [m.id for m in items] == [anna["id"], boris["id"]]
    assert items[0].specialty == "живопись"
    assert items[0].color == "#5B8C7A"


@pytest.mark.parametrize(
    ("status", "expected_names"),
    [
        (ArchiveStatus.ACTIVE, ["Anna"]),
        (ArchiveStatus.ARCHIVED, ["Boris"]),
        (ArchiveStatus.ALL, ["Anna", "Boris"]),
    ],
)
async def test_list_all_status_parameter(
    db_session, create_master, status, expected_names
):
    """#267: active/archived/all survive as the flat list's parameter."""
    create_master(first_name="Anna")
    archived = create_master(first_name="Boris")
    _archive_master(archived["id"])

    items = await list_all_masters_view(db_session, order_by=_ORDER, status=status)

    assert [m.first_name for m in items] == expected_names
    assert all(
        (m.archived is False) == (m.first_name == "Anna") for m in items
    )


def _bulk_master_rows(n: int) -> tuple[list[dict], list[dict]]:
    """``n`` staff + master extension row dicts for bulk ``insert()``.

    Explicit ids/timestamps/is_active: bulk insert with a list of dicts
    does not reliably fire Python-side column defaults.
    """
    now = datetime.now(UTC)
    staff_rows = [
        {
            "id": f"{i:010d}-0000-4000-8000-000000000000",
            "first_name": f"bulk-{i:05d}",
            "last_name": "Master",
            "is_active": True,
            "sort_order": i,
            "created_at": now,
            "updated_at": now,
        }
        for i in range(n)
    ]
    master_rows = [
        {
            "staff_id": r["id"],
            "specialty": "живопись",
            "color": "#5B8C7A",
            "is_active": True,
            "created_at": now,
            "updated_at": now,
        }
        for r in staff_rows
    ]
    return staff_rows, master_rows


async def test_list_all_over_limit_raises(db_session):
    """>1000 masters → BareListLimitExceededError (#205 guard, function-side)."""
    staff_rows, master_rows = _bulk_master_rows(BARE_LIST_MAX_ROWS + 1)
    await db_session.execute(insert(Staff), staff_rows)
    await db_session.execute(insert(Master), master_rows)
    await db_session.commit()

    with pytest.raises(BareListLimitExceededError, match=r"masters.*1000"):
        await list_all_masters_view(db_session, order_by=_ORDER)


async def test_list_all_boundary_exactly_limit_ok(db_session):
    """Exactly 1000 masters → flat list returns them (no raise)."""
    staff_rows, master_rows = _bulk_master_rows(BARE_LIST_MAX_ROWS)
    await db_session.execute(insert(Staff), staff_rows)
    await db_session.execute(insert(Master), master_rows)
    await db_session.commit()

    items = await list_all_masters_view(db_session, order_by=_ORDER)
    assert len(items) == BARE_LIST_MAX_ROWS
