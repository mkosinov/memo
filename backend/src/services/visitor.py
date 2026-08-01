"""Business logic for visitor CRUD operations."""

from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.generic import BaseRepository, get_base_repository
from src.models.visitor import Visitor
from src.schemas.visitor import VisitorCreate, VisitorResponse, VisitorUpdate
from src.services.generic import GenericService


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


@lru_cache
def get_visitor_service() -> VisitorService:
    """Returns a singleton VisitorService."""
    return VisitorService(get_base_repository(), Visitor)
