"""Tests for the alembic upgrade runner (issue #61)."""

import asyncio
from pathlib import Path

import pytest
from sqlalchemy import text


# Path to backend root (where alembic.ini lives)
BACKEND_DIR = Path(__file__).resolve().parents[1]


def test_run_alembic_upgrade_on_already_at_head(tmp_path) -> None:
    """When DB is at head, run_alembic_upgrade is a no-op (no errors)."""
    from alembic import command
    from alembic.config import Config

    from src.db.base import Base
    from src.db.database import DBManager
    from src.db.migrate import run_alembic_upgrade

    test_db = tmp_path / "test_at_head.db"
    test_url = f"sqlite+aiosqlite:///{test_db}"

    async def scenario():
        mgr = DBManager(test_url, echo_mode=False)
        # Create schema and stamp to head first
        async with mgr.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        # Stamp to head using alembic (sync — needs sync URL)
        sync_url = test_url.replace("+aiosqlite", "")
        cfg = Config(str(BACKEND_DIR / "alembic.ini"))
        cfg.set_main_option("sqlalchemy.url", sync_url)
        cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
        command.stamp(cfg, "head")

        # Now run_alembic_upgrade must be a no-op
        await run_alembic_upgrade(test_url)

        async with mgr.engine.connect() as conn:
            version = (
                await conn.execute(text("SELECT version_num FROM alembic_version"))
            ).scalar()
            assert version is not None, "alembic_version should have a version"

        await mgr.engine.dispose()

    asyncio.run(scenario())


def test_run_alembic_upgrade_fails_when_alembic_version_missing(tmp_path) -> None:
    """When alembic_version doesn't exist, raise RuntimeError with guidance."""
    from src.db.base import Base
    from src.db.database import DBManager
    from src.db.migrate import run_alembic_upgrade

    test_db = tmp_path / "test_no_alembic.db"
    test_url = f"sqlite+aiosqlite:///{test_db}"

    async def scenario():
        mgr = DBManager(test_url, echo_mode=False)
        async with mgr.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        # No stamping — alembic_version doesn't exist
        with pytest.raises(RuntimeError, match="alembic_version"):
            await run_alembic_upgrade(test_url)
        await mgr.engine.dispose()

    asyncio.run(scenario())
