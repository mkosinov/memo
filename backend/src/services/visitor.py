"""Business logic for visitor CRUD operations."""

from functools import lru_cache

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.generic import BaseRepository, get_base_repository
from src.models.photo import Photo
from src.models.visit import Visit
from src.models.visitor import Visitor
from src.schemas.visitor import VisitorCreate, VisitorResponse, VisitorUpdate
from src.services.generic import GenericService
from src.services.decorators import transactional


class VisitorService(GenericService[VisitorCreate, VisitorUpdate, VisitorResponse]):
    """Visitor service with client-based filtering."""

    NOT_NULL_FIELDS = {"name"}

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

    @transactional
    async def delete(self, db_session: AsyncSession, id: str) -> bool:
        """Hard-delete a visitor and its visits; unlink photos (SET NULL).

        All cascade deletes run as explicit SQL inside this single
        ``@transactional`` transaction so the unit is atomic. Visits are
        removed BEFORE the visitor (visits.reference visitors via FK).
        Photos are unlinked (visitor_id := NULL) rather than deleted —
        a photo survives losing its depicted visitor (#194, G1b).
        """
        visitor = await self._repository.get(db_session, Visitor, id)
        if not visitor:
            return False

        await db_session.execute(delete(Visit).where(Visit.visitor_id == id))
        await db_session.execute(update(Photo).where(Photo.visitor_id == id).values(visitor_id=None))
        await db_session.execute(delete(Visitor).where(Visitor.id == id))
        return True


@lru_cache
def get_visitor_service() -> VisitorService:
    """Returns a singleton VisitorService."""
    return VisitorService(get_base_repository(), Visitor)
