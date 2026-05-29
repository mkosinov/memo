"""Business logic for system health checks."""

from functools import lru_cache

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.system.schemas import HealthResponse


class HealthService:
    """Performs health checks including database connectivity."""

    async def check_health(self, db_session: AsyncSession) -> HealthResponse:
        """Check application health and database connectivity.

        Executes ``SELECT 1`` to verify the database is reachable.
        """
        try:
            await db_session.execute(text("SELECT 1"))
            db_status = "connected"
        except Exception:
            db_status = "disconnected"

        return HealthResponse(status="ok", db=db_status)


@lru_cache
def get_health_service() -> HealthService:
    """Returns a singleton HealthService."""
    return HealthService()
