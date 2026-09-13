"""Business logic for the positions dictionary (GH #266 D4).

Plain :class:`GenericService` CRUD — positions are not archive-aware.
The single domain rule lives in :meth:`PositionService.delete`: built-ins
(``is_system``) never delete (``PositionIsSystemError`` → 422
``POSITION_IS_SYSTEM``); their title stays freely editable.
"""

from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING

from src.domain.errors import PositionIsSystemError
from src.models.position import Position
from src.repositories.generic import get_base_repository
from src.repositories.search import SearchField
from src.schemas.position import (
    PositionCreate,
    PositionResponse,
    PositionUpdate,
)
from src.services.decorators import transactional
from src.services.generic import GenericService

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


class PositionService(
    GenericService[PositionCreate, PositionUpdate, PositionResponse]
):
    """Dictionary CRUD + the is_system deletion guard (D4)."""

    NOT_NULL_FIELDS = {"title"}

    # GH #212 search matrix: substring on title; exact id equality on a
    # full UUID (built-in ids like "master" are shorter — never matched by
    # the uuid branch, which is exactly right for a typeahead).
    search_fields = [
        SearchField(Position.title),
        SearchField(Position.id, kind="uuid"),
    ]

    @transactional
    async def delete(self, db_session: AsyncSession, id: str) -> bool:
        """Delete a user-defined position; built-ins raise.

        Returns ``True`` when deleted, ``False`` when the row is missing
        (router maps to 404 ``POSITION_NOT_FOUND``). Raises
        :class:`PositionIsSystemError` for built-ins (router → 422
        ``POSITION_IS_SYSTEM``). staff_positions join rows go at the DB
        level (ON DELETE CASCADE on the join FK) — no join-row surgery.
        """
        position = await self._repository.get(db_session, self._model, id)
        if position is None:
            return False
        if position.is_system:
            raise PositionIsSystemError(id)
        return await super().delete(db_session, id)


@lru_cache
def get_position_service() -> PositionService:
    return PositionService(
        get_base_repository(), Position, PositionResponse
    )
