"""Unit tests for ArchiveRepository.list() archive-status filtering + pagination (GH #206).

Covers the ``status`` parameter which replaces the old ``include_inactive``
bool:
  - ArchiveStatus.ACTIVE  (default) → only is_active=True rows
  - ArchiveStatus.ARCHIVED            → only is_active=False rows
  - ArchiveStatus.ALL                 → both active and archived rows

The paginated ``list`` returns ``(rows, total)`` — ``total`` is the count of
rows matching the status filter, ``rows`` is the limit/offset slice.
Uses Staff (a soft-delete model since GH #266) and drives ArchiveRepository.list
directly — no HTTP layer.
"""

from __future__ import annotations

import pytest

from src.models.enums import ArchiveStatus
from src.models.staff import Staff
from src.repositories.generic import get_archive_repository

pytestmark = pytest.mark.asyncio


# ─── Helpers ────────────────────────────────────────────────────────────────────


async def _seed_masters(db_session, n_active: int, n_archived: int) -> None:
    """Insert ``n_active`` active staff cards and ``n_archived`` archived ones.

    GH #266: the people table is ``staff`` (names + person-archive flag);
    ``StaffService`` lists through the Staff model. The master extension
    row is irrelevant to is_active filtering and is omitted."""
    for i in range(n_active):
        db_session.add(Staff(first_name=f"A{i}", last_name="T"))
    for i in range(n_archived):
        db_session.add(Staff(first_name=f"X{i}", last_name="T", is_active=False))
    await db_session.flush()


# ─── ArchiveStatus filtering ───────────────────────────────────────────────────


async def test_list_active_returns_only_active_masters(db_session) -> None:
    """status=ACTIVE (default) excludes archived rows."""
    await _seed_masters(db_session, n_active=2, n_archived=1)
    repo = get_archive_repository()
    rows, total = await repo.list(
        db_session, Staff, status=ArchiveStatus.ACTIVE, limit=100
    )
    assert total == 2
    assert len(rows) == 2
    assert all(m.is_active for m in rows)


async def test_list_archived_returns_only_archived_masters(db_session) -> None:
    """status=ARCHIVED returns only is_active=False rows (new capability)."""
    await _seed_masters(db_session, n_active=2, n_archived=3)
    repo = get_archive_repository()
    rows, total = await repo.list(
        db_session, Staff, status=ArchiveStatus.ARCHIVED, limit=100
    )
    assert total == 3
    assert len(rows) == 3
    assert all(not m.is_active for m in rows)


async def test_list_all_returns_both_active_and_archived(db_session) -> None:
    """status=ALL returns every row regardless of is_active."""
    await _seed_masters(db_session, n_active=2, n_archived=2)
    repo = get_archive_repository()
    rows, total = await repo.list(
        db_session, Staff, status=ArchiveStatus.ALL, limit=100
    )
    assert total == 4
    assert len(rows) == 4
    actives = [m for m in rows if m.is_active]
    archived = [m for m in rows if not m.is_active]
    assert len(actives) == 2
    assert len(archived) == 2


async def test_list_default_status_is_active(db_session) -> None:
    """Omitting status defaults to ACTIVE (back-compat: active only)."""
    await _seed_masters(db_session, n_active=2, n_archived=1)
    repo = get_archive_repository()
    rows, total = await repo.list(db_session, Staff)
    assert total == 2
    assert len(rows) == 2
    assert all(m.is_active for m in rows)
