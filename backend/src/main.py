"""Memo backend — FastAPI application factory."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

from src.errors import ErrorCode, ErrorDetail

from src.admin.setup import setup_admin
from src.core.config import settings
from src.db import db_manager
from src.db.migrate import run_alembic_upgrade
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
    # In test env: conftest handles table creation, skip alembic
    if settings.ENV != "testing":
        await run_alembic_upgrade(str(settings.DATABASE_URL))
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

    # ── Global exception handlers ──────────────────────────────────────────
    # All handlers return {detail: {code, message}} via ErrorDetail.
    # Registered BEFORE include_router so they catch errors from all routes.

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        """Convert FastAPI HTTPException → {detail: {code, message}}.

        Supports two detail shapes:
        - If raise site passed a string detail: look up code by status, fallback to INTERNAL_ERROR
        - If raise site passed an ErrorDetail dict (new style): preserve code + message
        """
        detail = exc.detail
        if isinstance(detail, dict) and "code" in detail and "message" in detail:
            # New style: already an ErrorDetail dict
            return JSONResponse(
                status_code=exc.status_code,
                content={"detail": detail},
            )
        # Legacy / string detail: map status → code
        code = _status_to_code(exc.status_code)
        message = str(detail) if detail else ErrorCode.INTERNAL_ERROR.value
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": ErrorDetail(code=code, message=message).model_dump()},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        """Convert Pydantic validation errors → {detail: {code, message}}.

        Takes the first error's msg as the message. Real fix is on the
        caller side; toast says "Проверьте правильность заполнения полей".
        """
        errors = exc.errors()
        first_msg = errors[0]["msg"] if errors else "Validation error"
        # Strip FastAPI's "Value error, " prefix for cleaner messages
        first_msg = first_msg.replace("Value error, ", "")
        return JSONResponse(
            status_code=422,
            content={"detail": ErrorDetail(
                code=ErrorCode.VALIDATION_ERROR.value,
                message=first_msg,
            ).model_dump()},
        )

    @app.exception_handler(IntegrityError)
    async def integrity_error_handler(request: Request, exc: IntegrityError):
        """Convert SQLAlchemy IntegrityError → {detail: {code, message}}."""
        return JSONResponse(
            status_code=422,
            content={"detail": ErrorDetail(
                code=ErrorCode.INTEGRITY_VIOLATION.value,
                message="Database integrity constraint violated",
            ).model_dump()},
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        """Catch-all for uncaught exceptions → 500 with INTERNAL_ERROR code.

        Logs the exception server-side. Hides internals from client.
        """
        return JSONResponse(
            status_code=500,
            content={"detail": ErrorDetail(
                code=ErrorCode.INTERNAL_ERROR.value,
                message="Internal Server Error",
            ).model_dump()},
        )

    def _status_to_code(status_code: int) -> str:
        """Map HTTP status code to a default ErrorCode (string value)."""
        mapping = {
            404: ErrorCode.ACTIVITY_NOT_FOUND.value,  # generic; raise sites override
            409: ErrorCode.CLIENT_DUPLICATE_PHONE.value,  # generic; raise sites override
            422: ErrorCode.VALIDATION_ERROR.value,
            500: ErrorCode.INTERNAL_ERROR.value,
        }
        return mapping.get(status_code, ErrorCode.INTERNAL_ERROR.value)

    if settings.ENV != "testing":
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
