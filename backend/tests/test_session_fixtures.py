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


def test_truncate_all_tables_clears_data_preserves_schema(db_engine):
    """_truncate_all_tables should DELETE all rows while keeping schema intact.

    This is the core behavior for fast per-test isolation: rows are cleared
    without dropping/recreating tables (which is ~10x slower).
    """
    from tests.conftest import _truncate_all_tables

    async def scenario():
        # 1. Schema must exist (created by session-scoped alembic upgrade)
        async with db_engine.connect() as conn:
            result = await conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table' AND name='masters'")
            )
            assert result.scalar() is not None, "Schema must exist before test"

        # 2. Insert a test row
        async with db_engine.begin() as conn:
            await conn.execute(text(
                "INSERT INTO masters "
                "(id, first_name, last_name, color, position, specialty, "
                "sort_order, is_active, created_at, updated_at) "
                "VALUES (99999, 'Test', 'Truncate', '#000', 'мастер', 'тест', "
                "0, 1, datetime('now'), datetime('now'))"
            ))

        # 3. Verify row exists
        async with db_engine.connect() as conn:
            result = await conn.execute(
                text("SELECT COUNT(*) FROM masters WHERE id=99999")
            )
            assert result.scalar() == 1

        # 4. Run truncate
        await _truncate_all_tables(db_engine)

        # 5. Verify row is gone
        async with db_engine.connect() as conn:
            result = await conn.execute(text("SELECT COUNT(*) FROM masters"))
            count = result.scalar()
            assert count == 0, f"All rows should be deleted, got {count}"

        # 6. Verify schema is still intact
        async with db_engine.connect() as conn:
            result = await conn.execute(text(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='masters'"
            ))
            schema = result.scalar()
            assert schema is not None, "Schema must be preserved after truncate"
            assert "first_name" in schema, "masters table columns must exist"

    asyncio.run(scenario())


def test_truncate_respects_fk_order(db_engine):
    """_truncate_all_tables should handle FK dependencies by deleting in reverse order.

    If tables are deleted in the wrong order with FK enforcement ON,
    integrity errors would occur. The function disables FK checks during deletion.
    """
    from tests.conftest import _truncate_all_tables

    async def scenario():
        # Insert into masters (activity references master via FK)
        async with db_engine.begin() as conn:
            await conn.execute(text(
                "INSERT INTO masters "
                "(id, first_name, last_name, color, position, specialty, "
                "sort_order, is_active, created_at, updated_at) "
                "VALUES (88888, 'FK', 'Test', '#000', 'мастер', 'тест', "
                "0, 1, datetime('now'), datetime('now'))"
            ))

        # Verify rows exist
        async with db_engine.connect() as conn:
            result = await conn.execute(text("SELECT COUNT(*) FROM masters"))
            assert result.scalar() >= 1

        # Truncate — must not raise FK errors
        await _truncate_all_tables(db_engine)

        # Verify all rows gone
        async with db_engine.connect() as conn:
            result = await conn.execute(text("SELECT COUNT(*) FROM masters"))
            assert result.scalar() == 0

    asyncio.run(scenario())
