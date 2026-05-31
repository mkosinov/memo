"""Shared test fixtures and configuration."""

import asyncio
import os
import tempfile

import pytest

# Use a temporary file for SQLite so connections work across event loops.
# In-memory SQLite (`:memory:`) creates a new database per connection, and
# ``asyncio.run()`` in ``reset_db`` runs in a different event loop than the
# TestClient's lifespan, causing "no such table" errors.
_db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_db_file.close()
_TEST_DB_URL = f"sqlite+aiosqlite:///{_db_file.name}"

os.environ["DATABASE_URL"] = _TEST_DB_URL
os.environ["ENV_FILE"] = ".env.test"


@pytest.fixture(autouse=True)
def reset_db():
    """Drop and recreate all tables before each test for isolation.

    This ensures zero data leaking between tests — each test starts with a
    clean database. Uses ``asyncio.run()`` because the shared ``db_manager``
    engine is async but the API tests are sync.
    """
    # Import all models so they register with Base.metadata, then reset.
    from src.db import db_manager  # noqa: F811
    from src.db.base import Base
    from src.models import (  # noqa: F401
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
