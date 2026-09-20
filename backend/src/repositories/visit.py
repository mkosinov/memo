"""Visit persistence — owner repository for the visits table (GH #171 T1).

Canon (docs/domain-rules/service-layer.md, rules 1 and 4): the ONLY home of
tabular commands for visits. Bulk commands filter on the entity's OWN
reference column (``visits.record_id``) and run as ONE set-based statement —
never a Python loop over rows. Called only by VisitService methods.
"""

from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING, TypeVar

from sqlalchemy import delete

from src.models.visit import Visit
from src.repositories.generic import BaseRepository

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

VisitT = TypeVar("VisitT", bound=Visit)


class VisitRepository(BaseRepository):
    """Repository for visits — plus bulk-by-record commands (delete + insert)."""

    async def delete_by_record_id(self, session: AsyncSession, record_id: str) -> None:
        """Remove ALL visits of one record in a single DELETE statement.

        Set-based bulk command (canon rule 4): one
        ``DELETE FROM visits WHERE record_id = :record_id`` — no per-row
        loop. Does NOT commit — the caller's transaction owns the commit
        boundary.
        """
        await session.execute(delete(Visit).where(Visit.record_id == record_id))

    async def create_bulk(self, session: AsyncSession, visits: list[VisitT]) -> None:
        """Insert a BATCH of visits as one bulk INSERT (canon rule 4).

        ``session.add_all`` + one flush lets SQLAlchemy's insertmanyvalues
        emit a single multi-row INSERT — no per-row execute loop. Does NOT
        commit — the caller's transaction owns the commit boundary.
        """
        session.add_all(visits)
        await session.flush()


@lru_cache
def get_visit_repository() -> VisitRepository:
    """Return a singleton VisitRepository."""
    return VisitRepository()
