"""Business logic for system health checks."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.system.schemas import HealthResponse


class HealthService:
    """Performs health checks including database connectivity."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def check_health(self) -> HealthResponse:
        """Check application health and database connectivity.

        Executes ``SELECT 1`` to verify the database is reachable.
        """
        try:
            await self._session.execute(text("SELECT 1"))
            db_status = "connected"
        except Exception:
            db_status = "disconnected"

        return HealthResponse(status="ok", db=db_status)
