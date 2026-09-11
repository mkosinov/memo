"""Tests for session-scoped fixtures (app, db_engine) + the authenticated
api_client / login_as fixtures (GH #247 T6).

These verify that the test infrastructure uses session-scoped fixtures
(app, db_engine) to avoid recreating the app and engine per test, while
``api_client`` is function-scoped and pre-authenticated as the fixture
admin (the autouse truncate wipes the sessions table per test, so a
session-scoped login would die at the first truncate).
"""

import asyncio
import uuid as _uuid

import pytest
from sqlalchemy import text

from src.auth.passwords import hash_password


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
                text("SELECT name FROM sqlite_master WHERE type='table' AND name='staff'")
            )
            assert result.scalar() is not None, "Schema must exist before test"

        # 2. Insert a test row
        async with db_engine.begin() as conn:
            await conn.execute(text(
                "INSERT INTO staff "
                "(id, first_name, last_name, sort_order, "
                "is_active, created_at, updated_at) "
                "VALUES (99999, 'Test', 'Truncate', "
                "0, 1, datetime('now'), datetime('now'))"
            ))

        # 3. Verify row exists
        async with db_engine.connect() as conn:
            result = await conn.execute(
                text("SELECT COUNT(*) FROM staff WHERE id=99999")
            )
            assert result.scalar() == 1

        # 4. Run truncate
        await _truncate_all_tables(db_engine)

        # 5. Verify row is gone
        async with db_engine.connect() as conn:
            result = await conn.execute(text("SELECT COUNT(*) FROM staff"))
            count = result.scalar()
            assert count == 0, f"All rows should be deleted, got {count}"

        # 6. Verify schema is still intact
        async with db_engine.connect() as conn:
            result = await conn.execute(text(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='staff'"
            ))
            schema = result.scalar()
            assert schema is not None, "Schema must be preserved after truncate"
            assert "first_name" in schema, "staff table columns must exist"

    asyncio.run(scenario())


def test_truncate_respects_fk_order(db_engine):
    """_truncate_all_tables should handle FK dependencies by deleting in reverse order.

    If tables are deleted in the wrong order with FK enforcement ON,
    integrity errors would occur. The function disables FK checks during deletion.
    """
    from tests.conftest import _truncate_all_tables

    async def scenario():
        # Insert into staff (masters extension references staff via FK)
        async with db_engine.begin() as conn:
            await conn.execute(text(
                "INSERT INTO staff "
                "(id, first_name, last_name, sort_order, "
                "is_active, created_at, updated_at) "
                "VALUES (88888, 'FK', 'Test', "
                "0, 1, datetime('now'), datetime('now'))"
            ))

        # Verify rows exist
        async with db_engine.connect() as conn:
            result = await conn.execute(text("SELECT COUNT(*) FROM staff"))
            assert result.scalar() >= 1

        # Truncate — must not raise FK errors
        await _truncate_all_tables(db_engine)

        # Verify all rows gone
        async with db_engine.connect() as conn:
            result = await conn.execute(text("SELECT COUNT(*) FROM staff"))
            assert result.scalar() == 0

    asyncio.run(scenario())


# ─── GH #247 T6: authenticated api_client + login_as ──────────────────────────


class TestAuthenticatedApiClient:
    def test_api_client_is_authenticated_admin(self, api_client) -> None:
        """api_client arrives with a valid admin memo_session cookie jar.

        The fixture INSERTs the admin after the per-test truncate and logs
        in via POST /api/v1/auth/login (spec §7) — /me must answer 200
        with the admin principal.
        """
        resp = api_client.get("/api/v1/auth/me")
        assert resp.status_code == 200, f"api_client not authenticated: {resp.text}"
        body = resp.json()
        assert body["user"]["phone"] == "+79990000001"
        assert body["user"]["role"] == "admin"

    def test_api_client_admin_row_exists_in_db(self, api_client) -> None:
        """The fixture admin is a real users row (role=admin, is_active)."""
        from tests.conftest import query_db

        rows = query_db("SELECT role, is_active FROM users WHERE phone='+79990000001'")
        assert len(rows) == 1
        assert rows[0]["role"] == "admin"
        assert rows[0]["is_active"] == 1


class TestLoginAs:
    def test_login_as_yields_fresh_client_for_role_user(self, login_as) -> None:
        """login_as(phone, password) → separate authenticated TestClient.

        Inserts a master-role user directly (the ``_user`` pattern, no
        user API) with a real hash_password hash, then logs in as them.
        """
        import uuid as _uuid

        from src.auth.passwords import hash_password

        from tests.conftest import query_db

        phone = "+79990000002"
        query_db(
            "INSERT INTO users (id, phone, password_hash, role, "
            "email_is_confirmed, phone_is_confirmed, is_active, created_at, updated_at) "
            f"VALUES ('{_uuid.uuid4()}', '{phone}', '{hash_password('master-pass-1')}', "
            "'master', 0, 0, 1, datetime('now'), datetime('now'))"
        )

        other = login_as(phone, "master-pass-1")

        resp = other.get("/api/v1/auth/me")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["user"]["phone"] == phone
        assert body["user"]["role"] == "master"
