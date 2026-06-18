"""Run alembic upgrade head (issue #61).

Idempotent and self-healing. On legacy DBs (no alembic_version) stamps
to head. When already at head, skips command.upgrade via fast-path
(~5ms vs ~100-250ms).
"""

from __future__ import annotations

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import create_async_engine

logger = logging.getLogger(__name__)


async def run_alembic_upgrade(database_url: str) -> None:
    """Run ``alembic upgrade head``. Idempotent + fast-path.

    Behavior:
    - If alembic_version missing: stamp to head (legacy DB bootstrap)
    - If alembic_version == script head: return immediately (fast-path)
    - Otherwise: run command.upgrade(cfg, "head")

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

    script_head = ScriptDirectory.from_config(cfg).get_heads()[0]

    engine = create_async_engine(database_url, echo=False)
    try:
        async with engine.connect() as conn:
            try:
                result = await conn.execute(
                    text("SELECT version_num FROM alembic_version")
                )
                current = result.scalar()
            except OperationalError:
                # Table doesn't exist (legacy DB without alembic)
                current = None

            if current is None:
                logger.warning(
                    "alembic_version missing — stamping to head (legacy DB bootstrap)"
                )
                command.stamp(cfg, "head")
                return
            if current == script_head:
                logger.debug("Already at head — skipping upgrade")
                return
    finally:
        await engine.dispose()

    logger.info("Running alembic upgrade head")
    command.upgrade(cfg, "head")
