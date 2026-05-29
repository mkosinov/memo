"""Memo backend — FastAPI application factory."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import create_engine

from app.admin.setup import setup_admin
from app.core.config import Settings
from app.db.database import DatabaseSessionManager, set_manager
from app.domain.system.router import router as system_router


def _sync_engine_url(async_url: str) -> str:
    """Convert async SQLAlchemy URL to sync URL."""
    return async_url.replace("sqlite+aiosqlite://", "sqlite://")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialize and tear down application resources."""
    settings = Settings()
    manager = DatabaseSessionManager(settings.DATABASE_URL)
    await manager.init()
    set_manager(manager)
    try:
        yield
    finally:
        await manager.close()


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    settings = Settings()

    app = FastAPI(
        title="Memo Backend",
        description="ColourMountains art studio management system",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.include_router(system_router, prefix="/api/health")

    # Mount SQLAdmin with a sync engine (separate from async app engine)
    admin_engine = create_engine(_sync_engine_url(settings.DATABASE_URL))
    setup_admin(app, admin_engine)

    return app
