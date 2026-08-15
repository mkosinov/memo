"""Repository hierarchy: BaseRepository (hard delete) + ArchiveRepository.

Stateless — single instance serves all models. Each method takes
``table`` (SQLAlchemy model class) and accepts Pydantic ``BaseModel``
objects for create/update payloads.
"""

from __future__ import annotations

from functools import lru_cache
from typing import TypeVar

from pydantic import BaseModel
from sqlalchemy import not_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.base import Base
from src.models.enums import ArchiveStatus

ModelType = TypeVar("ModelType", bound=Base)


class BaseRepository:
    """Stateless repository for ANY model — no soft-delete logic.

    Use ``get_base_repository()`` to obtain a singleton instance.
    """

    async def list(
        self, session: AsyncSession, table: type[ModelType], order_by=None, **filters
    ) -> list[ModelType]:
        """Return all records, optionally filtered and ordered. No is_active filter."""
        stmt = select(table)
        for key, value in filters.items():
            if value is not None:
                stmt = stmt.where(getattr(table, key) == value)
        if order_by is not None:
            stmt = stmt.order_by(*order_by)
        result = await session.execute(stmt)
        return list(result.scalars().all())

    async def get(
        self, session: AsyncSession, table: type[ModelType], id: str
    ) -> ModelType | None:
        """Return a record by ID, or None if not found."""
        result = await session.execute(
            select(table).where(table.id == id)
        )
        return result.scalar_one_or_none()

    async def create(
        self, session: AsyncSession, obj: BaseModel, table: type[ModelType]
    ) -> ModelType:
        """Create a new record from a Pydantic model."""
        instance = table(**obj.model_dump())
        session.add(instance)
        await session.flush()
        await session.refresh(instance)
        return instance

    async def update(
        self, session: AsyncSession, table: type[ModelType], id: str, obj: BaseModel
    ) -> ModelType | None:
        """Full-update a record from a Pydantic model. Returns None if not found."""
        instance = await self.get(session, table, id)
        if not instance:
            return None
        for key, value in obj.model_dump().items():
            setattr(instance, key, value)
        await session.flush()
        await session.refresh(instance)
        return instance

    async def patch(
        self, session: AsyncSession, table: type[ModelType], id: str, data: dict
    ) -> ModelType | None:
        """Partial-update a record from a dict of fields. Returns None if not found."""
        instance = await self.get(session, table, id)
        if not instance:
            return None
        for key, value in data.items():
            setattr(instance, key, value)
        await session.flush()
        await session.refresh(instance)
        return instance

    async def delete(
        self, session: AsyncSession, table: type[ModelType], id: str
    ) -> bool:
        """Hard delete — physically remove the row. Returns False if not found."""
        instance = await self.get(session, table, id)
        if not instance:
            return False
        await session.delete(instance)
        await session.flush()
        return True

    async def reorder(
        self, session: AsyncSession, table: type[ModelType], ids: list[str]
    ) -> list[ModelType]:
        """Set sort_order for records based on the order of IDs in the list.

        Any matching id gets sort_order updated (no is_active check).
        Returns the reordered records in the new order.
        """
        updated: list[ModelType] = []
        for idx, record_id in enumerate(ids):
            instance = await self.get(session, table, record_id)
            if instance:
                instance.sort_order = idx
                await session.flush()
                await session.refresh(instance)
                updated.append(instance)
        return updated


class ArchiveRepository(BaseRepository):
    """Repository for archivable models — hard delete + archive-status filtering.

    ``list()`` returns rows filtered by the ``status`` parameter:
    ``ArchiveStatus.ACTIVE`` (default) -> only is_active=True,
    ``ArchiveStatus.ARCHIVED`` -> only is_active=False,
    ``ArchiveStatus.ALL`` -> both active and archived.
    ``delete()`` is NOT overridden here — hard delete is inherited UNMODIFIED
    from ``BaseRepository.delete`` (physically removes the row). Archive and
    restore are Service-level concerns (driven via ``patch`` on is_active),
    not repository concerns (spec §3.3).
    If the table has no ``is_active`` column, ``AttributeError`` surfaces
    as a loud error — this is intentional (type-safety by assignment).
    """

    async def list(
        self, session: AsyncSession, table: type[ModelType], order_by=None,
        status: ArchiveStatus = ArchiveStatus.ACTIVE, **filters
    ) -> list[ModelType]:
        """Return records filtered by archive status, optionally filtered and ordered."""
        stmt = select(table)
        if status == ArchiveStatus.ACTIVE:
            stmt = stmt.where(table.is_active)
        elif status == ArchiveStatus.ARCHIVED:
            stmt = stmt.where(not_(table.is_active))
        for key, value in filters.items():
            if value is not None:
                stmt = stmt.where(getattr(table, key) == value)
        if order_by is not None:
            stmt = stmt.order_by(*order_by)
        result = await session.execute(stmt)
        return list(result.scalars().all())

    async def reorder(
        self, session: AsyncSession, table: type[ModelType], ids: list[str]
    ) -> list[ModelType]:
        """Set sort_order for active records only.

        Only active records matching the given IDs are updated.
        Returns the reordered records in the new order.
        """
        updated: list[ModelType] = []
        for idx, record_id in enumerate(ids):
            instance = await self.get(session, table, record_id)
            if instance and instance.is_active:
                instance.sort_order = idx
                await session.flush()
                await session.refresh(instance)
                updated.append(instance)
        return updated


# Backward-compat alias — old code referencing GenericRepository still works
GenericRepository = ArchiveRepository


@lru_cache
def get_base_repository() -> BaseRepository:
    """Return a singleton BaseRepository (hard delete)."""
    return BaseRepository()


@lru_cache
def get_archive_repository() -> ArchiveRepository:
    """Return a singleton ArchiveRepository (hard delete + archive-status list filter)."""
    return ArchiveRepository()


@lru_cache
def get_generic_repository() -> ArchiveRepository:
    """Backward-compat alias. Prefer get_archive_repository()."""
    return get_archive_repository()
