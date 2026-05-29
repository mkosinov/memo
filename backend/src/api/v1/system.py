"""FastAPI router for system health endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends

from src.db import SessionDep
from src.schemas.system import HealthResponse
from src.services.system_service import HealthService, get_health_service

router = APIRouter(tags=["system"])


@lru_cache
def _get_health_service() -> HealthService:
    """Dependency factory returning a singleton HealthService."""
    return get_health_service()


_ServiceDep = Annotated[HealthService, Depends(_get_health_service)]


@router.get("/health", response_model=HealthResponse)
async def health_check(
    service: _ServiceDep,
    session: SessionDep,
) -> HealthResponse:
    """Return application health status and DB connectivity."""
    return await service.check_health(db_session=session)
