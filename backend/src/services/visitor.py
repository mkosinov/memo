"""Business logic for visitor CRUD operations."""

from functools import lru_cache

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.tag import visitor_tags
from src.models.visit import Visit
from src.models.visitor import Visitor
from src.repositories.generic import BaseRepository, get_base_repository
from src.repositories.search import SearchField
from src.schemas.visitor import VisitorCreate, VisitorResponse, VisitorUpdate
from src.services.decorators import transactional
from src.services.generic import GenericService


class VisitorService(GenericService[VisitorCreate, VisitorUpdate, VisitorResponse]):
    """Visitor service with client-based filtering."""

    NOT_NULL_FIELDS = {"name"}

    # GH #212 search matrix (spec §5.2): substring on ``name``, exact id
    # equality when q parses as a full UUID (deep-link prerequisite #216).
    search_fields = [SearchField(Visitor.name), SearchField(Visitor.id, kind="uuid")]

    def __init__(
        self, repository: BaseRepository, model: type[Visitor]
    ) -> None:
        super().__init__(repository, model, response_schema=VisitorResponse)

    async def list_by_client(
        self, db_session: AsyncSession, client_id: str
    ) -> list[Visitor]:
        """Return all visitors for a given client."""
        result = await db_session.execute(
            select(Visitor).where(Visitor.client_id == client_id)
        )
        return list(result.scalars().all())

    async def _delete_cascade(self, db_session: AsyncSession, visitor_id: str) -> bool:
        """Hard-delete a visitor and its visits; delete visitor_tags join
        rows — on the GIVEN session, WITHOUT committing.

        Extracted (Task 7 of #207) from ``delete`` so ``ClientService`` can call
        this inside its OWN ``@transactional`` outer cascade loop on a SHARED
        session — atomicity with ONE commit at the outer boundary, not N
        mid-loop commits (§8 atomicity requirement — BLOCKER-class).

        All cascade deletes run as explicit SQL inside the caller's transaction.
        Visits are removed BEFORE the visitor (visits reference visitors via FK).
        The visitor_tags join table has FKs with NO ondelete action, so its rows
        must be removed BEFORE the visitor — otherwise the DB raises
        IntegrityError (FK on) or leaves orphan rows (FK off). Photos are NOT
        touched: since GH #211 a photo is never visitor-owned (4-owner model:
        client|service|activity|location).

        Returns False if the visitor does not exist. Does NOT commit — the
        caller owns the transaction boundary.
        """
        visitor = await self._repository.get(db_session, Visitor, visitor_id)
        if not visitor:
            return False

        await db_session.execute(delete(Visit).where(Visit.visitor_id == visitor_id))
        await db_session.execute(delete(visitor_tags).where(visitor_tags.c.visitor_id == visitor_id))
        await db_session.execute(delete(Visitor).where(Visitor.id == visitor_id))
        return True

    @transactional
    async def delete(self, db_session: AsyncSession, id: str) -> bool:
        """Hard-delete a visitor and cascade (visits, visitor_tags) inside one
        ``@transactional`` transaction.

        Thin decorated wrapper around the non-decorated ``_delete_cascade``
        core (Task 7 of #207) so standalone ``VisitorService.delete`` still
        commits exactly as before — existing callers are unaffected.
        ``ClientService`` reuses ``_delete_cascade`` directly on a shared outer
        session (Task 10) keeping the Client→visitors cascade atomic.
        """
        return await self._delete_cascade(db_session, id)


@lru_cache
def get_visitor_service() -> VisitorService:
    """Returns a singleton VisitorService."""
    return VisitorService(get_base_repository(), Visitor)
