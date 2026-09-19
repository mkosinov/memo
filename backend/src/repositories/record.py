"""Record persistence — owner repository for the records table (GH #171 T1).

Canon (docs/domain-rules/service-layer.md, rules 1 and 4): the ONLY home of
tabular commands for records — INCLUDING the record's OWN child link rows.
The ``record_tags`` join table has no lifecycle of its own and belongs to the
records side (canon rule 1: «связки record_tags — сервис записей»), so its
bulk delete lives HERE, not in the tag repository. Commands filter on the
edge's own column (``record_tags.record_id``) and run as ONE set-based
statement. Called only by RecordService methods.
"""

from __future__ import annotations

from functools import lru_cache

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.tag import record_tags
from src.repositories.generic import BaseRepository


class RecordRepository(BaseRepository):
    """Repository for records — plus the own-edge record_tags bulk command."""

    async def delete_tags_by_record_id(self, session: AsyncSession, record_id: str) -> None:
        """Remove ALL record_tags links of one record in a single DELETE.

        Set-based bulk command (canon rule 4): one
        ``DELETE FROM record_tags WHERE record_id = :record_id`` — no
        per-row loop. The join table's FKs carry NO ondelete action, so the
        links must go BEFORE the record row (#194). Does NOT commit — the
        caller's transaction owns the commit boundary.
        """
        await session.execute(delete(record_tags).where(record_tags.c.record_id == record_id))


@lru_cache
def get_record_repository() -> RecordRepository:
    """Return a singleton RecordRepository."""
    return RecordRepository()
