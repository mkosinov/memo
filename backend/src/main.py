"""Memo backend — FastAPI application factory."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from src.admin.setup import setup_admin
from src.core.config import settings
from src.db import db_manager
from src.db.base import Base
from src.api.v1.activities import router as activities_router
from src.api.v1.clients import router as clients_router
from src.api.v1.locations import router as locations_router
from src.api.v1.masters import router as masters_router
from src.api.v1.payments import router as payments_router
from src.api.v1.records import router as records_router
from src.api.v1.services import router as services_router
from src.api.v1.system import router as system_router
from src.api.v1.tags import router as tags_router
from src.api.v1.visitors import router as visitors_router
from src.api.v1.photos import router as photos_router
from src.api.v1.materials import router as materials_router
from src.api.v1.search import router as search_router
from src.api.v1.user_settings import router as user_settings_router
from src.api.v1.visits import router as visits_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    async with db_manager.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


def create_app() -> FastAPI:
    app = FastAPI(title=settings.PROJECT_NAME, lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(IntegrityError)
    async def integrity_error_handler(request: Request, exc: IntegrityError):
        """Convert SQLAlchemy IntegrityError (FK violations, unique constraints)
        into a proper 422 Unprocessable Entity response."""
        return JSONResponse(
            status_code=422,
            content={"detail": "Database integrity constraint violated"},
        )

    setup_admin(app)

    # API v1
    app.include_router(masters_router, prefix="/api/v1/masters")
    app.include_router(locations_router, prefix="/api/v1/locations")
    app.include_router(services_router, prefix="/api/v1/services")
    app.include_router(tags_router, prefix="/api/v1/tags")
    app.include_router(activities_router, prefix="/api/v1/activities")
    app.include_router(clients_router, prefix="/api/v1/clients")
    app.include_router(visitors_router, prefix="/api/v1/visitors")
    app.include_router(records_router, prefix="/api/v1/records")
    app.include_router(photos_router, prefix="/api/v1/photos")
    app.include_router(visits_router, prefix="/api/v1/visits")
    app.include_router(payments_router, prefix="/api/v1/payments")
    app.include_router(materials_router, prefix="/api/v1/materials")
    app.include_router(search_router, prefix="/api/v1/search")
    app.include_router(user_settings_router, prefix="/api/v1/user-settings")
    app.include_router(system_router, prefix="/api/v1")

    return app


app = create_app()
