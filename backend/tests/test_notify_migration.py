"""Migration + ORM tests for the notify subsystem tables (#482, spec §4).

Runs the real alembic chain (``upgrade head`` / ``downgrade -1``) against a
clean temporary SQLite file — the DoD of plan task 1:

* four notify tables created (domain_events, notify_tasks,
  notify_task_attempts, notify_templates) + columns ``clients.notify_enabled``
  / ``records.notify`` with the spec'd server defaults (true / false);
* the partial index ``ix_domain_events_pending`` exists in ``sqlite_master``
  with BOTH polling predicates — spec §3.1: declaration must go through
  ``sqlite_where`` so autogenerate sees no drift;
* the seed default ``new_record`` template is present with ``is_default``;
* the migration round-trips (downgrade drops the notify schema, upgrade
  rebuilds it);
* ORM metadata (Base.metadata, incl. ``src/notify/models.py``) matches the
  migrated schema column-for-column — guards the autogenerate no-drift
  contract from the model side.
"""

from pathlib import Path
from typing import Any

import pytest
import sqlalchemy as sa
from alembic.config import Config
from sqlalchemy import create_engine, text

import src.models  # noqa: F401 — registers all models incl. src.notify
from alembic import command
from src.db.base import Base

BACKEND_DIR = Path(__file__).resolve().parents[1]

NOTIFY_TABLES = (
    "domain_events",
    "notify_tasks",
    "notify_task_attempts",
    "notify_templates",
)

pytestmark = pytest.mark.pure_unit  # own tmp-file DB; the session DB is untouched


def _alembic_config(db_url: str) -> Config:
    """Alembic config bound to a temp DB (same overrides as src/db/migrate.py)."""
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", db_url)
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return cfg


@pytest.fixture(scope="module")
def upgraded_url(tmp_path_factory) -> str:
    """Clean DB taken to head once; read-only checks share it."""
    db_file = tmp_path_factory.mktemp("notify_migration") / "upgraded.db"
    url = f"sqlite:///{db_file}"
    command.upgrade(_alembic_config(url), "head")
    return url


def _table_names(url: str) -> set[str]:
    engine = create_engine(url)
    try:
        return set(sa.inspect(engine).get_table_names())
    finally:
        engine.dispose()


def _columns(url: str, table: str) -> dict[str, dict]:
    engine = create_engine(url)
    try:
        inspector = sa.inspect(engine)
        assert table in inspector.get_table_names(), (
            f"table {table!r} missing — migrated tables: {sorted(inspector.get_table_names())}"
        )
        return {c["name"]: c for c in inspector.get_columns(table)}
    finally:
        engine.dispose()


def _column_defaults(url: str, table: str) -> dict[str, str | None]:
    """Raw ``dflt_value`` per column (PRAGMA table_info) — the inspector
    does not expose server defaults portably."""
    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            rows = conn.execute(
                text("SELECT name, dflt_value FROM pragma_table_info(:t)"),
                {"t": table},
            ).fetchall()
        return {name: dflt for name, dflt in rows}
    finally:
        engine.dispose()


def _scalar(url: str, sql: str) -> Any:
    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            return conn.execute(text(sql)).scalar()
    finally:
        engine.dispose()


def _fetchone(url: str, sql: str) -> tuple | None:
    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            return conn.execute(text(sql)).fetchone()
    finally:
        engine.dispose()


class TestUpgradeHead:
    def test_notify_tables_created(self, upgraded_url: str) -> None:
        tables = _table_names(upgraded_url)
        for name in NOTIFY_TABLES:
            assert name in tables, f"{name} not created by upgrade head"

    def test_flag_columns_with_spec_defaults(self, upgraded_url: str) -> None:
        """clients.notify_enabled defaults true, records.notify false (§4)."""
        clients = _columns(upgraded_url, "clients")
        assert "notify_enabled" in clients, "clients.notify_enabled missing"
        client_dflts = _column_defaults(upgraded_url, "clients")
        assert client_dflts["notify_enabled"] in ("1", "true")

        records = _columns(upgraded_url, "records")
        assert "notify" in records, "records.notify missing"
        record_dflts = _column_defaults(upgraded_url, "records")
        assert record_dflts["notify"] in ("0", "false")

    def test_partial_index_has_both_predicates(self, upgraded_url: str) -> None:
        """§3.1: ix_domain_events_pending ON (occurred_at) WHERE
        processed_at IS NULL AND processing_error IS NULL — sqlite_master
        must carry both predicates."""
        sql = _scalar(
            upgraded_url,
            "SELECT sql FROM sqlite_master WHERE type='index' AND name='ix_domain_events_pending'",
        )
        assert sql is not None, "partial index ix_domain_events_pending missing"
        assert "ON domain_events" in sql
        assert "occurred_at" in sql
        assert "processed_at IS NULL" in sql, (
            f"partial index lost the processed_at predicate: {sql}"
        )
        assert "processing_error IS NULL" in sql, (
            f"partial index lost the processing_error predicate: {sql}"
        )

    def test_seed_default_new_record_template(self, upgraded_url: str) -> None:
        """§3.5/§4: the migration seeds the default new_record template
        (is_default=1) with the full-variable draft body."""
        row = _fetchone(
            upgraded_url,
            "SELECT event_type, title, body, is_default"
            " FROM notify_templates WHERE event_type = 'new_record'",
        )
        assert row is not None, "seed row new_record missing from notify_templates"
        event_type, title, body, is_default = row
        assert event_type == "new_record"
        assert is_default in (1, True)
        assert title, "seed template must have a title"
        # full-variable draft from spec §3.5 (null-tolerant via {% if %})
        for landmark in (
            "{% if client.name %}",
            "{{ service.title }}",
            "{{ activity.start | fmt_dt }}",
            "{{ location.map_url }}",
            "{% for t in tariffs %}",
            "{{ total_price | money }}",
        ):
            assert landmark in body, f"seed body lost {landmark!r}"


class TestRoundtrip:
    def test_downgrade_drops_notify_schema_then_upgrade_rebuilds(
        self,
        tmp_path: Path,
    ) -> None:
        db_file = tmp_path / "roundtrip.db"
        url = f"sqlite:///{db_file}"
        cfg = _alembic_config(url)

        command.upgrade(cfg, "head")
        assert set(NOTIFY_TABLES) <= _table_names(url)

        command.downgrade(cfg, "-1")
        remaining = _table_names(url)
        for name in NOTIFY_TABLES:
            assert name not in remaining, f"{name} survived downgrade -1"
        assert "notify_enabled" not in _columns(url, "clients")
        assert "notify" not in _columns(url, "records")

        command.upgrade(cfg, "head")
        assert set(NOTIFY_TABLES) <= _table_names(url)
        seeded = _scalar(
            url,
            "SELECT COUNT(*) FROM notify_templates WHERE event_type='new_record' AND is_default=1",
        )
        assert seeded == 1


class TestOrmParity:
    def test_metadata_matches_migrated_schema(self, upgraded_url: str) -> None:
        """Every Base.metadata table exists after upgrade head with exactly
        the declared column names — the model side of the no-drift contract
        (sqlite_where partial index is covered by the sqlite_master test)."""
        engine = create_engine(upgraded_url)
        try:
            inspector = sa.inspect(engine)
            db_tables = set(inspector.get_table_names())
            for table in Base.metadata.sorted_tables:
                assert table.name in db_tables, (
                    f"ORM table {table.name!r} not created by migrations"
                )
                reflected = {c["name"] for c in inspector.get_columns(table.name)}
                declared = {c.name for c in table.columns}
                assert reflected == declared, (
                    f"{table.name}: migration/model column drift —"
                    f" only-in-db={sorted(reflected - declared)},"
                    f" only-in-model={sorted(declared - reflected)}"
                )
        finally:
            engine.dispose()
