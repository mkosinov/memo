"""Client persistence — owner repository for the clients table (GH #327 T3).

Canon (docs/domain-rules/service-layer.md, rules 1 and 4): the ONLY home of
tabular commands for clients — INCLUDING the client's OWN child link rows.
The ``client_tags`` join table has no lifecycle of its own and belongs to
the clients side (canon rule 1: own child link rows are served by the
owner), so its bulk delete lives HERE, not in the tag repository.
Commands filter on the edge's own column (``client_tags.client_id``) and
run as ONE set-based statement. Called only by ClientService methods.
"""

from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING

from sqlalchemy import delete

from src.models.tag import client_tags
from src.repositories.generic import ArchiveRepository

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


class ClientRepository(ArchiveRepository):
    """Repository for clients — plus the own-edge client_tags bulk command."""

    async def delete_tags_by_client_id(self, session: AsyncSession, client_id: str) -> None:
        """Remove ALL client_tags links of one client in a single DELETE.

        Set-based bulk command (canon rule 4): one
        ``DELETE FROM client_tags WHERE client_id = :client_id`` — no
        per-row loop. The join table's FKs carry NO ondelete action, so the
        links must go BEFORE the client row (#194). Does NOT commit — the
        caller's transaction owns the commit boundary.
        """
        await session.execute(delete(client_tags).where(client_tags.c.client_id == client_id))


@lru_cache
def get_client_repository() -> ClientRepository:
    """Return a singleton ClientRepository."""
    return ClientRepository()
