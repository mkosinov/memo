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

    async def list(
        self, db_session: AsyncSession, **filters
    ) -> list[PhotoResponse]:
        """Return all active photos with tags eagerly loaded."""
        stmt = (
            select(Photo)
            .where(Photo.is_active)
            .options(selectinload(Photo.tags))
        )
        result = await db_session.execute(stmt)
        orm_list = result.scalars().all()
        return [self._response_schema.model_validate(o) for o in orm_list]

    async def get(
        self, db_session: AsyncSession, id: str
    ) -> PhotoResponse | None:
        """Return a single photo with tags eagerly loaded."""
        stmt = (
            select(Photo)
            .where(Photo.id == id)
            .options(selectinload(Photo.tags))
        )
        result = await db_session.execute(stmt)
        orm = result.scalar_one_or_none()
        if orm is None:
            return None
        return self._response_schema.model_validate(orm)

    async def create(
        self, db_session: AsyncSession, data: PhotoCreate
    ) -> PhotoResponse:
        """Create a new photo with tags."""
        # Extract tag_ids before creating photo
        tag_ids = data.tag_ids if hasattr(data, 'tag_ids') else []

        # Create ORM instance directly (GenericRepository.create expects BaseModel
        # but PhotoCreate includes tag_ids which Photo doesn't have)
        orm = Photo(
            filename=data.filename,
            visitor_id=data.visitor_id,
            service_id=data.service_id,
            activity_id=data.activity_id,
            is_public=data.is_public,
        )
        db_session.add(orm)
        await db_session.flush()
        await db_session.refresh(orm)

        # Add tags if provided
        if tag_ids:
            result = await db_session.execute(
                select(Tag).where(Tag.id.in_(tag_ids))
            )
            tags = result.scalars().all()
            orm.tags = list(tags)
            await db_session.flush()

        # Reload with tags
        return await self.get(db_session, orm.id)

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
        
        # Reload with tags
        return await self.get(db_session, id)


@lru_cache
def get_photo_service() -> PhotoService:
    return PhotoService(get_generic_repository(), Photo, PhotoResponse)
