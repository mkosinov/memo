"""Tests for database session management."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession


class TestDatabaseSessionManager:
    """Verify DatabaseSessionManager lifecycle."""

    async def test_manager_init_and_close(self) -> None:
        """Manager can initialize and close without errors."""
        from app.db.database import DatabaseSessionManager

        manager = DatabaseSessionManager("sqlite+aiosqlite:///:memory:")
        await manager.init()
        assert manager.engine is not None
        await manager.close()

    async def test_session_yields_async_session(self) -> None:
        """session() context manager yields an AsyncSession."""
        from app.db.database import DatabaseSessionManager

        manager = DatabaseSessionManager("sqlite+aiosqlite:///:memory:")
        await manager.init()

        async with manager.session() as sess:
            assert isinstance(sess, AsyncSession)

        await manager.close()

    async def test_session_auto_commits_on_success(self) -> None:
        """Session commits automatically when context exits cleanly."""
        from sqlalchemy import text

        from app.db.database import DatabaseSessionManager

        manager = DatabaseSessionManager("sqlite+aiosqlite:///:memory:")
        await manager.init()

        async with manager.session() as sess:
            await sess.execute(text("CREATE TABLE test_tbl (id INTEGER PRIMARY KEY)"))
            await sess.execute(text("INSERT INTO test_tbl (id) VALUES (1)"))

        # Verify data was committed by reading in a new session
        async with manager.session() as sess2:
            result = await sess2.execute(text("SELECT id FROM test_tbl"))
            rows = result.fetchall()
            assert len(rows) == 1
            assert rows[0][0] == 1

        await manager.close()

    async def test_session_rollbacks_on_error(self) -> None:
        """Session rolls back when an exception occurs inside the context."""
        from sqlalchemy import text

        from app.db.database import DatabaseSessionManager

        manager = DatabaseSessionManager("sqlite+aiosqlite:///:memory:")
        await manager.init()

        # Create table first (committed)
        async with manager.session() as sess:
            await sess.execute(text("CREATE TABLE test_tbl2 (id INTEGER PRIMARY KEY)"))

        # Attempt insert then raise error
        with pytest.raises(ValueError, match="boom"):
            async with manager.session() as sess:
                await sess.execute(text("INSERT INTO test_tbl2 (id) VALUES (1)"))
                raise ValueError("boom")

        # Verify data was rolled back
        async with manager.session() as sess2:
            result = await sess2.execute(text("SELECT id FROM test_tbl2"))
            rows = result.fetchall()
            assert len(rows) == 0

        await manager.close()


class TestBase:
    """Verify declarative base is available."""

    def test_base_importable(self) -> None:
        from app.db.base import Base

        assert Base is not None
        assert hasattr(Base, "metadata")


class TestGetDbSession:
    """Verify the FastAPI dependency function."""

    async def test_get_db_session_yields_session(self) -> None:
        """get_db_session yields an AsyncSession."""
        from app.db.database import DatabaseSessionManager, get_db_session

        manager = DatabaseSessionManager("sqlite+aiosqlite:///:memory:")
        await manager.init()

        # Temporarily set the global manager for the DI function
        import app.db.database as db_mod

        original = db_mod._manager
        db_mod._manager = manager

        try:
            gen = get_db_session()
            sess = await gen.__anext__()
            assert isinstance(sess, AsyncSession)
            # Exhaust the generator to trigger commit/close
            with pytest.raises(StopAsyncIteration):
                await gen.__anext__()
        finally:
            db_mod._manager = original
            await manager.close()
