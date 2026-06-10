"""Business logic for photo CRUD operations."""

from __future__ import annotations

from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.models.photo import Photo
from src.models.tag import Tag
from src.repositories.generic import get_generic_repository
from src.schemas.photo import PhotoCreate, PhotoResponse, PhotoUpdate
from src.services.generic import GenericService


class PhotoService(GenericService[PhotoCreate, PhotoUpdate, PhotoResponse]):
    """Extended photo service with tag handling."""

    async def create(
        self, db_session: AsyncSession, data: PhotoCreate
    ) -> PhotoResponse:
        """Create a new photo with tags."""
        # Extract tag_ids before creating photo
        tag_ids = data.tag_ids if hasattr(data, 'tag_ids') else []
        
        # Create photo without tag_ids
        photo_data = data.model_dump(exclude={'tag_ids'})
        orm = await self._repository.create(db_session, photo_data, Photo)
        
        # Add tags if provided
        if tag_ids:
            result = await db_session.execute(
                select(Tag).where(Tag.id.in_(tag_ids))
            )
            tags = result.scalars().all()
            orm.tags = list(tags)
            await db_session.commit()
            await db_session.refresh(orm)
        
        return self._response_schema.model_validate(orm)

    async def update(
        self, db_session: AsyncSession, id: str, data: PhotoUpdate
    ) -> PhotoResponse | None:
        """Update photo with tags."""
        orm = await self._repository.get(db_session, Photo, id)
        if orm is None:
            return None
        
        # Update basic fields
        update_data = data.model_dump(exclude={'tag_ids'}, exclude_unset=True)
        for key, value in update_data.items():
            setattr(orm, key, value)
        
        # Update tags if provided
        if data.tag_ids is not None:
            result = await db_session.execute(
                select(Tag).where(Tag.id.in_(data.tag_ids))
            )
            tags = result.scalars().all()
            orm.tags = list(tags)
        
        await db_session.commit()
        await db_session.refresh(orm)
        return self._response_schema.model_validate(orm)


@lru_cache
def get_photo_service() -> PhotoService:
    return PhotoService(get_generic_repository(), Photo, PhotoResponse)
