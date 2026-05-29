"""Memo backend — FastAPI application factory."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.admin.setup import setup_admin
from app.core.config import settings
from app.db import db_manager
from app.db.base import Base
from app.domain.activities.router import router as activities_router
from app.domain.clients.router import router as clients_router
from app.domain.locations.router import router as locations_router
from app.domain.masters.router import router as masters_router
from app.domain.payments.router import router as payments_router
from app.domain.records.router import router as records_router
from app.domain.services.router import router as services_router
from app.domain.system.router import router as system_router
from app.domain.tags.router import router as tags_router
from app.domain.visitors.router import router as visitors_router
from app.domain.visits.router import router as visits_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Application lifespan — drop and recreate tables on startup for test isolation."""
    async with db_manager.engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


def create_app() -> FastAPI:
    """Application factory."""
    app = FastAPI(
        title=settings.PROJECT_NAME,
        lifespan=lifespan,
    )

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # SQLAdmin — mounted at /admin
    setup_admin(app)

    # Routers
    app.include_router(masters_router, prefix="/api/masters")
    app.include_router(locations_router, prefix="/api/locations")
    app.include_router(services_router, prefix="/api/services")
    app.include_router(tags_router, prefix="/api/tags")
    app.include_router(activities_router, prefix="/api/activities")
    app.include_router(clients_router, prefix="/api/clients")
    app.include_router(visitors_router, prefix="/api/visitors")
    app.include_router(records_router, prefix="/api/records")
    app.include_router(visits_router, prefix="/api/visits")
    app.include_router(payments_router, prefix="/api/payments")
    app.include_router(system_router, prefix="/api")

    return app


app = create_app()
