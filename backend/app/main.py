"""Memo backend — FastAPI application factory."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import create_engine

from app.admin.setup import setup_admin
from app.core.config import Settings
from app.db.base import Base
from app.db.database import DatabaseSessionManager, set_manager
from app.domain.locations.router import router as locations_router
from app.domain.masters.router import router as masters_router
from app.domain.services.router import router as services_router
from app.domain.system.router import router as system_router
from app.domain.activities.router import router as activities_router
from app.domain.tags.router import router as tags_router
from app.domain.clients.router import router as clients_router
from app.domain.visitors.router import router as visitors_router


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

    # Create all tables on startup (for in-memory test DB and initial setup).
    if manager.engine is not None:
        async with manager.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

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
    app.include_router(locations_router, prefix="/api/locations")
    app.include_router(masters_router, prefix="/api/masters")
    app.include_router(activities_router, prefix="/api/activities")
    app.include_router(tags_router, prefix="/api/tags")
    app.include_router(services_router, prefix="/api/services")
    app.include_router(clients_router, prefix="/api/clients")
    app.include_router(visitors_router, prefix="/api/visitors")

    # Mount SQLAdmin with a sync engine (separate from async app engine)
    admin_engine = create_engine(_sync_engine_url(settings.DATABASE_URL))
    setup_admin(app, admin_engine)

    return app
