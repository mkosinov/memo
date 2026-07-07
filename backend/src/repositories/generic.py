"""Repository hierarchy: BaseRepository (hard delete) + SoftDeleteRepository.

Stateless — single instance serves all models. Each method takes
``table`` (SQLAlchemy model class) and accepts Pydantic ``BaseModel``
objects for create/update payloads.
"""

from __future__ import annotations

from functools import lru_cache
from typing import TypeVar

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.base import Base

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


class SoftDeleteRepository(BaseRepository):
    """Repository for soft-deletable models — adds is_active filtering.

    ``list()`` filters by ``is_active=True`` unless ``include_inactive=True``.
    ``delete()`` sets ``is_active=False`` instead of removing the row.
    If the table has no ``is_active`` column, ``AttributeError`` surfaces
    as a loud error — this is intentional (type-safety by assignment).
    """

    async def list(
        self, session: AsyncSession, table: type[ModelType], order_by=None,
        include_inactive: bool = False, **filters
    ) -> list[ModelType]:
        """Return all active records, optionally filtered and ordered."""
        stmt = select(table)
        if not include_inactive:
            stmt = stmt.where(table.is_active)
        for key, value in filters.items():
            if value is not None:
                stmt = stmt.where(getattr(table, key) == value)
        if order_by is not None:
            stmt = stmt.order_by(*order_by)
        result = await session.execute(stmt)
        return list(result.scalars().all())

    async def delete(
        self, session: AsyncSession, table: type[ModelType], id: str
    ) -> bool:
        """Soft-delete a record (set is_active=False). Returns False if not found or already deleted."""
        instance = await self.get(session, table, id)
        if not instance or not instance.is_active:
            return False
        instance.is_active = False
        await session.flush()
        return True

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
GenericRepository = SoftDeleteRepository


@lru_cache
def get_base_repository() -> BaseRepository:
    """Return a singleton BaseRepository (hard delete)."""
    return BaseRepository()


@lru_cache
def get_soft_delete_repository() -> SoftDeleteRepository:
    """Return a singleton SoftDeleteRepository."""
    return SoftDeleteRepository()


@lru_cache
def get_generic_repository() -> SoftDeleteRepository:
    """Backward-compat alias. Prefer get_soft_delete_repository()."""
    return get_soft_delete_repository()
