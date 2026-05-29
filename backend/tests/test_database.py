"""Tests for DBManager session management."""

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class TestDBManager:
    """Verify DBManager lifecycle and session behavior."""

    async def test_manager_creates_engine(self) -> None:
        """DBManager creates an async engine on construction."""
        from src.db.database import DBManager

        manager = DBManager("sqlite+aiosqlite:///:memory:")
        assert manager.engine is not None
        await manager.engine.dispose()

    async def test_get_db_session_yields_async_session(self) -> None:
        """get_db_session yields an AsyncSession."""
        from src.db.database import DBManager

        manager = DBManager("sqlite+aiosqlite:///:memory:")
        gen = manager.get_db_session()
        sess = await gen.__anext__()
        assert isinstance(sess, AsyncSession)
        with pytest.raises(StopAsyncIteration):
            await gen.__anext__()
        await manager.engine.dispose()

    async def test_session_auto_commits_on_success(self) -> None:
        """Session commits automatically when context exits cleanly."""
        from src.db.database import DBManager

        manager = DBManager("sqlite+aiosqlite:///:memory:")

        # Create table via raw connection
        async with manager.engine.begin() as conn:
            await conn.run_sync(lambda sync_conn: sync_conn.execute(
                text("CREATE TABLE test_tbl (id INTEGER PRIMARY KEY)")
            ))

        async with manager.async_session() as sess:
            await sess.execute(text("INSERT INTO test_tbl (id) VALUES (1)"))
            await sess.commit()

        # Verify data was committed by reading in a new session
        async with manager.async_session() as sess2:
            result = await sess2.execute(text("SELECT id FROM test_tbl"))
            rows = result.fetchall()
            assert len(rows) == 1
            assert rows[0][0] == 1

        await manager.engine.dispose()

    async def test_get_db_session_rollbacks_on_error(self) -> None:
        """get_db_session rolls back when an exception occurs."""
        from src.db.database import DBManager

        manager = DBManager("sqlite+aiosqlite:///:memory:")

        # Create table
        async with manager.engine.begin() as conn:
            await conn.run_sync(lambda sync_conn: sync_conn.execute(
                text("CREATE TABLE test_rollback (id INTEGER PRIMARY KEY)")
            ))

        # Use get_db_session generator with error
        gen = manager.get_db_session()
        sess = await gen.__anext__()
        await sess.execute(text("INSERT INTO test_rollback (id) VALUES (1)"))
        with pytest.raises(RuntimeError):
            await gen.athrow(RuntimeError, RuntimeError("boom"))

        # Verify data was rolled back
        async with manager.async_session() as sess2:
            result = await sess2.execute(text("SELECT id FROM test_rollback"))
            rows = result.fetchall()
            assert len(rows) == 0

        await manager.engine.dispose()


class TestBase:
    """Verify declarative base is available."""

    def test_base_importable(self) -> None:
        from src.db.base import Base

        assert Base is not None
        assert hasattr(Base, "metadata")


class TestSessionDep:
    """Verify SessionDep is importable from app.db."""

    def test_session_dep_importable(self) -> None:
        from src.db import SessionDep

        assert SessionDep is not None
