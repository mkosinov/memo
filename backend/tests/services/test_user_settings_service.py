"""UserSettingsService.get_or_create_by_user_id — GH #319 core.

The decorated get-or-create corridor: ``insert_defaults`` (atomic Core
``INSERT ... ON CONFLICT(user_id) DO NOTHING``) + SELECT. Pins:

* defaults materialize on first call and are WRITTEN to the DB;
* a SECOND call returns the SAME row (conflict → no-op, no IntegrityError);
* an existing customized row survives a get-or-create untouched;
* contract hygiene: ``insert_defaults`` is NOT transactional (callers own
  the transaction), ``get_or_create_by_user_id`` IS (corridor 1).
"""

from __future__ import annotations

import pytest

from src.models.user_settings import UserSettings
from src.schemas.user_settings import UserSettingsCreate
from src.services.user_settings import (
    UserSettingsService,
    get_user_settings_service,
)


@pytest.fixture
async def settings_user(db_session):
    """A fresh User row inserted through db_session (same-session FK parent)."""
    import uuid

    from src.models.user import User

    user = User(
        phone=f"+7999{uuid.uuid4().int % 10**10:010d}",
        password_hash="test",
        role="admin",
    )
    db_session.add(user)
    # Flush so the client-side uuid4 default materializes user.id (the
    # fixture yields a usable key, not a pending None).
    await db_session.flush()
    return user


class TestGetOrCreate:
    async def test_first_call_creates_defaults_row(
        self, db_session, settings_user
    ) -> None:
        service = get_user_settings_service()

        result = await service.get_or_create_by_user_id(
            db_session, settings_user.id
        )

        assert result.user_id == settings_user.id
        assert result.theme == "light"
        assert result.language == "ru"
        assert result.column_order_staff == []
        assert result.column_order_locations == []
        assert result.show_archived_masters is True
        assert result.show_archived_locations is False

        # Written to the DB (decorator committed), one row only
        from sqlalchemy import select

        rows = (
            (await db_session.execute(select(UserSettings)))
            .scalars()
            .all()
        )
        own = [r for r in rows if r.user_id == settings_user.id]
        assert len(own) == 1

    async def test_second_call_returns_same_row(
        self, db_session, settings_user
    ) -> None:
        service = get_user_settings_service()

        first = await service.get_or_create_by_user_id(
            db_session, settings_user.id
        )
        second = await service.get_or_create_by_user_id(
            db_session, settings_user.id
        )

        # ON CONFLICT DO NOTHING: no IntegrityError, same row id
        assert second.id == first.id
        assert second.user_id == settings_user.id

        from sqlalchemy import select

        rows = (
            (await db_session.execute(select(UserSettings)))
            .scalars()
            .all()
        )
        own = [r for r in rows if r.user_id == settings_user.id]
        assert len(own) == 1

    async def test_existing_customized_row_survives(
        self, db_session, settings_user
    ) -> None:
        """Get-or-create must NOT reset an existing customized row."""
        service = get_user_settings_service()
        await db_session.flush()  # settings_user gets its id
        created = await service.create(
            db_session,
            UserSettingsCreate(
                user_id=settings_user.id,
                theme="dark",
                language="en",
                column_order_staff=["color"],
            ),
        )

        result = await service.get_or_create_by_user_id(
            db_session, settings_user.id
        )

        assert result.id == created.id
        assert result.theme == "dark"
        assert result.language == "en"
        assert result.column_order_staff == ["color"]

    async def test_users_without_settings_row_get_none_from_plain_get(
        self, db_session, settings_user
    ) -> None:
        """Plain ``get_by_user_id`` keeps its old contract: None when missing
        (PUT/PATCH 404 + contract #179 depend on it — GH #319 leaves it
        untouched)."""
        await db_session.flush()
        service = get_user_settings_service()
        result = await service.get_by_user_id(db_session, settings_user.id)
        assert result is None


class TestDecoratorsContract:
    def test_insert_defaults_is_not_transactional(self) -> None:
        """The core is NOT decorated — callers own the transaction."""
        assert getattr(
            UserSettingsService.insert_defaults,
            "__memo_transactional__",
            False,
        ) is False

    def test_get_or_create_by_user_id_is_transactional(self) -> None:
        """Corridor 1: the get-or-create commits (defaults persist)."""
        assert getattr(
            UserSettingsService.get_or_create_by_user_id,
            "__memo_transactional__",
            False,
        ) is True
