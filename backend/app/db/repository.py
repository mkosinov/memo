"""Generic SQLAlchemy repository with standard CRUD operations."""

from __future__ import annotations

from typing import Generic, TypeVar

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import Base

ModelT = TypeVar("ModelT", bound=Base)


class GenericRepository(Generic[ModelT]):
    """Generic repository providing standard CRUD operations for any model."""

    def __init__(self, model: type[ModelT]) -> None:
        self._model = model

    async def list(self, db_session: AsyncSession, **filters) -> list[ModelT]:
        """Return all active records, optionally filtered."""
        stmt = select(self._model).where(self._model.is_active)
        for key, value in filters.items():
            if value is not None:
                stmt = stmt.where(getattr(self._model, key) == value)
        result = await db_session.execute(stmt)
        return list(result.scalars().all())

    async def get(self, db_session: AsyncSession, id: str) -> ModelT | None:
        """Return a record by ID (including soft-deleted), or None if not found."""
        result = await db_session.execute(
            select(self._model).where(self._model.id == id)
        )
        return result.scalar_one_or_none()

    async def create(self, db_session: AsyncSession, data: dict) -> ModelT:
        """Create a new record."""
        instance = self._model(**data)
        db_session.add(instance)
        await db_session.flush()
        await db_session.refresh(instance)
        return instance

    async def update(self, db_session: AsyncSession, id: str, data: dict) -> ModelT | None:
        """Full-update a record. Returns None if not found."""
        instance = await self.get(db_session, id)
        if not instance:
            return None
        for key, value in data.items():
            setattr(instance, key, value)
        await db_session.flush()
        await db_session.refresh(instance)
        return instance

    async def delete(self, db_session: AsyncSession, id: str) -> bool:
        """Soft-delete a record (set is_active=False). Returns False if not found."""
        instance = await self.get(db_session, id)
        if not instance:
            return False
        instance.is_active = False
        await db_session.flush()
        return True
