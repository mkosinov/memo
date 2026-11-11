"""Migration + ORM tests for the callcheck storage tables (#593 Task 2,
spec §Хранение).

Runs the real alembic chain (``upgrade head`` / downgrade to the explicit
parent id) against a clean temporary SQLite file — the
``test_notification_migration.py`` pattern:

- ``auth_calls`` (one live check per phone: ``phone`` is the PK) and the
  append-only journal ``auth_call_attempts`` exist at head with exactly
  the spec'd columns; ``auth_call_attempts.checked_at`` is the only
  nullable (set on terminal outcomes — Task 4);
- the revision round-trips: downgrade to its parent drops both tables,
  upgrade rebuilds them;
- ORM metadata (``src.auth.callcheck``) matches the migrated schema
  column-for-column — the no-drift contract.

Spec: docs/specs/2026-11-11-auth-callcheck-design.md §Хранение
"""

from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.config import Config

import src.models  # noqa: F401 — registers all models incl. the callcheck pair
from alembic import command
from src.db.base import Base

BACKEND_DIR = Path(__file__).resolve().parents[1]

#: The callcheck revision's parent — the pre-#593 chain head.
PARENT = "f3a5c7e9b1d2"

AUTH_CALL_COLUMNS = {
    "phone", "provider_check_id", "call_phone", "handle_hash", "status",
    "created_at",
}
AUTH_CALL_ATTEMPT_COLUMNS = {
    "id", "phone", "ip_hash", "provider_check_id", "outcome", "created_at",
    "checked_at",
}

pytestmark = pytest.mark.pure_unit  # own tmp-file DB; the session DB is untouched


def _alembic_config(db_url: str) -> Config:
    """Alembic config bound to a temp DB (same overrides as src/db/migrate.py)."""
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", db_url)
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return cfg


def _inspect(url: str) -> sa.Inspector:
    engine = sa.create_engine(url)
    try:
        return sa.inspect(engine)
    finally:
        engine.dispose()


def _columns(url: str, table: str) -> dict[str, dict]:
    inspector = _inspect(url)
    assert table in inspector.get_table_names(), (
        f"table {table!r} missing — migrated tables: "
        f"{sorted(inspector.get_table_names())}"
    )
    return {c["name"]: c for c in inspector.get_columns(table)}


def _pk(url: str, table: str) -> list[str]:
    inspector = _inspect(url)
    return list(inspector.get_pk_constraint(table)["constrained_columns"])


class TestAuthCallStorageMigration:
    def test_upgrade_creates_both_tables_with_spec_shape(self, tmp_path: Path) -> None:
        url = f"sqlite:///{tmp_path / 'callcheck_upgraded.db'}"
        command.upgrade(_alembic_config(url), "head")

        calls = _columns(url, "auth_calls")
        assert set(calls) == AUTH_CALL_COLUMNS, (
            f"auth_calls column drift: {sorted(calls)}"
        )
        assert _pk(url, "auth_calls") == ["phone"]  # one live check per phone
        assert not calls["phone"]["nullable"]
        assert not calls["handle_hash"]["nullable"]  # raw handle never stored
        assert not calls["status"]["nullable"]

        attempts = _columns(url, "auth_call_attempts")
        assert set(attempts) == AUTH_CALL_ATTEMPT_COLUMNS, (
            f"auth_call_attempts column drift: {sorted(attempts)}"
        )
        assert _pk(url, "auth_call_attempts") == ["id"]
        assert attempts["checked_at"]["nullable"], (
            "checked_at must be nullable (NULL until a terminal outcome)"
        )
        for column in AUTH_CALL_ATTEMPT_COLUMNS - {"checked_at"}:
            assert not attempts[column]["nullable"], (
                f"auth_call_attempts.{column} must be NOT NULL"
            )

    def test_roundtrip_downgrade_drops_and_upgrade_rebuilds(
        self, tmp_path: Path,
    ) -> None:
        url = f"sqlite:///{tmp_path / 'callcheck_roundtrip.db'}"
        cfg = _alembic_config(url)

        command.upgrade(cfg, "head")
        assert "auth_calls" in _inspect(url).get_table_names()
        assert "auth_call_attempts" in _inspect(url).get_table_names()

        # Downgrade to the EXPLICIT parent — the pre-#593 world.
        command.downgrade(cfg, PARENT)
        tables = _inspect(url).get_table_names()
        assert "auth_calls" not in tables, (
            "downgrade must drop auth_calls"
        )
        assert "auth_call_attempts" not in tables, (
            "downgrade must drop auth_call_attempts"
        )

        command.upgrade(cfg, "head")
        assert "auth_calls" in _inspect(url).get_table_names()
        assert "auth_call_attempts" in _inspect(url).get_table_names()
        assert set(_columns(url, "auth_calls")) == AUTH_CALL_COLUMNS
        assert set(_columns(url, "auth_call_attempts")) == AUTH_CALL_ATTEMPT_COLUMNS

    def test_orm_metadata_matches_migrated_schema(self, tmp_path: Path) -> None:
        """The model side of the no-drift contract, scoped to the two new
        tables (the global parity test in test_notification_migration.py
        covers the rest and picks these up via Base.metadata)."""
        url = f"sqlite:///{tmp_path / 'callcheck_parity.db'}"
        command.upgrade(_alembic_config(url), "head")
        inspector = _inspect(url)

        for table in Base.metadata.sorted_tables:
            if table.name not in ("auth_calls", "auth_call_attempts"):
                continue
            reflected = {c["name"] for c in inspector.get_columns(table.name)}
            declared = {c.name for c in table.columns}
            assert reflected == declared, (
                f"{table.name}: migration/model column drift —"
                f" only-in-db={sorted(reflected - declared)},"
                f" only-in-model={sorted(declared - reflected)}"
            )
