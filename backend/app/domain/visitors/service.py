"""Business logic for visitor CRUD operations."""

from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.visitor import Visitor
from app.db.repository import GenericRepository, get_repository
from app.domain.base import GenericService
from app.domain.visitors.schemas import VisitorCreate, VisitorUpdate


class VisitorService(GenericService[Visitor, VisitorCreate, VisitorUpdate]):
    """Visitor service with client-based filtering."""

    def __init__(
        self, repository: GenericRepository, model: type[Visitor]
    ) -> None:
        super().__init__(repository, model)

    async def list_by_client(
        self, db_session: AsyncSession, client_id: str
    ) -> list[Visitor]:
        """Return all active visitors for a given client."""
        result = await db_session.execute(
            select(Visitor).where(
                Visitor.client_id == client_id,
                Visitor.is_active,
            )
        )
        return list(result.scalars().all())


@lru_cache
def get_visitor_service() -> VisitorService:
    """Returns a singleton VisitorService."""
    return VisitorService(get_repository(), Visitor)
