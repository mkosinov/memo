"""Migration test: ``users.client_id`` — the client-card link (#499 Task 1).

Runs the real alembic chain (``upgrade head`` / ``downgrade -1``) against a
clean temporary SQLite file — the plan DoD «миграция применяется чисто»:

* upgrade head: ``users.client_id`` exists (nullable String(36)), FK →
  ``clients.id``, and a unique index covers it — the ``staff_id`` mirror
  (GH #266), one account per client card;
* downgrade -1 drops the link again, and a re-upgrade rebuilds it
  (round-trip);
* ORM parity: ``Base.metadata`` (``User.client_id``) matches the migrated
  schema column-for-column — the no-drift contract, model side.
"""

from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.config import Config
from sqlalchemy import create_engine, text

import src.models  # noqa: F401 — registers all models
from alembic import command
from src.db.base import Base

BACKEND_DIR = Path(__file__).resolve().parents[1]

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
    db_file = tmp_path_factory.mktemp("user_client_migration") / "upgraded.db"
    url = f"sqlite:///{db_file}"
    command.upgrade(_alembic_config(url), "head")
    return url


def _columns(url: str, table: str) -> dict[str, dict]:
    engine = create_engine(url)
    try:
        inspector = sa.inspect(engine)
        assert table in inspector.get_table_names()
        return {c["name"]: c for c in inspector.get_columns(table)}
    finally:
        engine.dispose()


def _foreign_keys(url: str, table: str) -> list[dict]:
    engine = create_engine(url)
    try:
        return sa.inspect(engine).get_foreign_keys(table)
    finally:
        engine.dispose()


def _unique_index_columns(url: str, table: str) -> set[str]:
    """Columns covered by at least one unique index — via PRAGMA, not the
    inspector: SQLAlchemy's ``get_indexes()`` hides SQLite's internal
    ``sqlite_autoindex_*`` indexes that back inline UNIQUE constraints
    (e.g. ``uq_users_client_id``), so the dialect API would miss them."""
    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            unique_idx = [
                r[1] for r in conn.execute(
                    text(f"PRAGMA index_list({table})")
                ).fetchall()
                if r[3] == "u"  # origin 'u' = UNIQUE constraint autoindex
            ]
            covered: set[str] = set()
            for idx in unique_idx:
                rows = conn.execute(
                    text(f"PRAGMA index_info({idx})")
                ).fetchall()
                covered.update(r[2] for r in rows)
            return covered
    finally:
        engine.dispose()


class TestUpgradeHead:
    def test_client_id_column_shape(self, upgraded_url: str) -> None:
        users = _columns(upgraded_url, "users")
        assert "client_id" in users, "users.client_id not created by upgrade head"
        col = users["client_id"]
        assert col["nullable"] is True, "client_id must be nullable (optional link)"
        assert col["type"].length == 36  # uuid-string PK width, staff_id mirror

    def test_client_id_fk_to_clients(self, upgraded_url: str) -> None:
        fks = _foreign_keys(upgraded_url, "users")
        assert any(
            fk["constrained_columns"] == ["client_id"]
            and fk["referred_table"] == "clients"
            and fk["referred_columns"] == ["id"]
            for fk in fks
        ), f"FK users.client_id → clients.id missing: {fks}"

    def test_client_id_unique(self, upgraded_url: str) -> None:
        covered = _unique_index_columns(upgraded_url, "users")
        assert "client_id" in covered, f"no unique index on users.client_id: {covered}"


class TestRoundtrip:
    def test_downgrade_drops_link_then_upgrade_rebuilds(self, tmp_path: Path) -> None:
        db_file = tmp_path / "roundtrip.db"
        url = f"sqlite:///{db_file}"
        cfg = _alembic_config(url)

        command.upgrade(cfg, "head")
        assert "client_id" in _columns(url, "users")
        assert "client_id" in _unique_index_columns(url, "users")

        # Downgrade to THIS migration's PARENT explicitly — «-1» stopped
        # being the client_id step once later migrations appended to the
        # chain (otp_codes, #499 d3b5f7a9c1e3): a relative step would run
        # the newest migration's downgrade instead, silently voiding the
        # assertions below (the test_notify_migration.py precedent).
        command.downgrade(cfg, "c970adc6b3d6")
        assert "client_id" not in _columns(url, "users")
        assert "client_id" not in _unique_index_columns(url, "users")
        assert all(
            fk["constrained_columns"] != ["client_id"]
            for fk in _foreign_keys(url, "users")
        )

        command.upgrade(cfg, "head")
        assert "client_id" in _columns(url, "users")


class TestOrmParity:
    def test_metadata_matches_migrated_schema(self, upgraded_url: str) -> None:
        """Every Base.metadata table exists after upgrade head with exactly
        the declared column names — the model side of the no-drift contract."""
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
