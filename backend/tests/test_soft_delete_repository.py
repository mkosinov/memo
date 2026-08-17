"""Unit tests for SoftDeleteRepository.list() archive-status filtering (GH #195).

Covers the ``status`` parameter which replaces the old ``include_inactive``
bool:
  - ArchiveStatus.ACTIVE  (default) → only is_active=True rows
  - ArchiveStatus.ARCHIVED            → only is_active=False rows
  - ArchiveStatus.ALL                 → both active and archived rows

Uses Master (a soft-delete model) and drives SoftDeleteRepository.list
directly — no HTTP layer.
"""

from __future__ import annotations

import pytest

from src.models.enums import ArchiveStatus
from src.models.master import Master
from src.repositories.generic import get_archive_repository

pytestmark = pytest.mark.asyncio


# ─── Helpers ────────────────────────────────────────────────────────────────────


async def _seed_masters(db_session, n_active: int, n_archived: int) -> None:
    """Insert ``n_active`` active Masters and ``n_archived`` archived Masters."""
    for i in range(n_active):
        db_session.add(
            Master(
                first_name=f"A{i}",
                last_name="T",
                color="#000000",
                position="мастер",
                specialty="живопись",
            )
        )
    for i in range(n_archived):
        db_session.add(
            Master(
                first_name=f"X{i}",
                last_name="T",
                color="#111111",
                position="мастер",
                specialty="живопись",
                is_active=False,
            )
        )
    await db_session.flush()


# ─── ArchiveStatus filtering ───────────────────────────────────────────────────


async def test_list_active_returns_only_active_masters(db_session) -> None:
    """status=ACTIVE (default) excludes archived rows."""
    await _seed_masters(db_session, n_active=2, n_archived=1)
    repo = get_archive_repository()
    rows = await repo.list(db_session, Master, status=ArchiveStatus.ACTIVE)
    assert len(rows) == 2
    assert all(m.is_active for m in rows)


async def test_list_archived_returns_only_archived_masters(db_session) -> None:
    """status=ARCHIVED returns only is_active=False rows (new capability)."""
    await _seed_masters(db_session, n_active=2, n_archived=3)
    repo = get_archive_repository()
    rows = await repo.list(db_session, Master, status=ArchiveStatus.ARCHIVED)
    assert len(rows) == 3
    assert all(not m.is_active for m in rows)


async def test_list_all_returns_both_active_and_archived(db_session) -> None:
    """status=ALL returns every row regardless of is_active."""
    await _seed_masters(db_session, n_active=2, n_archived=2)
    repo = get_archive_repository()
    rows = await repo.list(db_session, Master, status=ArchiveStatus.ALL)
    assert len(rows) == 4
    actives = [m for m in rows if m.is_active]
    archived = [m for m in rows if not m.is_active]
    assert len(actives) == 2
    assert len(archived) == 2


async def test_list_default_status_is_active(db_session) -> None:
    """Omitting status defaults to ACTIVE (back-compat: active only)."""
    await _seed_masters(db_session, n_active=2, n_archived=1)
    repo = get_archive_repository()
    rows = await repo.list(db_session, Master)
    assert len(rows) == 2
    assert all(m.is_active for m in rows)
