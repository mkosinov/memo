"""Async database session management for SQLAlchemy 2.0."""

from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import Depends
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


@event.listens_for(Engine, "connect")
def _set_sqlite_pragmas(dbapi_connection: Any, connection_record: Any) -> None:
    """Set busy_timeout + WAL on every new DBAPI connection.

    Registered at the class-level ``Engine`` (not ``engine.sync_engine``) so it
    covers all three SQLite engines in the process: the app async engine
    (this module), Alembic's sync engine (``db/migrate.py``), and sqladmin's
    sync engine (``admin/setup.py``). ``busy_timeout`` is per-connection and
    must be reissued on every connect; ``journal_mode=WAL`` is persisted in
    the DB file header but harmless to reissue. WAL is safe for this
    deployment (single-host/process/local-disk — see ADR 001).

    Guard: this listener is process-global (fires for ANY SQLAlchemy engine,
    not just SQLite), so it must bail out for non-sqlite dialects to avoid
    crashing a future PostgreSQL/etc. connection with "no such pragma".
    ``connection_record.engine`` does not exist on SQLAlchemy 2.0's
    ``ConnectionPoolEntry`` (verified empirically), so we check the DBAPI
    connection's module path instead: pysqlite's driver module is
    ``sqlite3`` and aiosqlite's adapter module is
    ``sqlalchemy.dialects.sqlite.aiosqlite`` — both contain "sqlite", and no
    other dialect's DBAPI module does.
    """
    if "sqlite" not in type(dbapi_connection).__module__:
        return
    # GH #212 M5: full-Unicode case folding for ilike — stock SQLite lower()
    # folds ASCII only. Python str.lower agrees with SQLite lower() on ASCII,
    # so pre-existing ASCII queries are unaffected.
    dbapi_connection.create_function(
        "lower", 1, lambda s: s.lower() if s is not None else None
    )
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


class DBManager:
    """Manages the async engine and provides a FastAPI-compatible session dependency."""

    def __init__(self, db_url: str, echo_mode: bool = False) -> None:
        self.engine = create_async_engine(db_url, echo=echo_mode, future=True)
        self.async_session = async_sessionmaker(
            self.engine,
            expire_on_commit=False,
        )

    async def get_db_session(self) -> AsyncIterator[AsyncSession]:
        """FastAPI dependency: yields a transactional session, commits on success, rolls back on error."""
        async with self.async_session() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise
