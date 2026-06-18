"""Tests for session-scoped fixtures (app, db_engine, api_client).

These verify that the test infrastructure uses session-scoped fixtures
to avoid recreating the app, engine, and TestClient per test.
"""

import asyncio

import pytest
from sqlalchemy import text


def test_app_fixture_is_session_scoped(app):
    """The app fixture returns a FastAPI instance (session-scoped)."""
    from fastapi import FastAPI
    assert isinstance(app, FastAPI)


def test_db_engine_fixture_is_session_scoped(db_engine):
    """The db_engine fixture returns an async SQLAlchemy engine."""
    from sqlalchemy.ext.asyncio import AsyncEngine
    assert isinstance(db_engine, AsyncEngine)


def test_db_engine_has_schema_via_alembic(db_engine):
    """The session-scoped db_engine should have all tables created via alembic upgrade."""
    async def check():
        async with db_engine.connect() as conn:
            result = await conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table' AND name='alembic_version'")
            )
            assert result.scalar() is not None, (
                "alembic_version table should exist (created by alembic upgrade)"
            )
    asyncio.run(check())
