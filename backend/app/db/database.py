"""Async database session management for SQLAlchemy 2.0."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


class DatabaseSessionManager:
    """Manages async SQLAlchemy engine and session lifecycle.

    Usage:
        manager = DatabaseSessionManager("sqlite+aiosqlite:///./app.db")
        await manager.init()
        async with manager.session() as sess:
            ...
        await manager.close()
    """

    def __init__(self, database_url: str) -> None:
        self._database_url = database_url
        self.engine: AsyncEngine | None = None
        self._session_factory: async_sessionmaker[AsyncSession] | None = None

    async def init(self) -> None:
        """Create the async engine and session factory."""
        self.engine = create_async_engine(self._database_url, echo=False)
        self._session_factory = async_sessionmaker(
            self.engine,
            expire_on_commit=False,
        )

    async def close(self) -> None:
        """Dispose of the engine and all pooled connections."""
        if self.engine is not None:
            await self.engine.dispose()
            self.engine = None
            self._session_factory = None

    @asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        """Provide a transactional session scope.

        Commits on clean exit, rolls back on exception.
        """
        if self._session_factory is None:
            raise RuntimeError("DatabaseSessionManager is not initialized. Call init() first.")

        async with self._session_factory() as sess:
            try:
                yield sess
                await sess.commit()
            except Exception:
                await sess.rollback()
                raise


# Module-level manager instance used by the FastAPI dependency.
_manager: DatabaseSessionManager | None = None


def set_manager(manager: DatabaseSessionManager) -> None:
    """Set the global session manager (called during app startup)."""
    global _manager
    _manager = manager


async def get_db_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency that yields a transactional database session.

    Usage in a router:
        @router.get("/items")
        async def list_items(session: AsyncSession = Depends(get_db_session)):
            ...
    """
    if _manager is None:
        raise RuntimeError("No DatabaseSessionManager configured. Call set_manager() first.")

    async with _manager.session() as sess:
        yield sess
