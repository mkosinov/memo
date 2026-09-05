"""Generic service layer using the shared repository and Pydantic schema validation.

Returns validated Pydantic ``ResponseSchemaT`` objects from all CRUD
operations instead of raw ORM model instances.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Generic, TypeVar, cast

from pydantic import BaseModel
from sqlalchemy import delete, not_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.domain.deletion import (
    CASCADE_HANDLERS,
    FK_MATRIX,
    NULLIFY_HANDLERS,
    BlockingDepsError,
    InvalidResolutionError,
    collect_dependencies,
    has_blocking_deps,
    validate_resolutions,
)
from src.domain.errors import BareListLimitExceededError
from src.models.enums import ArchiveStatus
from src.repositories.generic import ArchiveRepository, BaseRepository
from src.repositories.search import SearchField
from src.schemas.common import PaginatedResponse
from src.services.decorators import transactional

CreateSchemaT = TypeVar("CreateSchemaT", bound=BaseModel)
UpdateSchemaT = TypeVar("UpdateSchemaT", bound=BaseModel)
ResponseSchemaT = TypeVar("ResponseSchemaT", bound=BaseModel)

# Protective limit for bare /all dictionary lists (#205). Enforced in the
# single shared ``GenericService.list_all`` choke point via a LIMIT+1 probe.
BARE_LIST_MAX_ROWS = 1000


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

    # GH #212: per-entity search field declarations (spec §5.2). None → the
    # service never receives ``q`` (its router simply doesn't declare the
    # param); the repo fail-fasts if ``q`` arrives without fields.
    search_fields: Sequence[SearchField] | None = None

    def __init__(
        self,
        repository: BaseRepository,
        model: type,
        response_schema: type[ResponseSchemaT],
    ) -> None:
        self._repository = repository
        self._model = model
        self._response_schema = response_schema

    # Base GenericService has NO is_active knowledge. Archive-status
    # filtering lives in ArchiveService below (#195).
    def _list_stmt(self, **filters):
        """Build the base select with equality filters applied."""
        stmt = select(self._model)
        for key, value in filters.items():
            if value is not None:
                stmt = stmt.where(getattr(self._model, key) == value)
        return stmt

    async def list(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 20,
        order_by=None,
        q: str | None = None,
        **filters,
    ) -> PaginatedResponse[ResponseSchemaT]:
        """Return a paginated page of records, optionally filtered/ordered/searched.

        ``q`` (GH #212) narrows rows via ``search_predicate`` over
        ``self.search_fields``; the predicate lands BEFORE the COUNT, so
        ``total`` reflects the filtered count.
        """
        items_orm, total = await self._repository.list(
            db_session,
            self._model,
            filters=filters,
            q=q,
            search_fields=self.search_fields,
            order_by=order_by,
            limit=per_page,
            offset=(page - 1) * per_page,
        )
        items = [self._response_schema.model_validate(o) for o in items_orm]
        return PaginatedResponse(items=items, total=total, page=page, per_page=per_page)

    async def list_all(
        self,
        db_session: AsyncSession,
        order_by=None,
        **filters,
    ) -> list[ResponseSchemaT]:
        """Unpaginated list for dictionary /all endpoints, capped by BARE_LIST_MAX_ROWS.

        Reuses ``_list_stmt(**filters)`` (same equality-filter semantics as
        ``list()``). Applies ``order_by`` when given. Executes with
        ``LIMIT BARE_LIST_MAX_ROWS + 1``; if the extra row is present, raises
        ``BareListLimitExceededError`` (single query, never materializes
        unbounded rows). Boundary: exactly ``BARE_LIST_MAX_ROWS`` rows → OK;
        the 1001st row → raise. Returns validated ``ResponseSchemaT`` objects
        (same count idiom as ``BaseRepository.list``).
        """
        stmt = self._list_stmt(**filters)
        if order_by is not None:
            stmt = stmt.order_by(*order_by)
        result = await db_session.execute(stmt.limit(BARE_LIST_MAX_ROWS + 1))
        rows = list(result.scalars().all())
        if len(rows) > BARE_LIST_MAX_ROWS:
            raise BareListLimitExceededError(self._model.__tablename__, BARE_LIST_MAX_ROWS)
        return [self._response_schema.model_validate(o) for o in rows]

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
        payload = self._patch_payload(data)
        orm = await self._repository.patch(
            db_session, self._model, id, payload
        )
        if orm is None:
            return None
        return self._response_schema.model_validate(orm)

    def _patch_payload(self, data: BaseModel) -> dict:
        """Build the apply-dict for ``patch()``: ``exclude_unset`` dump with
        ``None`` values for ``NOT_NULL_FIELDS`` stripped (client intent is
        "don't change", not "set to null").
        """
        data_dict = data.model_dump(exclude_unset=True)
        # Strip nulls for NOT NULL fields — client intent is "don't change",
        # not "set to null"
        for field in self.NOT_NULL_FIELDS:
            if field in data_dict and data_dict[field] is None:
                del data_dict[field]
        return data_dict

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


class ArchiveService(GenericService[CreateSchemaT, UpdateSchemaT, ResponseSchemaT]):
    """Archive-aware service for ``AbstractModelSoftDelete`` models.

    Combines three concerns:

    * **Hard delete** — ``delete`` is inherited UNMODIFIED from
      ``GenericService`` (and ultimately from ``BaseRepository.delete``):
      the row is physically removed, NOT soft-archived. Archive/restore is
      a separate two-method surface owned here (see ``archive``/``restore``).
    * **archive()/restore()** — flip ``is_active`` False/True without
      removing the row (atomic per call, ``@transactional``).
    * **Archive-status list filtering** (#195) — ``list()`` accepts a
      ``status: ArchiveStatus`` parameter (ACTIVE default / ARCHIVED / ALL)
      so the ``is_active`` predicate is owned by a single sibling concern
      away from the base ``GenericService`` (which has no ``is_active``
      knowledge).
    """

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
        q: str | None = None,
        **filters,
    ) -> PaginatedResponse[ResponseSchemaT]:
        """Return a paginated page filtered by archive status and ``q`` (GH #212).

        ``q`` ANDs with the status predicate (archived rows never surface
        under the default ACTIVE status — spec §5.1 typeahead parity).

        ``self._repository`` is typed ``BaseRepository`` (inherited from
        ``GenericService.__init__``), but every Archive factory injects
        ``get_archive_repository()`` — an ``ArchiveRepository`` whose
        ``list()`` accepts the ``status=`` kwarg. The cast documents that
        runtime invariant without touching the factories (#206 Task 2).
        """
        items_orm, total = await cast(ArchiveRepository, self._repository).list(
            db_session,
            self._model,
            status=status,
            filters=filters,
            q=q,
            search_fields=self.search_fields,
            order_by=order_by,
            limit=per_page,
            offset=(page - 1) * per_page,
        )
        items = [self._response_schema.model_validate(o) for o in items_orm]
        return PaginatedResponse(items=items, total=total, page=page, per_page=per_page)

    async def list_all(
        self,
        db_session: AsyncSession,
        order_by=None,
        status: ArchiveStatus = ArchiveStatus.ACTIVE,
        **filters,
    ) -> list[ResponseSchemaT]:
        """Unpaginated list filtered by archive status (mirrors ``list()``).

        Delegates to ``GenericService.list_all`` passing ``status`` through as
        a filter — ``ArchiveService._list_stmt(status=...)`` already applies
        the ``is_active`` predicate, so no extra handling is needed here.
        """
        return await super().list_all(db_session, order_by=order_by, status=status, **filters)

    @transactional
    async def archive(self, db_session: AsyncSession, id: str) -> bool:
        """Archive a record (set ``is_active=False``).

        Returns ``True`` if the row was archived, ``False`` if not found.
        Honors the bool service contract (spec §3.4): ``ArchiveRepository.patch``
        returns the ORM instance (found) or ``None`` (not found), so the
        result is coerced to a real ``bool`` to match the declared return type.
        """
        return await self._repository.patch(
            db_session, self._model, id, {"is_active": False}
        ) is not None

    @transactional
    async def restore(self, db_session: AsyncSession, id: str) -> bool:
        """Restore an archived record (set is_active=True).

        Returns True if the row was restored, False if not found.
        See archive for the bool-coercion rationale.
        """
        return await self._repository.patch(
            db_session, self._model, id, {"is_active": True}
        ) is not None

    @transactional
    async def resolve_delete(
        self,
        db_session: AsyncSession,
        id: str,
        resolutions: dict[str, str],
    ) -> bool:
        """Execute the unified DELETE-with-body resolution transaction (Task 10).

        Spec §6 (rules) + §8 (atomicity — ONE outer ``@transactional``; NO
        per-dep commits): all nullify/cascade writes land on this session and
        commit once at the outer boundary; any exception → rollback via
        ``get_db_session`` (the decorator skips commit on raise).

        Flow:
          1. Existence check — ``False`` if entity missing (route maps to 404).
          2. Collect FK deps (``collect_dependencies``).
          3. ``has_blocking_deps`` → raise ``BlockingDepsError`` (route → 422
             "archive instead").
          4. ``validate_resolutions`` → raise ``InvalidResolutionError`` if
             errors (route → 422 with detail).
          5. Dispatch deps in spec §6 execution order: **nullify first, then
             cascade** (each via ``NULLIFY_HANDLERS`` / ``CASCADE_HANDLERS``
             keyed by ``(self._model, dep.entity)`` — NO ``if model is X``
             branches; the matrix IS the dispatch). Blocked deps never reach
             the executor (step 3 raised).
          6. Hard-delete the entity row.
          7. Return ``True`` (existed, executed).

        Returns the bool contract per spec: ``True`` on success, ``False`` if
        the entity was missing (404). Raises ``ResolutionError`` subtypes for
        422 paths (caught in the router).
        """
        # 1. Existence — repository.get reuses the same session's identity-map
        #    cache. Return False on miss (router maps to 404).
        entity = await self._repository.get(db_session, self._model, id)
        if entity is None:
            return False

        # 2. Collect deps (COUNT queries against the matrix for this model).
        deps = await collect_dependencies(db_session, self._model, id)

        # 3. Blocked deps → 422 "archive instead" (activities present).
        if has_blocking_deps(deps):
            raise BlockingDepsError(
                "Entity has blocking dependencies — archive instead"
            )

        # 4. Validate resolutions body against the matrix (§6 rules).
        issues = validate_resolutions(self._model, deps, resolutions)
        if issues:
            msg = "; ".join(f"{i.relation}: {i.message}" for i in issues)
            raise InvalidResolutionError(msg)

        # 5. Execute deps in spec §6 order: nullify → cascade → hard delete.
        #    Two phases so the nullify handlers run BEFORE any cascade handler
        #    (regardless of the matrix's declaration order — e.g. Service has
        #    tariffs(cascade) listed BEFORE photos(nullify) in FK_MATRIX, but
        #    the spec requires nullify-first to break FK links before any
        #    downstream cascade-delete triggers row-level checks).
        matrix_deps = FK_MATRIX.get(self._model, [])
        for dep in matrix_deps:
            if dep.action != "nullify":
                continue
            handler = NULLIFY_HANDLERS.get((self._model, dep.entity))
            if handler is not None:
                await handler(self, db_session, id)
        for dep in matrix_deps:
            if dep.action != "cascade":
                continue
            handler = CASCADE_HANDLERS.get((self._model, dep.entity))
            if handler is not None:
                await handler(self, db_session, id)
            # block deps never reach here (step 3 raised BlockingDepsError).

        # 6. Hard-delete the entity row.
        await db_session.execute(
            delete(self._model).where(self._model.id == id)
        )
        return True
