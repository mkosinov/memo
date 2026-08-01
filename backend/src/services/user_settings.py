"""UserSettings service — custom mapping for JSON text columns."""

from __future__ import annotations

import json
from typing import Annotated

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db import SessionDep
from src.models.user_settings import UserSettings
from src.repositories.generic import BaseRepository, get_base_repository
from src.schemas.user_settings import (
    UserSettingsCreate,
    UserSettingsResponse,
    UserSettingsUpdate,
)
from src.services.decorators import transactional


def _to_response(model: UserSettings) -> UserSettingsResponse:
    """Map ORM model → Pydantic response, deserializing JSON text columns."""
    return UserSettingsResponse(
        id=model.id,
        user_id=model.user_id,
        theme=model.theme,
        language=model.language,
        column_order_masters=json.loads(model.column_order_masters),
        column_order_locations=json.loads(model.column_order_locations),
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


class UserSettingsService:
    """CRUD service for UserSettings with JSON ↔ list conversion."""

    def __init__(self, repo: BaseRepository) -> None:
        self._repo = repo

    async def get_by_user_id(
        self, session: AsyncSession, user_id: str
    ) -> UserSettingsResponse | None:
        """Find settings by user_id. Returns None if not found."""
        stmt = select(UserSettings).where(UserSettings.user_id == user_id)
        result = await session.execute(stmt)
        orm = result.scalar_one_or_none()
        if orm is None:
            return None
        return _to_response(orm)

    @transactional
    async def create(
        self, session: AsyncSession, data: UserSettingsCreate
    ) -> UserSettingsResponse:
        """Create new user settings."""
        orm = UserSettings(
            user_id=data.user_id,
            theme=data.theme,
            language=data.language,
            column_order_masters=json.dumps(data.column_order_masters),
            column_order_locations=json.dumps(data.column_order_locations),
        )
        session.add(orm)
        await session.flush()
        await session.refresh(orm)
        return _to_response(orm)

    @transactional
    async def update_by_user_id(
        self, session: AsyncSession, user_id: str, data: UserSettingsUpdate
    ) -> UserSettingsResponse | None:
        """Partial-update settings by user_id. Returns None if not found."""
        stmt = select(UserSettings).where(UserSettings.user_id == user_id)
        result = await session.execute(stmt)
        orm = result.scalar_one_or_none()
        if orm is None:
            return None

        update_data = data.model_dump(exclude_unset=True)

        # Strip null values for NOT NULL columns — client intent is "don't change",
        # not "set to null"
        _not_null_fields = {"theme", "language", "column_order_masters", "column_order_locations"}
        for field in _not_null_fields:
            if field in update_data and update_data[field] is None:
                del update_data[field]

        # Serialize list fields to JSON strings
        if "column_order_masters" in update_data:
            update_data["column_order_masters"] = json.dumps(
                update_data["column_order_masters"]
            )
        if "column_order_locations" in update_data:
            update_data["column_order_locations"] = json.dumps(
                update_data["column_order_locations"]
            )

        for key, value in update_data.items():
            setattr(orm, key, value)
        await session.flush()
        await session.refresh(orm)
        return _to_response(orm)

    @transactional
    async def delete(self, session: AsyncSession, id: str) -> bool:
        """Delete a settings record by its primary key ID."""
        return await self._repo.delete(session, UserSettings, id)


def get_user_settings_service() -> UserSettingsService:
    """Factory for UserSettingsService."""
    return UserSettingsService(get_base_repository())
