"""Business logic for visitor CRUD operations."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.visitor import Visitor
from app.domain.visitors.schemas import VisitorCreate, VisitorUpdate


class VisitorService:
    """Handles visitor entity operations."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_by_client(self, client_id: str) -> list[Visitor]:
        """Return all active visitors for a given client."""
        result = await self._session.execute(
            select(Visitor).where(
                Visitor.client_id == client_id,
                Visitor.is_active,
            )
        )
        return list(result.scalars().all())

    async def get_by_id(self, visitor_id: str) -> Visitor | None:
        """Return a visitor by ID, or None if not found."""
        result = await self._session.execute(
            select(Visitor).where(Visitor.id == visitor_id)
        )
        return result.scalar_one_or_none()

    async def create(self, data: VisitorCreate) -> Visitor:
        """Create a new visitor and persist it."""
        visitor = Visitor(**data.model_dump())
        self._session.add(visitor)
        await self._session.flush()
        await self._session.refresh(visitor)
        return visitor

    async def update(self, visitor_id: str, data: VisitorUpdate) -> Visitor | None:
        """Full-update a visitor by ID. Returns None if not found."""
        visitor = await self.get_by_id(visitor_id)
        if not visitor:
            return None
        for key, value in data.model_dump().items():
            setattr(visitor, key, value)
        await self._session.flush()
        await self._session.refresh(visitor)
        return visitor

    async def delete(self, visitor_id: str) -> bool:
        """Soft-delete a visitor (set is_active=False). Returns False if not found."""
        visitor = await self.get_by_id(visitor_id)
        if not visitor:
            return False
        visitor.is_active = False
        await self._session.flush()
        return True
