"""Business logic for the specialties dictionary (GH #599 Task 1).

Plain :class:`GenericService` CRUD (not archive-aware) plus the single
domain rule: the title is UNIQUE CASE-INSENSITIVELY — «Живопись» and
«живопись» cannot coexist (the functional unique index on
``lower(title)``, R1 migration).

The 409 mechanics (spec §4.2): the authoritative defense is catching
the ``IntegrityError`` raised by the index when the repository flushes
the write — that path is TOCTOU-proof. The ``_ensure_title_free``
SELECT precheck is ONLY the UX-fast path (same-transaction probe; a
racing writer is still caught by the index). A rename to the row's OWN
case-variant never conflicts: the precheck excludes the row's own id,
and the index ignores the row it is updating.

Everything else (list/``/all``/delete-family execution) is inherited
from the generic service unchanged.
"""

from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from src.domain.errors import SpecialtyTitleTakenError
from src.models.specialty import Specialty
from src.repositories.generic import get_base_repository
from src.schemas.specialty import SpecialtyCreate, SpecialtyPatch, SpecialtyView
from src.services.decorators import transactional
from src.services.generic import GenericService

if TYPE_CHECKING:
    from pydantic import BaseModel
    from sqlalchemy.ext.asyncio import AsyncSession


class SpecialtyService(GenericService[SpecialtyCreate, SpecialtyPatch, SpecialtyView]):
    """Dictionary CRUD + the case-insensitive title uniqueness guard."""

    # Annotated like the base (a bare ``= {...}`` is a RUF012 mutable
    # class default; the client.py precedent keeps the frozen budget).
    NOT_NULL_FIELDS = {"title"}  # noqa: RUF012

    # Narrowed model contract (annotation-only; the PositionService
    # idiom): the factory below always injects ``Specialty`` — the
    # typed column access in the precheck needs it, the inherited
    # ``type[Base]`` root has no declared columns.
    _model: type[Specialty]

    async def _ensure_title_free(
        self,
        db_session: AsyncSession,
        title: str,
        exclude_id: str | None = None,
    ) -> None:
        """UX-fast SELECT precheck — NOT the only defense (spec §4.2).

        ``lower()`` on both sides rides the connect-listener UDF
        (full-Unicode, GH #212 M5) — the same function the functional
        index keys on, so Cyrillic case-variants collide identically.
        ``exclude_id`` skips the renamed row itself: a rename to its
        own case-variant must succeed. Raises
        :class:`SpecialtyTitleTakenError` on a collision; a racing
        writer past this probe is still stopped by the index (the
        ``IntegrityError`` catch in the writers below).
        """
        stmt = (
            select(func.count())
            .select_from(Specialty)
            .where(func.lower(Specialty.title) == title.lower())
        )
        if exclude_id is not None:
            stmt = stmt.where(Specialty.id != exclude_id)
        taken = (await db_session.execute(stmt)).scalar_one()
        if taken:
            raise SpecialtyTitleTakenError(title)

    @transactional
    async def create(self, db_session: AsyncSession, data: SpecialtyCreate) -> SpecialtyView:
        """Create a dictionary row; a case-variant collision → 409.

        The repository ``flush()`` surfaces the functional index's
        ``IntegrityError`` INSIDE this method (before the decorator's
        commit): caught, rolled back, and re-raised as the domain
        error — never a 500 and never the generic 422
        ``INTEGRITY_VIOLATION`` handler.
        """
        await self._ensure_title_free(db_session, data.title)
        try:
            orm = await self._repository.create(db_session, data, self._model)
        except IntegrityError as exc:
            await db_session.rollback()
            raise SpecialtyTitleTakenError(data.title) from exc
        return self._response_schema.model_validate(orm)

    @transactional
    async def patch(
        self, db_session: AsyncSession, id: str, data: BaseModel
    ) -> SpecialtyView | None:
        """Rename a dictionary row; same uniqueness rule as create.

        Accepts the supertype's ``BaseModel`` (LSP: the generic patch
        signature must stay substitutable); the router always passes a
        ``SpecialtyPatch``. Returns ``None`` when the row is missing
        (router maps to 404). A sent ``title=None`` is stripped by the
        generic payload rules before the precheck — it never reaches
        the index.
        """
        payload = self._patch_payload(data)
        if payload.get("title") is not None:
            await self._ensure_title_free(db_session, payload["title"], exclude_id=id)
        try:
            orm = await self._repository.patch(db_session, self._model, id, payload)
        except IntegrityError as exc:
            await db_session.rollback()
            raise SpecialtyTitleTakenError(str(payload.get("title", ""))) from exc
        if orm is None:
            return None
        return self._response_schema.model_validate(orm)


@lru_cache
def get_specialty_service() -> SpecialtyService:
    return SpecialtyService(get_base_repository(), Specialty, SpecialtyView)
