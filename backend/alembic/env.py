"""Alembic environment configuration for async SQLAlchemy + SQLite."""

import sys
from logging.config import fileConfig
from pathlib import Path
from typing import Any

from sqlalchemy import engine_from_config, event, pool

from alembic import context

# Add the project root to sys.path so we can import src.*
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.db.base import Base  # noqa: E402

# Import ALL models so they register with Base.metadata
from src.auth.session import Session  # noqa: E402, F401 — sessions table (GH #247)
from src.models import (  # noqa: E402, F401
    Activity,
    Client,
    Location,
    Master,
    Material,
    Payment,
    Photo,
    Record,
    Service,
    Tag,
    Tariff,
    User,
    UserSettings,
    Visit,
    Visitor,
)

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,  # Required for SQLite ALTER TABLE support
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    # GH #211 (spec §6.1): the migration connection must run with FK
    # enforcement OFF. Importing ``src.db.base`` executes ``src.db.__init__``,
    # which registers a PROCESS-GLOBAL ``Engine`` "connect" listener
    # (``src.db.database._set_sqlite_pragmas``) that sets
    # ``PRAGMA foreign_keys=ON`` for EVERY SQLite engine in the process —
    # including this one. With FK ON, alembic's SQLite batch mode (table
    # recreate → ``DROP TABLE``) fails with "FOREIGN KEY constraint failed"
    # whenever other tables (e.g. ``photo_tags``) hold rows referencing the
    # recreated table: DROP TABLE performs an implicit ``DELETE FROM``, which
    # violates the referencing FKs. This engine-scoped listener is registered
    # AFTER the global one, so it runs last on connect and wins: FK OFF for
    # the migration connection ONLY — app / sqladmin / test engines keep FK ON.
    @event.listens_for(connectable, "connect")
    def _disable_fk_for_migration_connection(
        dbapi_connection: Any, connection_record: Any,
    ) -> None:
        if "sqlite" not in type(dbapi_connection).__module__:
            return  # same non-sqlite guard as the global listener
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=OFF")
        cursor.close()

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,  # Required for SQLite ALTER TABLE support
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
