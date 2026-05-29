"""Database package — provides the global DBManager and SessionDep dependency."""

from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.db.database import DBManager

# Module-level singleton
db_manager = DBManager(settings.DATABASE_URL, settings.LOG_LEVEL == "DEBUG")

# FastAPI dependency type alias
SessionDep = Annotated[AsyncSession, Depends(db_manager.get_db_session)]
