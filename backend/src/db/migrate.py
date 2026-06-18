"""Run alembic upgrade head (issue #61).

Idempotent — runs every app startup. Assumes the DB has been stamped
to a baseline at least once (use ``alembic stamp`` or recreate script).
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

    If ``alembic_version`` table doesn't exist, raises a clear
    ``RuntimeError`` — the operator must run ``alembic stamp <baseline>``
    or recreate the DB.  See ``backend/scripts/recreate_dev_db.sh``.

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

    # Verify alembic_version exists — fail loudly if not
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
                raise RuntimeError(
                    "alembic_version table not found. "
                    "Run `alembic stamp <baseline>` or recreate the DB using "
                    "`backend/scripts/recreate_dev_db.sh`."
                )
    finally:
        await engine.dispose()

    logger.info("Running alembic upgrade head")
    command.upgrade(cfg, "head")
