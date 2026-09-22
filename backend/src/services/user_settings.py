"""UserSettings service — custom mapping for JSON text columns."""

from __future__ import annotations

import json
import uuid
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

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
        column_order_staff=json.loads(model.column_order_staff),
        column_order_locations=json.loads(model.column_order_locations),
        show_archived_masters=model.show_archived_masters,
        show_archived_locations=model.show_archived_locations,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


class UserSettingsService:
    """CRUD service for UserSettings with JSON ↔ list conversion."""

    # GH #239: standalone transactional service (no GenericService ``_model``)
    # — canonical entity name declared explicitly (spec §3.3/§3.4).
    entity_name: str = "user_settings"

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

    # GH #319: the defaults core — NOT @transactional (callers own the
    # transaction). Reused by get_or_create_by_user_id, the user-creation
    # scenario and the «учётка» flow.
    @staticmethod
    async def insert_defaults(session: AsyncSession, user_id: str) -> None:
        """Atomically insert a defaults row for ``user_id`` if absent.

        SQLite ``INSERT ... ON CONFLICT(user_id) DO NOTHING`` — concurrent
        callers race safely (exactly one row lands, losers are silent
        no-ops). NO exception interception: a lock/unavailability failure
        propagates honestly (→ 500). Values are explicit literals —
        a mirror of the model defaults; change them together.
        """
        stmt = (
            sqlite_insert(UserSettings)
            .values(
                id=str(uuid.uuid4()),
                user_id=user_id,
                theme="light",
                language="ru",
                column_order_staff="[]",
                column_order_locations="[]",
                show_archived_masters=True,
                show_archived_locations=False,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            .on_conflict_do_nothing(index_elements=["user_id"])
        )
        await session.execute(stmt)

    @transactional
    async def get_or_create_by_user_id(
        self, session: AsyncSession, user_id: str
    ) -> UserSettingsResponse:
        """GH #319 get-or-create: return the user's settings row, creating
        the defaults row when missing.

        Atomic corridor: ``insert_defaults`` (ON CONFLICT DO NOTHING) +
        SELECT. A second concurrent caller simply reads the winner's row.
        If the SELECT still finds nothing, that is an honest failure —
        raise (no interception, no silent defaults response).
        """
        await self.insert_defaults(session, user_id)
        stmt = select(UserSettings).where(UserSettings.user_id == user_id)
        result = await session.execute(stmt)
        orm = result.scalar_one_or_none()
        if orm is None:
            raise RuntimeError(
                f"user_settings row for user {user_id!r} vanished after "
                f"ON CONFLICT DO NOTHING insert — database is unavailable "
                f"or the row was concurrently deleted"
            )
        return _to_response(orm)

    async def get_by_id(
        self, session: AsyncSession, id: str
    ) -> UserSettings | None:
        """Find a settings row by primary key. Returns the ORM row (GH #247
        §3.8: DELETE resolves the row's ``user_id`` for the ownership check)
        or None if not found."""
        stmt = select(UserSettings).where(UserSettings.id == id)
        result = await session.execute(stmt)
        return result.scalar_one_or_none()

    @transactional
    async def create(
        self, session: AsyncSession, data: UserSettingsCreate
    ) -> UserSettingsResponse:
        """Create new user settings."""
        orm = UserSettings(
            user_id=data.user_id,
            theme=data.theme,
            language=data.language,
            column_order_staff=json.dumps(data.column_order_staff),
            column_order_locations=json.dumps(data.column_order_locations),
            show_archived_masters=data.show_archived_masters,
            show_archived_locations=data.show_archived_locations,
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
        _not_null_fields = {
            "theme", "language", "column_order_staff", "column_order_locations",
            "show_archived_masters", "show_archived_locations",
        }
        for field in _not_null_fields:
            if field in update_data and update_data[field] is None:
                del update_data[field]

        # Serialize list fields to JSON strings
        if "column_order_staff" in update_data:
            update_data["column_order_staff"] = json.dumps(
                update_data["column_order_staff"]
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

    @staticmethod
    async def delete_by_user_ids(
        session: AsyncSession, user_ids: list[str]
    ) -> None:
        """Bulk-delete settings rows for the given user_ids.

        Set-based bulk command (canon rule 4): one
        ``DELETE FROM user_settings WHERE user_id IN (...)`` — filter by the
        entity's OWN column (``user_settings.user_id``). No per-row loop.
        Does NOT commit — the caller's transaction owns the commit boundary.
        GH #319: cascade death — settings die with their accounts.
        """
        if not user_ids:
            return
        await session.execute(
            delete(UserSettings).where(UserSettings.user_id.in_(user_ids))
        )

    @transactional
    async def delete(self, session: AsyncSession, id: str) -> bool:
        """Delete a settings record by its primary key ID."""
        return await self._repo.delete(session, UserSettings, id)


def get_user_settings_service() -> UserSettingsService:
    """Factory for UserSettingsService."""
    return UserSettingsService(get_base_repository())
