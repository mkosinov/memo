"""GH #319 С4 — get-or-create race: two REAL sessions, one file DB.

Scenario (spec §7 С4): a user WITHOUT a settings row is read by two
concurrent sessions, each holding its OWN connection to a FILE-based
SQLite database (not the shared per-session test DB, not :memory:).
Both ``get_or_create_by_user_id`` calls must return the SAME row, and no
uniqueness error may surface.

The guarantee is the Core-level ``INSERT ... ON CONFLICT(user_id)
DO NOTHING`` in ``UserSettingsService.insert_defaults``: exactly one
writer lands the row, the loser is a silent no-op and reads the winner's
row. WAL + busy_timeout make the second writer WAIT for the first commit
instead of failing with SQLITE_BUSY — mirroring the production engine
pragmas (src/db/database.py).
"""

from __future__ import annotations

import asyncio
import uuid
from pathlib import Path

import pytest
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    async_sessionmaker,
    create_async_engine,
)

from src.db.base import Base
from src.models.user import User
from src.models.user_settings import UserSettings
from src.schemas.user_settings import UserSettingsResponse
from src.services.user_settings import get_user_settings_service


def _file_engine(db_path: Path) -> AsyncEngine:
    """An async engine with its OWN connection pool to the file DB."""
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")

    @event.listens_for(engine.sync_engine, "connect")
    def _pragmas(dbapi_conn, _record) -> None:
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


@pytest.fixture
async def race_db_path(tmp_path: Path) -> Path:
    """A FILE-based SQLite DB with the full schema — isolated from the
    shared per-session test DB and from every other test."""
    db_path = tmp_path / "race.db"
    engine = _file_engine(db_path)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()
    return db_path


class TestGetOrCreateRace:
    async def test_two_concurrent_sessions_land_one_shared_row(
        self, race_db_path: Path
    ) -> None:
        # The FK parent: a user row exists, its settings row does NOT.
        seed = _file_engine(race_db_path)
        seed_maker = async_sessionmaker(seed, expire_on_commit=False)
        async with seed_maker() as session:
            user = User(
                phone=f"+7999{uuid.uuid4().int % 10**10:010d}",
                password_hash="test",
                role="admin",
            )
            session.add(user)
            await session.commit()
            user_id = user.id
        await seed.dispose()

        # Two REAL sessions, each with its OWN engine/connection pool to
        # the same file DB — the tab-race shape from spec §7 С4.
        engines = [_file_engine(race_db_path), _file_engine(race_db_path)]
        makers = [async_sessionmaker(e, expire_on_commit=False) for e in engines]
        service = get_user_settings_service()

        async def get_or_create(
            maker: async_sessionmaker,
        ) -> UserSettingsResponse:
            async with maker() as session:
                return await service.get_or_create_by_user_id(session, user_id)

        # No IntegrityError / OperationalError surfaces — gather re-raises
        # anything that leaks out of the corridor.
        first, second = await asyncio.gather(
            get_or_create(makers[0]),
            get_or_create(makers[1]),
        )

        # Both readers got the SAME row with defaults.
        assert first.id == second.id
        assert first.user_id == user_id
        assert first.theme == "light"

        # Exactly one row persisted — the winner's.
        async with makers[0]() as session:
            rows = (
                (
                    await session.execute(
                        select(UserSettings).where(
                            UserSettings.user_id == user_id
                        )
                    )
                )
                .scalars()
                .all()
            )
            assert len(rows) == 1
            assert rows[0].id == first.id

        for engine in engines:
            await engine.dispose()
