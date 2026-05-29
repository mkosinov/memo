"""Business logic for tag CRUD operations."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.tag import Tag
from app.domain.tags.schemas import TagCreate


class TagService:
    """Handles tag entity operations."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_all(self) -> list[Tag]:
        """Return all active tags."""
        result = await self._session.execute(select(Tag).where(Tag.is_active))
        return list(result.scalars().all())

    async def create(self, data: TagCreate) -> Tag:
        """Create a new tag and persist it."""
        tag = Tag(**data.model_dump())
        self._session.add(tag)
        await self._session.flush()
        await self._session.refresh(tag)
        return tag
