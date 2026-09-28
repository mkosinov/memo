"""Run alembic upgrade head (issue #61).

Idempotent and self-healing. Classifies the db state on boot:

- version row + base schema, behind head → normal ``command.upgrade``
- version row + base schema, at head → skip via fast-path (~5ms)
- no version row + base schema → legacy db: stamp to head
- no version row + no schema (fresh/empty file) → build from base via
  ``command.upgrade`` — NEVER a bare stamp (GH #348)
- version row + NO base schema (hollow stamp / crash debris) → drop the
  debris tables and rebuild the schema from base (GH #348)

Why the last two matter (GH #348 incident): the old "no alembic_version →
stamp head" bootstrap also fired for EMPTY dbs, leaving version=head with
zero tables. The next branch's boot then ran the new migration against the
missing base schema: its ``create_table`` autocommitted (SQLite
non-transactional DDL), the following reflection on ``users`` raised
``NoSuchTableError`` → exit 3, version never bumped → retries died on
``table password_setup_tokens already exists``. A version row without the
base schema is meaningless — the only safe reading is "rebuild from base".
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, event, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import create_async_engine

logger = logging.getLogger(__name__)

# Marker for "the base schema exists": ``users`` is created by the initial
# migration (4af69d9eff31) and never dropped by any upgrade. A db without
# it is either empty (fresh file) or debris — in both cases the
# alembic_version row alone says nothing trustworthy about the schema.
_BASE_SCHEMA_MARKER = "users"


def _drop_all_tables(sync_url: str) -> None:
    """Drop every table (incl. alembic_version) — debris cleanup (GH #348).

    FK enforcement is disabled for this engine only (same engine-scoped
    listener pattern as alembic/env.py): the process-global ``connect``
    listener registered by ``src.db`` turns FKs ON for every engine; this
    one is registered later, so it runs last and wins. Debris tables may
    carry FKs to tables that do not exist — order-independent drops require
    FKs off.
    """
    engine = create_engine(sync_url)

    @event.listens_for(engine, "connect")
    def _disable_fk_for_drop(dbapi_connection: Any, connection_record: Any) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=OFF")
        cursor.close()

    try:
        with engine.begin() as conn:
            rows = conn.execute(
                text(
                    "SELECT name FROM sqlite_master"
                    " WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                )
            ).fetchall()
            for (name,) in rows:
                conn.execute(text(f'DROP TABLE IF EXISTS "{name}"'))
    finally:
        engine.dispose()


async def run_alembic_upgrade(database_url: str) -> None:
    """Run ``alembic upgrade head``. Idempotent + self-healing.

    Behavior (see module docstring for the full state table):
    - base schema present, no alembic_version: stamp to head (legacy db)
    - base schema present, at head: return immediately (fast-path)
    - no base schema at all: (re)build the schema from base

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

    # Inspect first, act after dispose: command.stamp/upgrade open their own
    # sync engines, and a live read transaction here could deadlock them.
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
            tables = {
                row[0]
                for row in (
                    await conn.execute(
                        text(
                            "SELECT name FROM sqlite_master"
                            " WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                        )
                    )
                ).fetchall()
            }
            has_base_schema = _BASE_SCHEMA_MARKER in tables
    finally:
        await engine.dispose()

    if has_base_schema:
        if current is None:
            logger.warning(
                "alembic_version missing — stamping to head (legacy DB bootstrap)"
            )
            command.stamp(cfg, "head")
            return
        if current == script_head:
            logger.debug("Already at head — skipping upgrade")
            return
        logger.info("Running alembic upgrade head")
        command.upgrade(cfg, "head")
        return

    # No base schema: an empty db or hollow/debris state (GH #348). The
    # version row (if any) is untrustworthy — rebuild from base.
    if current is None:
        logger.info(
            "Empty database (no schema, no alembic_version)"
            " — building schema from base"
        )
    else:
        stray = ", ".join(sorted(tables - {"alembic_version"})) or "none"
        logger.warning(
            "alembic_version=%s but base schema is missing"
            " (stray tables: %s) — dropping debris and rebuilding from base"
            " (GH #348)",
            current,
            stray,
        )
        _drop_all_tables(sync_url)
    command.upgrade(cfg, "head")
