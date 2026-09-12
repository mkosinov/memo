"""Mypy negative-case fixture: ``list_entity`` accepts ONLY entity selects.

NOT a pytest module (leading underscore — never collected). Read by
``test_repository_list.py::test_list_entity_rejects_multi_column_select_under_mypy``,
which runs mypy over this file and asserts the two-column call below is
flagged ``[arg-type]`` — the TypeVar contract of ``list_entity`` routes
multi-column selects to ``list_custom`` at typecheck time (spec §5.1,
GH #213).

Expected output: EXACTLY ONE mypy error — the two-column call, code
``[arg-type]``. The entity-only call above it must stay clean.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.staff import Staff
from src.repositories.generic import get_base_repository


async def check_list_entity_contract(session: AsyncSession) -> None:
    """One valid call, one invalid call — only the invalid one may error."""
    repo = get_base_repository()
    entity_stmt = select(Staff)  # Select[tuple[Staff]] — valid for list_entity
    await repo.list_entity(session, entity_stmt)
    two_col_stmt = select(
        Staff, Staff.first_name.label("name")
    )  # Select[tuple[Master, str]] — multi-column
    await repo.list_entity(session, two_col_stmt)  # MUST be an [arg-type] error
