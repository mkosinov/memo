"""Rename contract tests for ArchiveRepository (GH #207, Task 2).

Asserts the repository rename + delete=hard inheritance contract:
  - The class is named ``ArchiveRepository`` (renamed from ``SoftDeleteRepository``).
  - ``delete`` is NOT overridden in ``ArchiveRepository`` — it is inherited
    UNMODIFIED from ``BaseRepository.delete`` (hard delete).

Companion to ``test_soft_delete_repository.py`` which covers the ``list()``
archive-status filter override that ``ArchiveRepository`` still keeps (and the
``reorder()`` is_active-aware override, also unchanged).

Spec: docs/specs/2026-08-15-delete-hard-delete-and-dependency-resolution-design.md
§3.3 (Repository), §9 (Rename), §14 (rename AC).
"""

from __future__ import annotations

import src.repositories.generic as generic
from src.repositories.generic import BaseRepository


def test_archive_repository_is_named_archive_repository() -> None:
    """Class renamed SoftDeleteRepository -> ArchiveRepository (spec §9, §14)."""
    assert hasattr(generic, "ArchiveRepository"), (
        "ArchiveRepository class must exist (renamed from SoftDeleteRepository)"
    )
    assert generic.ArchiveRepository.__name__ == "ArchiveRepository"


def test_archive_repository_does_not_override_delete() -> None:
    """delete is inherited UNMODIFIED from BaseRepository (spec §3.3, §14).

    ArchiveRepository must NOT declare its own ``delete`` method — the soft-
    delete override (set is_active=False) was removed; hard delete is inherited
    from BaseRepository. This is the contract that flows into Task 12 (contract
    delete_semantics flip).
    """
    assert hasattr(generic, "ArchiveRepository"), (
        "ArchiveRepository class must exist (renamed from SoftDeleteRepository)"
    )
    archive_repo = generic.ArchiveRepository
    # No own ``delete`` declared on ArchiveRepository (hard delete inherited).
    assert "delete" not in archive_repo.__dict__
    # And the resolved attribute IS BaseRepository.delete (identical function).
    assert archive_repo.delete is BaseRepository.delete