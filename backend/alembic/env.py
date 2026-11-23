"""Alembic environment configuration for async SQLAlchemy + SQLite."""

import os
import sys
from logging.config import fileConfig
from pathlib import Path
from typing import Any

from sqlalchemy import engine_from_config, event, pool

from alembic import context

# Add the project root to sys.path so we can import src.*
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Import ALL models so they register with Base.metadata
import src.models  # noqa: F401 — registration first; breaks the models↔notification/domain_events import cycle (dispatcher precedent)
from src.auth.password_setup import (
    PasswordSetupToken,  # noqa: F401 — password_setup_tokens (#348)
)
from src.auth.session import Session  # noqa: F401 — sessions table (GH #247)
from src.db.base import Base
from src.domain_events.models import (  # noqa: F401 — domain_events journal table (#580 §3.1)
    DomainEvent,
)
from src.models import (  # noqa: F401
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
    UserProfile,
    UserSettings,
    Visit,
    Visitor,
)
from src.notification.models import (  # noqa: F401 — notification subsystem tables (#482)
    NotificationTask,
    NotificationTaskAttempt,
    NotificationTemplate,
)

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def _apply_env_database_url(alembic_config: Any) -> None:
    """GH #616 — honor the ``DATABASE_URL`` env var (the same var the app
    engine uses, ``src.core.config.settings.DATABASE_URL``).

    The container path (deploy.sh's ``docker compose run --rm backend
    alembic upgrade head``, the prod-build CI smoke) gets DATABASE_URL
    injected by the service ``env_file``; without this override alembic
    would migrate the ephemeral in-container ``memo.db`` hardcoded in
    alembic.ini instead of the volume-mounted prod DB, and prod would
    boot unmigrated.

    Precedence: an explicit programmatic
    ``set_main_option("sqlalchemy.url", ...)`` (``src/db/migrate.py``,
    the migration tests' ``_cfg`` helpers) ALWAYS wins — the env var
    replaces only the untouched alembic.ini default. That guard is
    load-bearing: ``tests/conftest.py`` exports DATABASE_URL for the
    whole pytest session while the migration tests point their own
    temp-file URLs via ``set_main_option``.

    The async driver form (``sqlite+aiosqlite://`` — how prod env files
    spell it) is normalized to the sync form the same way as
    ``src/db/migrate.py``; with no env var the behavior is exactly
    today's (the alembic.ini default), so dev workflows are untouched.
    """
    env_url = os.environ.get("DATABASE_URL")
    if not env_url or alembic_config.config_file_name is None:
        return
    ini_default = alembic_config.get_main_option("sqlalchemy.url")
    pristine_ini = type(alembic_config)(alembic_config.config_file_name)
    if ini_default != pristine_ini.get_main_option("sqlalchemy.url"):
        return  # the caller chose a URL explicitly — keep it
    alembic_config.set_main_option(
        "sqlalchemy.url", env_url.replace("+aiosqlite", "")
    )


_apply_env_database_url(config)

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
        dbapi_connection: Any,
        connection_record: Any,
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
