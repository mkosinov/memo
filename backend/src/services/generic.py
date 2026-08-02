"""Generic service layer using GenericRepository and Pydantic schema validation.

Returns validated Pydantic ``ResponseSchemaT`` objects from all CRUD
operations instead of raw ORM model instances.
"""

from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel
from sqlalchemy import func, not_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.enums import ArchiveStatus
from src.repositories.generic import BaseRepository
from src.schemas.common import PaginatedResponse
from src.services.decorators import transactional

CreateSchemaT = TypeVar("CreateSchemaT", bound=BaseModel)
UpdateSchemaT = TypeVar("UpdateSchemaT", bound=BaseModel)
ResponseSchemaT = TypeVar("ResponseSchemaT", bound=BaseModel)


class GenericService(Generic[CreateSchemaT, UpdateSchemaT, ResponseSchemaT]):
    """Generic service providing standard CRUD with schema validation.

    Stores a model reference, a repository singleton, and a response
    schema class.  Every public method validates the ORM result through
    ``self._response_schema.model_validate()`` so callers always receive
    validated Pydantic models.

    Subclasses should override ``NOT_NULL_FIELDS`` with the set of field
    names that map to NOT NULL columns in the database.  The ``patch()``
    method will silently strip ``None`` values for these fields so they
    never reach a NOT NULL constraint violation.
    """

    NOT_NULL_FIELDS: set[str] = set()

    def __init__(
        self,
        repository: BaseRepository,
        model: type,
        response_schema: type[ResponseSchemaT],
    ) -> None:
        self._repository = repository
        self._model = model
        self._response_schema = response_schema

    # Base GenericService has NO is_active knowledge. Soft-delete filtering
    # lives in SoftDeleteService below (#195).
    def _list_stmt(self, **filters):
        """Build the base select with equality filters applied."""
        stmt = select(self._model)
        for key, value in filters.items():
            if value is not None:
                stmt = stmt.where(getattr(self._model, key) == value)
        return stmt

    async def _paginate(
        self, db_session: AsyncSession, stmt, page: int, per_page: int, order_by=None
    ) -> PaginatedResponse[ResponseSchemaT]:
        if order_by is not None:
            stmt = stmt.order_by(*order_by)
        total = (
            await db_session.execute(select(func.count()).select_from(stmt.subquery()))
        ).scalar_one()
        result = await db_session.execute(
            stmt.limit(per_page).offset((page - 1) * per_page)
        )
        items = [self._response_schema.model_validate(o) for o in result.scalars().all()]
        return PaginatedResponse(items=items, total=total, page=page, per_page=per_page)

    async def list(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 20,
        order_by=None,
        **filters,
    ) -> PaginatedResponse[ResponseSchemaT]:
        """Return a paginated page of records, optionally filtered/ordered."""
        return await self._paginate(
            db_session, self._list_stmt(**filters), page, per_page, order_by
        )

    async def get(
        self, db_session: AsyncSession, id: str
    ) -> ResponseSchemaT | None:
        """Return a record by ID, or ``None`` if not found."""
        orm = await self._repository.get(db_session, self._model, id)
        if orm is None:
            return None
        return self._response_schema.model_validate(orm)

    @transactional
    async def create(
        self, db_session: AsyncSession, data: CreateSchemaT
    ) -> ResponseSchemaT:
        """Create a new record from a validated create schema."""
        orm = await self._repository.create(db_session, data, self._model)
        return self._response_schema.model_validate(orm)

    @transactional
    async def update(
        self, db_session: AsyncSession, id: str, data: UpdateSchemaT
    ) -> ResponseSchemaT | None:
        """Full-update a record.  Returns ``None`` if the record is not found."""
        orm = await self._repository.update(db_session, self._model, id, data)
        if orm is None:
            return None
        return self._response_schema.model_validate(orm)

    @transactional
    async def patch(
        self, db_session: AsyncSession, id: str, data: BaseModel
    ) -> ResponseSchemaT | None:
        """Partial-update a record. Only fields explicitly sent by the client are applied.

        Silently strips ``None`` values for fields listed in ``NOT_NULL_FIELDS``
        to prevent NOT NULL constraint violations on columns that must never
        be null (e.g. capacity, master_id, start, etc.).
        """
        data_dict = data.model_dump(exclude_unset=True)
        # Strip nulls for NOT NULL fields — client intent is "don't change",
        # not "set to null"
        for field in self.NOT_NULL_FIELDS:
            if field in data_dict and data_dict[field] is None:
                del data_dict[field]
        orm = await self._repository.patch(
            db_session, self._model, id, data_dict
        )
        if orm is None:
            return None
        return self._response_schema.model_validate(orm)

    @transactional
    async def delete(self, db_session: AsyncSession, id: str) -> bool:
        """Delete a record (soft or hard depending on the model's repository).

        Returns ``True`` if deleted, ``False`` if not found.
        """
        return await self._repository.delete(db_session, self._model, id)

    @transactional
    async def reorder(
        self, db_session: AsyncSession, ids: list[str]
    ) -> list[ResponseSchemaT]:
        """Reorder records by assigning sort_order based on the order of IDs."""
        orm_list = await self._repository.reorder(db_session, self._model, ids)
        return [self._response_schema.model_validate(o) for o in orm_list]


class SoftDeleteService(GenericService[CreateSchemaT, UpdateSchemaT, ResponseSchemaT]):
    """GenericService for soft-delete models (AbstractModelSoftDelete) with
    archive-status list filtering (#195)."""

    def _list_stmt(self, status: ArchiveStatus = ArchiveStatus.ACTIVE, **filters):
        stmt = super()._list_stmt(**filters)
        if status == ArchiveStatus.ACTIVE:
            stmt = stmt.where(self._model.is_active)
        elif status == ArchiveStatus.ARCHIVED:
            stmt = stmt.where(not_(self._model.is_active))
        return stmt

    async def list(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 20,
        order_by=None,
        status: ArchiveStatus = ArchiveStatus.ACTIVE,
        **filters,
    ) -> PaginatedResponse[ResponseSchemaT]:
        """Return a paginated page filtered by archive status."""
        return await self._paginate(
            db_session, self._list_stmt(status=status, **filters), page, per_page, order_by
        )
