"""Unit tests for ArchiveService.list() archive-status filtering (GH #195).

Mirrors ``test_soft_delete_repository.py`` but at the SERVICE layer. After
GH #195 the base ``GenericService`` has NO ``is_active`` knowledge — soft-delete
filtering is owned by ``ArchiveService``. The four migrated services
(Master, Location, Material, Client) inherit ``ArchiveService``, so their
``list()`` accepts an explicit ``status: ArchiveStatus`` parameter that:                                                                      

  - ArchiveStatus.ACTIVE  (default) → only is_active=True rows
  - ArchiveStatus.ARCHIVED            → only is_active=False rows
  - ArchiveStatus.ALL                 → both active and archived rows

The ``status`` kwarg MUST be consumed by the ``list()`` signature and never
reach ``**filters`` (which would call ``getattr(Master, "status")`` →
``AttributeError``, since soft-delete models have no ``status`` column).                                                                      

Uses Master (a soft-delete model) and drives ``MasterService.list`` directly
— no HTTP layer.
"""

from __future__ import annotations

import pytest

from src.models.enums import ArchiveStatus
from src.models.staff import Staff
from src.services.master import get_master_service

pytestmark = pytest.mark.asyncio


# ─── Helpers ────────────────────────────────────────────────────────────────────


async def _seed_masters(db_session, n_active: int, n_archived: int) -> None:
    """Insert ``n_active`` active staff cards and ``n_archived`` archived ones.

    GH #266: the people table is ``staff`` (names + person-archive flag);
    ``MasterService`` lists through the Staff model. The master extension
    row is irrelevant to is_active filtering and is omitted."""
    for i in range(n_active):
        db_session.add(Staff(first_name=f"A{i}", last_name="T"))
    for i in range(n_archived):
        db_session.add(Staff(first_name=f"X{i}", last_name="T", is_active=False))
    await db_session.flush()


# ─── ArchiveStatus filtering ───────────────────────────────────────────────────


async def test_list_default_returns_only_active_masters(db_session) -> None:
    """Default call (no status kwarg) excludes archived rows — backward compatible."""
    await _seed_masters(db_session, n_active=2, n_archived=1)
    service = get_master_service()
    result = await service.list(db_session, page=1, per_page=20)
    assert result.total == 2
    assert len(result.items) == 2
    assert all(m.is_active for m in result.items)


async def test_list_status_active_returns_only_active_masters(db_session) -> None:
    """status=ACTIVE (explicit) excludes archived rows from items AND total."""
    await _seed_masters(db_session, n_active=2, n_archived=1)
    service = get_master_service()
    result = await service.list(
        db_session, page=1, per_page=20, status=ArchiveStatus.ACTIVE
    )
    assert result.total == 2
    assert len(result.items) == 2
    assert all(m.is_active for m in result.items)


async def test_list_status_archived_returns_only_archived_masters(db_session) -> None:
    """status=ARCHIVED returns only is_active=False rows (new capability)."""
    await _seed_masters(db_session, n_active=2, n_archived=3)
    service = get_master_service()
    result = await service.list(
        db_session, page=1, per_page=20, status=ArchiveStatus.ARCHIVED
    )
    assert result.total == 3
    assert len(result.items) == 3
    assert all(not m.is_active for m in result.items)


async def test_list_status_all_returns_both_active_and_archived(db_session) -> None:
    """status=ALL returns every row regardless of is_active."""
    await _seed_masters(db_session, n_active=2, n_archived=2)
    service = get_master_service()
    result = await service.list(
        db_session, page=1, per_page=20, status=ArchiveStatus.ALL
    )
    assert result.total == 4
    assert len(result.items) == 4
    actives = [m for m in result.items if m.is_active]
    archived = [m for m in result.items if not m.is_active]
    assert len(actives) == 2
    assert len(archived) == 2


async def test_list_status_does_not_leak_into_filters(db_session) -> None:
    """status must be consumed by the list() signature, not reach **filters.

    If ``status`` leaked into ``**filters`` the filter loop would call
    ``getattr(Staff, "status") == value`` and raise ``AttributeError``
    (Staff has no ``status`` column). Passing an extra real filter
    (``last_name``) alongside ``status`` must work and return the rows
    matching both the archive-status filter and the extra equality filter.
    """
    await _seed_masters(db_session, n_active=2, n_archived=2)
    service = get_master_service()
    result = await service.list(
        db_session,
        page=1,
        per_page=20,
        status=ArchiveStatus.ALL,
        last_name="T",
    )
    # All 4 seeded staff cards share last_name="T" → status=ALL returns both.
    assert result.total == 4
    assert len(result.items) == 4


async def test_list_status_archived_with_extra_filter(db_session) -> None:
    """Extra equality filter narrows archived set; status still consumed separately."""
    await _seed_masters(db_session, n_active=1, n_archived=2)
    # Add one more archived card with a different last_name to prove the
    # equality filter is AND-combined with the archive-status filter.
    db_session.add(Staff(first_name="X-ker", last_name="Keramika", is_active=False))
    await db_session.flush()
    service = get_master_service()
    result = await service.list(
        db_session,
        page=1,
        per_page=20,
        status=ArchiveStatus.ARCHIVED,
        last_name="T",
    )
    # 2 archived last_name="T" cards; the Keramika one is excluded by the filter.
    assert result.total == 2
    assert all(not m.is_active for m in result.items)
    assert all(m.last_name == "T" for m in result.items)