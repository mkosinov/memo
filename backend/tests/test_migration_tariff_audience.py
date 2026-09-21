"""#284 tariffs.audience — migration + backfill tests.

The migration adds a NOT NULL ``audience`` column (String(10),
server_default ``"all"``) to ``tariffs`` and backfills existing rows by
their title: EXACT match (case-insensitive, edge-trimmed,
``lower(trim(title))``) of «детский» → ``kid`` and «взрослый» → ``adult``;
everything else — «единый», titles with prefixes (e.g. «Детский билет»)
— stays ``all``. The backfill covers soft-deleted rows too (no
``is_active`` filter).
"""
import logging
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text

from alembic import command

BACKEND_DIR = Path(__file__).resolve().parents[1]

# Revision right BEFORE the #284 audience column (the new migration's parent).
LEGACY_REVISION = "a7b8c9d0e1f2"

from alembic.script import ScriptDirectory  # noqa: E402

HEAD_REVISION = ScriptDirectory(
    str(BACKEND_DIR / "alembic")
).get_current_head()

pytestmark = pytest.mark.pure_unit  # own tmp-file DB; the session DB is untouched


def _cfg(db_path: Path) -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return cfg


def _seed_tariff(db_path: Path, tid: str, title: str, is_active: int) -> None:
    engine = create_engine(f"sqlite:///{db_path}")
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO tariffs (id, service_id, title, description, price,"
            " created_at, updated_at, is_active)"
            " VALUES (:id, 's1', :title, NULL, 1000,"
            " datetime('now'), datetime('now'), :is_active)"
        ), {"id": tid, "title": title, "is_active": is_active})
    engine.dispose()


def _seed_service(db_path: Path) -> None:
    engine = create_engine(f"sqlite:///{db_path}")
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO services (id, title, description, image_url,"
            " specialty, min_age, max_age, duration, record_info,"
            " created_at, updated_at, is_active)"
            " VALUES ('s1', 't', 'd', '', '', 5, NULL, 90, '',"
            " datetime('now'), datetime('now'), 1)"
        ))
    engine.dispose()


def _upgrade_to_head(db_path: Path) -> None:
    logging.getLogger("alembic").setLevel(logging.WARNING)
    cfg = _cfg(db_path)
    command.upgrade(cfg, LEGACY_REVISION)
    _seed_service(db_path)
    _seed_tariff(db_path, "t1", "Детский", is_active=1)
    _seed_tariff(db_path, "t2", "детский", is_active=1)
    _seed_tariff(db_path, "t3", "  Взрослый  ", is_active=1)
    _seed_tariff(db_path, "t4", "Единый", is_active=1)
    _seed_tariff(db_path, "t5", "Детский билет", is_active=1)
    _seed_tariff(db_path, "t6", "Что-то ещё", is_active=1)
    # Soft-deleted rows are covered by the backfill too.
    _seed_tariff(db_path, "t7", "Детский", is_active=0)
    _seed_tariff(db_path, "t8", "взрослый", is_active=0)
    command.upgrade(cfg, "head")


def test_audience_backfill_by_title(tmp_path: Path) -> None:
    """upgrade → head: audience derived from title (exact match only)."""
    db_path = tmp_path / "audience_migration.db"
    _upgrade_to_head(db_path)

    engine = create_engine(f"sqlite:///{db_path}")
    with engine.connect() as conn:
        # At head.
        rows = lambda sql: [tuple(r) for r in conn.execute(text(sql))]  # noqa: E731
        assert rows("SELECT version_num FROM alembic_version") == [(HEAD_REVISION,)]

        expected = [
            ("t1", "Детский", 1, "kid"),
            ("t2", "детский", 1, "kid"),
            ("t3", "  Взрослый  ", 1, "adult"),  # trimmed + case-insensitive
            ("t4", "Единый", 1, "all"),
            ("t5", "Детский билет", 1, "all"),  # prefix — NOT a match
            ("t6", "Что-то ещё", 1, "all"),
            ("t7", "Детский", 0, "kid"),  # soft-deleted still backfilled
            ("t8", "взрослый", 0, "adult"),  # soft-deleted still backfilled
        ]
        assert rows(
            "SELECT id, title, is_active, audience FROM tariffs ORDER BY id"
        ) == expected

        # Column shape: NOT NULL with server_default 'all'.
        cols = {r[1]: r for r in conn.execute(text("PRAGMA table_info(tariffs)"))}
        assert cols["audience"][3] == 1, "audience must be NOT NULL"
        assert cols["audience"][4] == "'all'", "server_default must be 'all'"
    engine.dispose()


def test_audience_downgrade_drops_column(tmp_path: Path) -> None:
    """downgrade from head back to LEGACY_REVISION drops the column."""
    db_path = tmp_path / "audience_downgrade.db"
    _upgrade_to_head(db_path)

    logging.getLogger("alembic").setLevel(logging.WARNING)
    cfg = _cfg(db_path)
    command.downgrade(cfg, LEGACY_REVISION)

    engine = create_engine(f"sqlite:///{db_path}")
    with engine.connect() as conn:
        cols = {r[1] for r in conn.execute(text("PRAGMA table_info(tariffs)"))}
        assert "audience" not in cols
        # Titles untouched by both directions (nothing is deleted).
        titles = [r[0] for r in conn.execute(
            text("SELECT title FROM tariffs ORDER BY id")
        )]
        assert "Детский" in titles and "Единый" in titles
    engine.dispose()
