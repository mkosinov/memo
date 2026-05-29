"""Business logic for tag CRUD operations."""

from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.tag import Tag
from app.domain.tags.schemas import TagCreate


class TagService:
    """Handles tag entity operations."""

    def __init__(self) -> None:
        pass

    async def list_all(self, db_session: AsyncSession) -> list[Tag]:
        """Return all active tags."""
        result = await db_session.execute(select(Tag).where(Tag.is_active))
        return list(result.scalars().all())

    async def create(self, db_session: AsyncSession, data: TagCreate) -> Tag:
        """Create a new tag and persist it."""
        tag = Tag(**data.model_dump())
        db_session.add(tag)
        await db_session.flush()
        await db_session.refresh(tag)
        return tag


@lru_cache
def get_tag_service() -> TagService:
    """Returns a singleton TagService."""
    return TagService()
