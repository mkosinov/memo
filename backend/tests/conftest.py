"""Shared test fixtures and configuration."""

import asyncio
import os

import pytest

# Use in-memory SQLite for all tests — must be set before any app imports.
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"


@pytest.fixture(autouse=True)
def reset_db():
    """Drop and recreate all tables before each test for isolation.

    This ensures zero data leaking between tests — each test starts with a
    clean database. Uses ``asyncio.run()`` because the shared ``db_manager``
    engine is async but the API tests are sync.
    """
    # Import all models so they register with Base.metadata, then reset.
    from app.db import db_manager  # noqa: F811
    from app.db.base import Base
    from app.db.models import (  # noqa: F401
        Activity,
        Client,
        Location,
        Master,
        Payment,
        Photo,
        Record,
        Service,
        Tag,
        Tariff,
        User,
        Visit,
        Visitor,
    )

    async def _reset() -> None:
        async with db_manager.engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_reset())
