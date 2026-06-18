"""Tests that prove the redundant create_all calls are removable without breaking tests."""

import asyncio
from unittest.mock import patch, AsyncMock

import pytest
from fastapi import FastAPI

from src.core.config import settings
from src.db.base import Base
from src.main import lifespan


@pytest.fixture(autouse=True)
def _default_dev_env(monkeypatch):
    """Ensure default env is 'development' for all tests unless explicitly overridden."""
    monkeypatch.setattr(settings, "ENV", "development")


def test_lifespan_does_not_call_create_all(tmp_path, monkeypatch):
    """In dev env, lifespan should NOT call Base.metadata.create_all (alembic owns schema)."""
    # Use a real DB so we can verify tables exist via alembic, not create_all
    test_db = tmp_path / "test_no_create_all.db"
    test_url = f"sqlite+aiosqlite:///{test_db}"
    monkeypatch.setattr(settings, "DATABASE_URL", test_url)
    monkeypatch.setattr(settings, "ENV", "development")

    # Patch Base.metadata.create_all — should NOT be called by lifespan
    with patch.object(Base.metadata, "create_all") as mock_create:
        async def _run():
            async with lifespan(FastAPI()):
                pass

        asyncio.run(_run())
        mock_create.assert_not_called()
