"""Env-gated behavior in main.py: sqladmin opt-in flag, alembic skip in testing.

GH #616 §3.4 retired the ``ENV != "testing"`` sqladmin inversion: the admin
console mounts ONLY behind the explicit ``SQLADMIN_ENABLED`` flag
(deny-by-default — an unset variable must mean OFF, not on). The test
contour opts in via ``.env.test`` so the shared session app keeps the
sqladmin pages exercised (``test_admin_sqladmin_pages.py``).
"""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI

from src.core.config import Settings, settings
from src.main import lifespan


@pytest.fixture(autouse=True)
def _default_dev_env(monkeypatch):
    """Ensure default env is 'development' for all tests unless explicitly overridden."""
    monkeypatch.setattr(settings, "ENV", "development")


def test_sqladmin_flag_defaults_off() -> None:
    """Deny-by-default (#616 §3.4): a fresh Settings (no env file, no env
    vars) never enables sqladmin — the flag is pure opt-in."""
    fresh = Settings(_env_file=None)
    assert fresh.SQLADMIN_ENABLED is False


def test_create_app_skips_admin_when_flag_off(monkeypatch) -> None:
    """Flag off → NO admin routes, whatever the ENV value."""
    monkeypatch.setattr(settings, "SQLADMIN_ENABLED", False)

    with patch("src.main.run_alembic_upgrade", new=AsyncMock()):
        # Import fresh to avoid cached module-level `app`
        from src.main import create_app
        app = create_app()

    admin_routes = [r for r in app.routes if hasattr(r, "path") and "/admin" in r.path]
    assert admin_routes == [], f"create_app added admin routes with the flag off: {admin_routes}"


def test_create_app_adds_admin_when_flag_enabled(monkeypatch) -> None:
    """Explicit opt-in → admin routes are mounted."""
    monkeypatch.setattr(settings, "SQLADMIN_ENABLED", True)

    from src.main import create_app
    app = create_app()

    admin_routes = [r for r in app.routes if hasattr(r, "path") and "/admin" in r.path]
    assert len(admin_routes) > 0, "create_app should have added admin routes when the flag is on"


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
