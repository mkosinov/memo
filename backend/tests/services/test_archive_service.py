"""Service-layer rename + archive/restore contract tests (GH #207, Task 3).

Asserts the service-layer archive base rename and the new
``archive()`` / ``restore()`` bool contract:

  * ``ArchiveService`` class exists (renamed from the prior soft-delete base).
  * ``ArchiveService`` exposes ``archive`` and ``restore`` methods.
  * ``archive()`` flips ``is_active`` to ``False``; ``restore()`` flips it
    back to ``True`` (round trip via a representative subclass, Master).
  * Both methods return ``False`` for a nonexistent id (no row, no exception).

The class still inherits hard ``delete`` from ``GenericService`` (which in
turn inherits from ``BaseRepository``) — the soft-delete contract flip is
Task 12's scope; these tests only pin the new archive/restore surface.

Spec: docs/specs/2026-08-15-delete-hard-delete-and-dependency-resolution-design.md
§3.4 (Service), §9 (Rename), §14 (rename AC).
"""

from __future__ import annotations

from src.models.master import Master
from src.services.generic import ArchiveService
from src.services.master import get_master_service


# ─── Class surface ───────────────────────────────────────────────────────────────


def test_archive_service_exposes_archive_and_restore_methods() -> None:
    """The archive base declares archive/restore (spec §3.4, §9)."""
    assert hasattr(ArchiveService, "archive"), (
        "ArchiveService must expose an `archive` method (spec §3.4, §9)"
    )
    assert hasattr(ArchiveService, "restore"), (
        "ArchiveService must expose a `restore` method (spec §3.4, §9)"
    )


# ─── Round trip + bool contract ────────────────────────────────────────────────


async def test_archive_then_restore_flips_is_active_round_trip(db_session) -> None:
    """archive() sets is_active=False; restore() sets it back to True.

    Exercises the methods through a representative subclass (``MasterService``)
    rather than the abstract ``ArchiveService`` base, so the inheritance
    wiring is also covered.
    """
    master = Master(
        first_name="A",
        last_name="B",
        color="#000000",
        position="мастер",
        specialty="живопись",
    )
    db_session.add(master)
    await db_session.flush()
    master_id = master.id

    service = get_master_service()

    # archive → is_active=False, returns True
    archived_ok = await service.archive(db_session, master_id)
    assert archived_ok is True, (
        f"archive({master_id!r}) returned {archived_ok!r}, expected True"
    )
    db_session.expire_all()
    archived_row = await db_session.get(Master, master_id)
    assert archived_row is not None, "row vanished after archive"
    assert archived_row.is_active is False, (
        f"after archive: is_active={archived_row.is_active!r}, expected False"
    )

    # restore → is_active=True, returns True
    restored_ok = await service.restore(db_session, master_id)
    assert restored_ok is True, (
        f"restore({master_id!r}) returned {restored_ok!r}, expected True"
    )
    db_session.expire_all()
    restored_row = await db_session.get(Master, master_id)
    assert restored_row is not None, "row vanished after restore"
    assert restored_row.is_active is True, (
        f"after restore: is_active={restored_row.is_active!r}, expected True"
    )


async def test_archive_nonexistent_returns_false(db_session) -> None:
    """archive(nonexistent-id) → False (no row, no exception)."""
    service = get_master_service()
    assert await service.archive(db_session, "nonexistent-id") is False


async def test_restore_nonexistent_returns_false(db_session) -> None:
    """restore(nonexistent-id) → False (no row, no exception)."""
    service = get_master_service()
    assert await service.restore(db_session, "nonexistent-id") is False