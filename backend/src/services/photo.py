"""Business logic for photo CRUD operations."""

from __future__ import annotations

from functools import lru_cache

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.models.photo import Photo, photo_tags
from src.repositories.generic import get_base_repository
from src.schemas.photo import PhotoCreate, PhotoPatch, PhotoResponse, PhotoUpdate
from src.services.generic import GenericService
from src.services.decorators import transactional


class PhotoService(GenericService[PhotoCreate, PhotoUpdate, PhotoResponse]):
    """Extended photo service with tag handling."""

    NOT_NULL_FIELDS = {"filename", "is_public"}

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

    @transactional
    async def create(
        self, db_session: AsyncSession, data: PhotoCreate
    ) -> PhotoResponse:
        """Create a new photo with tag links.

        tag_ids: link via the photo_tags join table directly (NOT the ORM
        relationship), because ``orm.tags = list(tags)`` triggers a lazy load
        on AsyncSession and crashes with MissingGreenlet.
        """
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

        # Link tags via the join table directly (avoids async lazy-load bug)
        for tid in tag_ids or []:
            await db_session.execute(
                photo_tags.insert().values(photo_id=orm.id, tag_id=tid)
            )
        await db_session.flush()

        # Reload with tags
        return await self.get(db_session, orm.id)

    @transactional
    async def update(
        self, db_session: AsyncSession, id: str, data: PhotoUpdate
    ) -> PhotoResponse | None:
        """Full-update: replace scalar fields and tag links.

        tag_ids: handled via the photo_tags join table (not the ORM
        relationship) to avoid the async lazy-load bug.
        """
        orm = await self._repository.get(db_session, Photo, id)
        if orm is None:
            return None

        # Update scalar fields (exclude tag_ids)
        update_data = data.model_dump(exclude={'tag_ids'}, exclude_unset=True)
        for key, value in update_data.items():
            setattr(orm, key, value)

        # Replace tag links via the join table if tag_ids was sent
        if data.tag_ids is not None:
            await db_session.execute(
                delete(photo_tags).where(photo_tags.c.photo_id == id)
            )
            for tid in data.tag_ids:
                await db_session.execute(
                    photo_tags.insert().values(photo_id=id, tag_id=tid)
                )

        await db_session.flush()
        # Reload with tags eagerly loaded
        return await self.get(db_session, id)

    @transactional
    async def patch(
        self, db_session: AsyncSession, id: str, data: PhotoPatch
    ) -> PhotoResponse | None:
        """Partial-update a photo — only sent fields are changed.

        Scalar fields: applied via exclude_unset. NOT NULL fields
        with null values are silently stripped.

        tag_ids: if sent → hard-replace all tag links via the photo_tags
        join table. If not sent → existing tag links are preserved.
        """
        orm = await self._repository.get(db_session, Photo, id)
        if orm is None:
            return None

        data_dict = data.model_dump(exclude_unset=True)

        # Separate tag_ids from scalar fields
        tag_ids = data_dict.pop("tag_ids", None)

        # Strip NOT NULL fields sent as null
        for field in self.NOT_NULL_FIELDS:
            if field in data_dict and data_dict[field] is None:
                del data_dict[field]

        # Apply scalar fields
        for key, value in data_dict.items():
            setattr(orm, key, value)

        # Handle tag_ids via the join table directly
        if tag_ids is not None:
            await db_session.execute(
                delete(photo_tags).where(photo_tags.c.photo_id == id)
            )
            for tid in tag_ids:
                await db_session.execute(
                    photo_tags.insert().values(photo_id=id, tag_id=tid)
                )

        await db_session.flush()
        # Reload with tags eagerly loaded
        return await self.get(db_session, id)


@lru_cache
def get_photo_service() -> PhotoService:
    return PhotoService(get_base_repository(), Photo, PhotoResponse)
