"""Business logic for visitor CRUD operations."""

from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.visitor import Visitor
from app.domain.visitors.schemas import VisitorCreate, VisitorUpdate


class VisitorService:
    """Handles visitor entity operations."""

    def __init__(self) -> None:
        pass

    async def list_by_client(self, db_session: AsyncSession, client_id: str) -> list[Visitor]:
        """Return all active visitors for a given client."""
        result = await db_session.execute(
            select(Visitor).where(
                Visitor.client_id == client_id,
                Visitor.is_active,
            )
        )
        return list(result.scalars().all())

    async def get_by_id(self, db_session: AsyncSession, visitor_id: str) -> Visitor | None:
        """Return a visitor by ID, or None if not found."""
        result = await db_session.execute(
            select(Visitor).where(Visitor.id == visitor_id)
        )
        return result.scalar_one_or_none()

    async def create(self, db_session: AsyncSession, data: VisitorCreate) -> Visitor:
        """Create a new visitor and persist it."""
        visitor = Visitor(**data.model_dump())
        db_session.add(visitor)
        await db_session.flush()
        await db_session.refresh(visitor)
        return visitor

    async def update(self, db_session: AsyncSession, visitor_id: str, data: VisitorUpdate) -> Visitor | None:
        """Full-update a visitor by ID. Returns None if not found."""
        visitor = await self.get_by_id(db_session=db_session, visitor_id=visitor_id)
        if not visitor:
            return None
        for key, value in data.model_dump().items():
            setattr(visitor, key, value)
        await db_session.flush()
        await db_session.refresh(visitor)
        return visitor

    async def delete(self, db_session: AsyncSession, visitor_id: str) -> bool:
        """Soft-delete a visitor (set is_active=False). Returns False if not found."""
        visitor = await self.get_by_id(db_session=db_session, visitor_id=visitor_id)
        if not visitor:
            return False
        visitor.is_active = False
        await db_session.flush()
        return True


@lru_cache
def get_visitor_service() -> VisitorService:
    """Returns a singleton VisitorService."""
    return VisitorService()
