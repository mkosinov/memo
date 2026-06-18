"""Run alembic upgrade head (issue #61).

Idempotent — runs every app startup. Self-healing: when
``alembic_version`` is missing (legacy DB) the function stamps to head
before upgrading, so the operator never needs manual intervention.
"""

from __future__ import annotations

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

logger = logging.getLogger(__name__)


async def run_alembic_upgrade(database_url: str) -> None:
    """Run ``alembic upgrade head``. Idempotent.

    If ``alembic_version`` table doesn't exist (legacy DB created before
    Alembic was introduced), the function self-heals by stamping to head.
    This is safe because the lifespan hook runs ``Base.metadata.create_all``
    *before* this function, so all model tables are already present.

    Args:
        database_url: SQLAlchemy async URL
                      (e.g. ``sqlite+aiosqlite:///memo.db``).
    """
    backend_dir = Path(__file__).resolve().parents[2]
    cfg = Config(str(backend_dir / "alembic.ini"))

    # Alembic runs synchronously — convert async driver (aiosqlite) to sync (pysqlite)
    sync_url = database_url.replace("+aiosqlite", "")
    cfg.set_main_option("sqlalchemy.url", sync_url)
    cfg.set_main_option("script_location", str(backend_dir / "alembic"))

    # Self-heal: if alembic_version is missing, stamp to head first
    engine = create_async_engine(database_url, echo=False)
    try:
        async with engine.connect() as conn:
            result = await conn.execute(
                text(
                    "SELECT name FROM sqlite_master "
                    "WHERE type='table' AND name='alembic_version'"
                )
            )
            if result.scalar() is None:
                logger.warning(
                    "alembic_version table missing — stamping to head (legacy DB bootstrap)"
                )
                command.stamp(cfg, "head")
    finally:
        await engine.dispose()

    logger.info("Running alembic upgrade head")
    command.upgrade(cfg, "head")
