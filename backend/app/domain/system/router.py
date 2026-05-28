"""FastAPI router for system health endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db_session
from app.domain.system.schemas import HealthResponse
from app.domain.system.service import HealthService

router = APIRouter(tags=["system"])

_SessionDep = Annotated[AsyncSession, Depends(get_db_session)]


def _get_health_service(session: _SessionDep) -> HealthService:
    """Dependency factory for HealthService."""
    return HealthService(session)


_ServiceDep = Annotated[HealthService, Depends(_get_health_service)]


@router.get("", response_model=HealthResponse)
async def health_check(service: _ServiceDep) -> HealthResponse:
    """Return application health status and DB connectivity."""
    return await service.check_health()
