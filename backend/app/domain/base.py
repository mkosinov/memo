"""Generic service layer using GenericRepository and Pydantic schemas."""

from __future__ import annotations

from typing import Generic, TypeVar

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.repository import GenericRepository

CreateT = TypeVar("CreateT")
UpdateT = TypeVar("UpdateT")
ModelT = TypeVar("ModelT")


class GenericService(Generic[ModelT, CreateT, UpdateT]):
    """Generic service providing standard CRUD with schema validation.

    Stores a model reference and delegates persistence to the stateless
    ``GenericRepository`` singleton.
    """

    def __init__(
        self, repository: GenericRepository, model: type[ModelT]
    ) -> None:
        self._repository = repository
        self._model = model

    async def list(self, db_session: AsyncSession, **filters) -> list[ModelT]:
        return await self._repository.list(db_session, self._model, **filters)

    async def get(self, db_session: AsyncSession, id: str) -> ModelT | None:
        return await self._repository.get(db_session, self._model, id)

    async def create(self, db_session: AsyncSession, data: CreateT) -> ModelT:
        return await self._repository.create(db_session, data, self._model)

    async def update(
        self, db_session: AsyncSession, id: str, data: UpdateT
    ) -> ModelT | None:
        instance = await self.get(db_session, id)
        if not instance:
            return None
        return await self._repository.update(
            db_session, self._model, id, data
        )

    async def delete(self, db_session: AsyncSession, id: str) -> bool:
        return await self._repository.delete(db_session, self._model, id)
