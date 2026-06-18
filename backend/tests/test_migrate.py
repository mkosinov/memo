"""Tests for the alembic upgrade runner (issue #61).

Contract change (2026-06-18):
When ``alembic_version`` is missing, the function self-heals by stamping to
head (legacy DB bootstrap). Previously it raised ``RuntimeError``.

Fast-path (2026-06-18):
When ``alembic_version`` already matches script head, ``command.upgrade``
is NOT called — saving ~100-250ms per startup.
"""

import asyncio
from pathlib import Path

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


def test_run_alembic_upgrade_stamps_when_alembic_version_missing(tmp_path) -> None:
    """When alembic_version is missing but model tables exist (legacy DB),
    run_alembic_upgrade should stamp to head and complete without error."""
    from alembic.script import ScriptDirectory

    from src.db.base import Base
    from src.db.database import DBManager
    from src.db.migrate import run_alembic_upgrade

    test_db = tmp_path / "test_no_alembic.db"
    test_url = f"sqlite+aiosqlite:///{test_db}"

    async def scenario():
        mgr = DBManager(test_url, echo_mode=False)
        # Simulate legacy DB: all model tables exist, but no alembic_version
        async with mgr.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        # No stamping — alembic_version table is absent

        # Must NOT raise — self-heal by stamping to head
        await run_alembic_upgrade(test_url)

        # Verify alembic_version table now exists with a revision
        async with mgr.engine.connect() as conn:
            version = (
                await conn.execute(text("SELECT version_num FROM alembic_version"))
            ).scalar()
            assert version is not None, (
                "alembic_version should exist after self-heal"
            )
            # Verify it matches the current head
            from alembic.config import Config

            cfg = Config(str(BACKEND_DIR / "alembic.ini"))
            cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
            heads = ScriptDirectory.from_config(cfg).get_heads()
            assert version in heads, (
                f"Stamped revision {version!r} should be in heads {heads!r}"
            )

        await mgr.engine.dispose()

    asyncio.run(scenario())


def test_run_alembic_upgrade_fast_path_when_at_head(tmp_path, monkeypatch) -> None:
    """When at head, command.upgrade is NOT called (fast-path)."""
    from alembic import command
    from alembic.config import Config

    from src.db.base import Base
    from src.db.database import DBManager
    from src.db.migrate import run_alembic_upgrade

    test_db = tmp_path / "test_fast_path.db"
    test_url = f"sqlite+aiosqlite:///{test_db}"

    async def scenario():
        mgr = DBManager(test_url, echo_mode=False)
        async with mgr.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        sync_url = test_url.replace("+aiosqlite", "")
        cfg = Config(str(BACKEND_DIR / "alembic.ini"))
        cfg.set_main_option("sqlalchemy.url", sync_url)
        cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
        command.stamp(cfg, "head")

        # Patch command.upgrade — should NOT be called
        upgrade_calls = []
        original_upgrade = command.upgrade

        def track_upgrade(*args, **kwargs):
            upgrade_calls.append((args, kwargs))
            return original_upgrade(*args, **kwargs)

        monkeypatch.setattr(command, "upgrade", track_upgrade)

        await run_alembic_upgrade(test_url)
        assert len(upgrade_calls) == 0, (
            f"command.upgrade called {len(upgrade_calls)} times — fast-path failed"
        )
        await mgr.engine.dispose()

    asyncio.run(scenario())
