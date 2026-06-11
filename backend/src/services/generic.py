"""Generic service layer using GenericRepository and Pydantic schema validation.

Returns validated Pydantic ``ResponseSchemaT`` objects from all CRUD
operations instead of raw ORM model instances.
"""

from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.generic import GenericRepository

CreateSchemaT = TypeVar("CreateSchemaT", bound=BaseModel)
UpdateSchemaT = TypeVar("UpdateSchemaT", bound=BaseModel)
ResponseSchemaT = TypeVar("ResponseSchemaT", bound=BaseModel)


class GenericService(Generic[CreateSchemaT, UpdateSchemaT, ResponseSchemaT]):
    """Generic service providing standard CRUD with schema validation.

    Stores a model reference, a repository singleton, and a response
    schema class.  Every public method validates the ORM result through
    ``self._response_schema.model_validate()`` so callers always receive
    validated Pydantic models.
    """

    def __init__(
        self,
        repository: GenericRepository,
        model: type,
        response_schema: type[ResponseSchemaT],
    ) -> None:
        self._repository = repository
        self._model = model
        self._response_schema = response_schema

    async def list(
        self, db_session: AsyncSession, order_by=None, **filters
    ) -> list[ResponseSchemaT]:
        """Return all active records, optionally filtered and ordered."""
        orm_list = await self._repository.list(db_session, self._model, order_by=order_by, **filters)
        return [self._response_schema.model_validate(o) for o in orm_list]

    async def get(
        self, db_session: AsyncSession, id: str
    ) -> ResponseSchemaT | None:
        """Return a record by ID, or ``None`` if not found."""
        orm = await self._repository.get(db_session, self._model, id)
        if orm is None:
            return None
        return self._response_schema.model_validate(orm)

    async def create(
        self, db_session: AsyncSession, data: CreateSchemaT
    ) -> ResponseSchemaT:
        """Create a new record from a validated create schema."""
        orm = await self._repository.create(db_session, data, self._model)
        return self._response_schema.model_validate(orm)

    async def update(
        self, db_session: AsyncSession, id: str, data: UpdateSchemaT
    ) -> ResponseSchemaT | None:
        """Full-update a record.  Returns ``None`` if the record is not found."""
        orm = await self._repository.update(db_session, self._model, id, data)
        if orm is None:
            return None
        return self._response_schema.model_validate(orm)

    async def patch(
        self, db_session: AsyncSession, id: str, data: BaseModel
    ) -> ResponseSchemaT | None:
        """Partial-update a record. Only fields explicitly sent by the client are applied."""
        orm = await self._repository.patch(
            db_session, self._model, id, data.model_dump(exclude_unset=True)
        )
        if orm is None:
            return None
        return self._response_schema.model_validate(orm)

    async def delete(self, db_session: AsyncSession, id: str) -> bool:
        """Soft-delete a record.  Returns ``True`` if deleted, ``False`` if not found."""
        return await self._repository.delete(db_session, self._model, id)

    async def reorder(
        self, db_session: AsyncSession, ids: list[str]
    ) -> list[ResponseSchemaT]:
        """Reorder records by assigning sort_order based on the order of IDs."""
        orm_list = await self._repository.reorder(db_session, self._model, ids)
        return [self._response_schema.model_validate(o) for o in orm_list]
