"""Generic SQLAlchemy repository with standard CRUD operations.

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


class GenericRepository:
    """Stateless repository providing standard CRUD operations for any model.

    Use the ``get_repository()`` factory to obtain a singleton instance.
    """

    async def list(
        self, session: AsyncSession, table: type[ModelType], **filters
    ) -> list[ModelType]:
        """Return all active records, optionally filtered."""
        stmt = select(table).where(table.is_active)
        for key, value in filters.items():
            if value is not None:
                stmt = stmt.where(getattr(table, key) == value)
        result = await session.execute(stmt)
        return list(result.scalars().all())

    async def get(
        self, session: AsyncSession, table: type[ModelType], id: str
    ) -> ModelType | None:
        """Return a record by ID (including soft-deleted), or None if not found."""
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

    async def delete(
        self, session: AsyncSession, table: type[ModelType], id: str
    ) -> bool:
        """Soft-delete a record (set is_active=False). Returns False if not found."""
        instance = await self.get(session, table, id)
        if not instance:
            return False
        instance.is_active = False
        await session.flush()
        return True


@lru_cache
def get_repository() -> GenericRepository:
    """Return a singleton GenericRepository."""
    return GenericRepository()
