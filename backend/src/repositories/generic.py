"""Repository hierarchy: BaseRepository (hard delete) + ArchiveRepository.

Stateless — single instance serves all models. Each method takes
``table`` (SQLAlchemy model class) and accepts Pydantic ``BaseModel``
objects for create/update payloads.

GH #344 Task 3 — every MUTATION method auto-collects a raw audit
record ``{entity, action, entity_id, before, after}`` into the
accumulator opened by ``@transactional`` (spec §4.2/§4.6):

* the entity name comes from the #239 dictionary (``MODEL_ENTITY``),
  imported LAZILY inside the staging helper — a top-level import would
  drag every service into the repository import graph (cycle hazard,
  see ``src/events/entities.py`` WARNING);
* the audit module owns the accumulator-side rules (target entity,
  seniority, serialization/masking/label) — the repository only builds
  the raw diff: old values are read from the row BEFORE mutation,
  ``create`` snapshots the signature key fields with ``before=None``,
  ``delete`` with ``after=None``;
* no-op writes stage nothing: a field whose value did not change never
  enters the diff, and an empty diff means no journal row (§5.1);
* ``reorder`` stages ONE row per operation — no ``entity_id``, label
  «N объектов», no snapshot — and none at all when the order did not
  actually change (§4.6).
"""

from __future__ import annotations

from collections.abc import Sequence
from functools import lru_cache
from typing import Any, TypeAlias, TypeVar

from pydantic import BaseModel
from sqlalchemy import Select, func, not_, select
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.base import Base
from src.models.enums import ArchiveStatus
from src.repositories.search import SearchField, search_predicate

ModelType = TypeVar("ModelType", bound=Base)

# Alias for the BUILTIN list, used in method annotations below. Inside the
# class body the name ``list`` resolves to the ``list`` METHOD (name
# shadowing — the source of the pre-existing [valid-type] mypy errors on
# ``list``/``ArchiveRepository.list``); subscripting this alias instead
# keeps the read family (``list_custom``/``list_entity``) quirk-free.
# Ruff UP040 (``type ModelList = list``) is intentionally NOT used — mypy 2.1
# rejects subscripting the ``type``-statement alias form ("Bad number of
# arguments for type alias"), while this TypeAlias form works.
ModelList: TypeAlias = list


# ─── GH #344: repository-side audit auto-collection (spec §4.2/§4.6) ──────────


def _stage_auto(
    table: type[Base],
    *,
    action: str,
    entity_id: str | None,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
    entity_label: str | None = None,
) -> None:
    """Stage one raw audit record for a repository mutation (spec §4.2).

    Cheap no-op outside an open accumulator (reads/seeds/CLI never pay
    for journaling); the entity name resolution is lazy (import-cycle
    hazard — ``MODEL_ENTITY``'s module walks every service). The
    accumulator-side rules — target-entity match, seniority vs explicit
    ``mark_audit``, pair composition, serialization/masking/label —
    live in the audit module (``stage_auto``).
    """
    from src.events import audit

    if audit.pending_rows() is None:
        return  # no open accumulator — nothing is journaled (§4.1 context)
    # LAZY import — cycle hazard: the dictionary module walks all services.
    from src.events.entities import MODEL_ENTITY

    entity = MODEL_ENTITY.get(table)
    if entity is None:
        return  # not a canonical #239 entity — never journaled
    audit.stage_auto(
        entity=entity,
        action=action,
        entity_id=entity_id,
        before=before,
        after=after,
        entity_label=entity_label,
    )


def _raw_diff(instance: Any, payload: dict[str, Any]) -> tuple[dict, dict] | None:
    """``(before, after)`` raw dicts for payload fields that CHANGE.

    ``before`` is read from the (not-yet-mutated) row — the caller must
    invoke this BEFORE applying ``setattr``s (spec §4.2 invariant:
    old values are fixed before the first in-session mutation).
    Unchanged fields are dropped (no-op fields never journal, §5.1);
    ``None`` when NOTHING changed → no journal row at all.
    """
    before: dict[str, Any] = {}
    after: dict[str, Any] = {}
    for key, new in payload.items():
        old = getattr(instance, key, None)
        if old != new:
            before[key] = old
            after[key] = new
    return (before, after) if after else None


def _raw_snapshot(
    instance: Any, table: type[Base]
) -> dict[str, Any]:
    """Raw snapshot dict of the signature key fields (create/delete, §5.1).

    Only the signature-declared carrying fields, never blobs/free text.
    Missing attributes snapshot as ``None`` (signature/model drift
    stays inert).
    """
    # LAZY imports — cycle hazard (see _stage_auto).
    from src.events import audit
    from src.events.entities import MODEL_ENTITY

    entity = MODEL_ENTITY.get(table)
    fields = audit.entity_snapshot_fields(entity) if entity is not None else ()
    return {field: getattr(instance, field, None) for field in fields}


def _stage_reorder(table: type[Base], updated: list[Any], changed: bool) -> None:
    """One audit row per reorder operation (spec §4.6).

    ``entity_id`` is null, the label is «N объектов» (N = reordered
    objects), no snapshot; an operation that did not change any
    ``sort_order`` stages nothing (no-op).
    """
    if not changed or not updated:
        return
    _stage_auto(
        table,
        action="reorder",
        entity_id=None,
        before=None,
        after=None,
        entity_label=f"{len(updated)} объектов",
    )


class BaseRepository:
    """Stateless repository for ANY model — no soft-delete logic.

    Use ``get_base_repository()`` to obtain a singleton instance.
    """

    async def list(
        self,
        session: AsyncSession,
        table: type[ModelType],
        *,
        filters: dict | None = None,
        q: str | None = None,
        search_fields: Sequence[SearchField] | None = None,
        order_by=None,
        limit: int | None = None,
        offset: int = 0,
        options=None,
    ) -> tuple[list[ModelType], int]:
        """Return a paginated page of records plus the total count.

        Counts on the unordered statement (loader options are stripped by
        ``stmt.subquery()`` and never affect the count); ``order_by`` is
        applied AFTER the count, then limit/offset slice.
        ``limit=None`` means no LIMIT clause (not used by list endpoints).
        ``q`` narrows rows via ``search_predicate`` over ``search_fields``
        BEFORE the count (total reflects the filtered count); ``q`` without
        fields raises ValueError (fail-fast, spec §5.3 point 2).
        """
        stmt = select(table)
        if options:
            stmt = stmt.options(*options)
        if q is not None:
            stmt = stmt.where(search_predicate(q, search_fields or []))
        for key, value in (filters or {}).items():
            if value is not None:
                stmt = stmt.where(getattr(table, key) == value)
        total = (
            await session.execute(select(func.count()).select_from(stmt.subquery()))
        ).scalar_one()
        if order_by is not None:
            stmt = stmt.order_by(*order_by)
        if limit is not None:
            stmt = stmt.limit(limit)
        if offset:
            stmt = stmt.offset(offset)
        result = await session.execute(stmt)
        return list(result.scalars().all()), total

    async def list_custom(
        self,
        session: AsyncSession,
        stmt: Select[tuple[Any, ...]],
        *,
        order_by: Sequence[Any] | None = None,
        limit: int | None = None,
        offset: int = 0,
    ) -> tuple[ModelList[Row[tuple[Any, ...]]], int]:
        """Row-tuple core: wrap a caller-built statement with count + slice.

        Accepts ANY service-built ``Select`` — entity, multi-column, or
        labeled-expression selects — and returns raw ``Row`` tuples carrying
        EVERY declared column (``result.all()``, no scalars projection).
        Entity-only callers wanting ORM instances back must use
        ``list_entity`` instead.
        Precondition: ``stmt`` must carry NO pre-baked order_by/limit/offset —
        ordering and slicing are owned by this method. Count runs on the
        unordered statement so correlated sort-key subqueries are never
        evaluated inside the count query.
        """
        total = (
            await session.execute(select(func.count()).select_from(stmt.subquery()))
        ).scalar_one()
        if order_by is not None:
            stmt = stmt.order_by(*order_by)
        if limit is not None:
            stmt = stmt.limit(limit)
        if offset:
            stmt = stmt.offset(offset)
        result = await session.execute(stmt)
        return list(result.all()), total

    async def list_entity(
        self,
        session: AsyncSession,
        stmt: Select[tuple[ModelType]],
        *,
        order_by: Sequence[Any] | None = None,
        limit: int | None = None,
        offset: int = 0,
    ) -> tuple[ModelList[ModelType], int]:
        """Entity-only wrapper over the ``list_custom`` row core.

        Accepts ONLY a single-entity select (``Select[tuple[ModelType]]``) —
        the TypeVar makes a multi-column select a typecheck error, routing
        such callers to ``list_custom`` (mypy honesty, spec §5.1). Projects
        ``row[0]`` out of each Row tuple (the old ``list_custom`` scalars
        role); count/order/limit/offset mechanics are the core's.
        """
        rows, total = await self.list_custom(
            session, stmt, order_by=order_by, limit=limit, offset=offset
        )
        return [row[0] for row in rows], total

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
        # Audit AFTER refresh: server/Python defaults are populated, so
        # the create snapshot carries the real persisted key fields.
        _stage_auto(
            table,
            action="create",
            entity_id=instance.id,
            before=None,
            after=_raw_snapshot(instance, table),
        )
        return instance

    async def update(
        self, session: AsyncSession, table: type[ModelType], id: str, obj: BaseModel
    ) -> ModelType | None:
        """Full-update a record from a Pydantic model. Returns None if not found."""
        instance = await self.get(session, table, id)
        if not instance:
            return None
        payload = obj.model_dump()
        raw_diff = _raw_diff(instance, payload)
        for key, value in payload.items():
            setattr(instance, key, value)
        await session.flush()
        await session.refresh(instance)
        if raw_diff is not None:  # no-op (empty diff) → no journal row
            _stage_auto(table, action="update", entity_id=id,
                        before=raw_diff[0], after=raw_diff[1])
        return instance

    async def patch(
        self, session: AsyncSession, table: type[ModelType], id: str, data: dict
    ) -> ModelType | None:
        """Partial-update a record from a dict of fields. Returns None if not found."""
        instance = await self.get(session, table, id)
        if not instance:
            return None
        raw_diff = _raw_diff(instance, data)
        for key, value in data.items():
            setattr(instance, key, value)
        await session.flush()
        await session.refresh(instance)
        if raw_diff is not None:  # no-op (empty diff) → no journal row
            _stage_auto(table, action="update", entity_id=id,
                        before=raw_diff[0], after=raw_diff[1])
        return instance

    async def delete(
        self, session: AsyncSession, table: type[ModelType], id: str
    ) -> bool:
        """Hard delete — physically remove the row. Returns False if not found."""
        instance = await self.get(session, table, id)
        if not instance:
            return False
        _stage_auto(
            table,
            action="delete",
            entity_id=id,
            before=_raw_snapshot(instance, table),
            after=None,
        )
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
        changed = False
        for idx, record_id in enumerate(ids):
            instance = await self.get(session, table, record_id)
            if instance:
                if instance.sort_order != idx:
                    changed = True
                instance.sort_order = idx
                await session.flush()
                await session.refresh(instance)
                updated.append(instance)
        _stage_reorder(table, updated, changed)
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
        self,
        session: AsyncSession,
        table: type[ModelType],
        *,
        status: ArchiveStatus = ArchiveStatus.ACTIVE,
        filters: dict | None = None,
        q: str | None = None,
        search_fields: Sequence[SearchField] | None = None,
        order_by=None,
        limit: int | None = None,
        offset: int = 0,
        options=None,
    ) -> tuple[list[ModelType], int]:
        """Return a paginated page filtered by archive status, plus total count.

        ``q`` narrows rows via ``search_predicate`` over ``search_fields``,
        ANDed with the status predicate and applied BEFORE the count (total
        reflects the filtered count); ``q`` without fields raises ValueError.
        """
        stmt = select(table)
        if options:
            stmt = stmt.options(*options)
        if status == ArchiveStatus.ACTIVE:
            stmt = stmt.where(table.is_active)
        elif status == ArchiveStatus.ARCHIVED:
            stmt = stmt.where(not_(table.is_active))
        if q is not None:
            stmt = stmt.where(search_predicate(q, search_fields or []))
        for key, value in (filters or {}).items():
            if value is not None:
                stmt = stmt.where(getattr(table, key) == value)
        total = (
            await session.execute(select(func.count()).select_from(stmt.subquery()))
        ).scalar_one()
        if order_by is not None:
            stmt = stmt.order_by(*order_by)
        if limit is not None:
            stmt = stmt.limit(limit)
        if offset:
            stmt = stmt.offset(offset)
        result = await session.execute(stmt)
        return list(result.scalars().all()), total

    async def reorder(
        self, session: AsyncSession, table: type[ModelType], ids: list[str]
    ) -> list[ModelType]:
        """Set sort_order for active records only.

        Only active records matching the given IDs are updated.
        Returns the reordered records in the new order.
        """
        updated: list[ModelType] = []
        changed = False
        for idx, record_id in enumerate(ids):
            instance = await self.get(session, table, record_id)
            if instance and instance.is_active:
                if instance.sort_order != idx:
                    changed = True
                instance.sort_order = idx
                await session.flush()
                await session.refresh(instance)
                updated.append(instance)
        _stage_reorder(table, updated, changed)
        return updated


@lru_cache
def get_base_repository() -> BaseRepository:
    """Return a singleton BaseRepository (hard delete)."""
    return BaseRepository()


@lru_cache
def get_archive_repository() -> ArchiveRepository:
    """Return a singleton ArchiveRepository (hard delete + archive-status list filter)."""
    return ArchiveRepository()
