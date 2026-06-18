"""Tests for test env behavior in main.py: skip setup_admin and skip alembic upgrade."""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI

from src.core.config import settings
from src.main import lifespan


@pytest.fixture(autouse=True)
def _default_dev_env(monkeypatch):
    """Ensure default env is 'development' for all tests unless explicitly overridden."""
    monkeypatch.setattr(settings, "ENV", "development")


def test_create_app_skips_admin_when_testing(monkeypatch):
    """When ENV == 'testing', create_app should NOT add admin routes."""
    monkeypatch.setattr(settings, "ENV", "testing")

    with patch("src.main.run_alembic_upgrade", new=AsyncMock()):
        # Import fresh to avoid cached module-level `app`
        from src.main import create_app
        app = create_app()

    admin_routes = [r for r in app.routes if hasattr(r, "path") and "/admin" in r.path]
    assert admin_routes == [], f"create_app added admin routes in test env: {admin_routes}"


def test_create_app_adds_admin_when_dev():
    """When ENV != 'testing', create_app should add admin routes."""
    from src.main import create_app
    app = create_app()

    admin_routes = [r for r in app.routes if hasattr(r, "path") and "/admin" in r.path]
    assert len(admin_routes) > 0, "create_app should have added admin routes in dev env"


def test_lifespan_skips_alembic_in_test_env(monkeypatch):
    """When ENV == 'testing', lifespan does not call run_alembic_upgrade."""
    monkeypatch.setattr(settings, "ENV", "testing")

    with patch("src.main.run_alembic_upgrade", new=AsyncMock()) as mock:
        app = FastAPI()
        asyncio.run(_run_lifespan(app))
        mock.assert_not_called()


async def _run_lifespan(app):
    async with lifespan(app):
        pass
