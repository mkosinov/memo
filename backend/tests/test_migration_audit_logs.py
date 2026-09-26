"""#344 audit_logs — migration + append-only model tests.

Migration ``add_audit_logs_table`` creates the append-only ``audit_logs``
table (spec §5): own String(36) UUID PK + ``created_at`` (no
``updated_at``, no soft-delete); columns ``user_id`` (FK users.id ON
DELETE SET NULL), ``user_role``, ``action``, ``entity``, ``entity_id``,
``entity_label``, ``changes`` (JSON); indexes on ``created_at``,
``user_id``, ``(entity, entity_id)`` and ``action``. Downgrade drops the
table cleanly. The application surface is append-only: no update/delete
helpers exist (checked by static inspection of the module source).
"""
import logging
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text

BACKEND_DIR = Path(__file__).resolve().parents[1]

# Revision right BEFORE the #344 audit_logs table (the new migration's parent).
LEGACY_REVISION = "b3d5f7a9c1e8"

HEAD_REVISION = ScriptDirectory(
    str(BACKEND_DIR / "alembic")
).get_current_head()

pytestmark = pytest.mark.pure_unit  # own tmp-file DB; the session DB is untouched


def _cfg(db_path: Path) -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return cfg


def _upgrade_to_head(db_path: Path) -> None:
    logging.getLogger("alembic").setLevel(logging.WARNING)
    cfg = _cfg(db_path)
    command.upgrade(cfg, "head")


def _table_exists(conn, table: str) -> bool:
    return bool(
        list(conn.execute(text(f"SELECT 1 FROM sqlite_master WHERE name='{table}'")))
    )


def _index_names(conn, table: str) -> set[str]:
    return {
        r[0]
        for r in conn.execute(text(f"PRAGMA index_list({table})"))
    }


class TestAuditLogsMigration:
    def test_upgrade_creates_table_with_expected_shape(self, tmp_path: Path) -> None:
        """upgrade → head: audit_logs exists with exact columns/types/nullability."""
        db_path = tmp_path / "audit_logs_migration.db"
        _upgrade_to_head(db_path)

        engine = create_engine(f"sqlite:///{db_path}")
        with engine.connect() as conn:
            assert _table_exists(conn, "audit_logs"), "audit_logs must exist at head"
            assert (
                list(conn.execute(text("SELECT version_num FROM alembic_version")))
                == [(HEAD_REVISION,)]
            )

            # Column shape: name → (type, notnull, dflt_value, pk).
            cols = {
                r[1]: (r[2].upper(), r[3], r[4], r[5])
                for r in conn.execute(text("PRAGMA table_info(audit_logs)"))
            }
            assert set(cols) == {
                "id", "created_at", "user_id", "user_role",
                "action", "entity", "entity_id", "entity_label", "changes",
            }, f"unexpected column set: {set(cols)}"

            assert cols["id"][0] == "VARCHAR(36)"
            assert cols["id"][3] == 1, "id must be the PK"
            assert cols["created_at"][0] == "DATETIME"
            assert cols["user_id"][0] == "VARCHAR(36)"
            assert cols["user_role"][0] == "VARCHAR(20)"
            assert cols["action"][0] == "VARCHAR(16)"
            assert cols["entity"][0] == "VARCHAR(32)"
            assert cols["entity_id"][0] == "VARCHAR(36)"
            assert cols["entity_label"][0] == "VARCHAR(255)"
            assert cols["changes"][0] in {"JSON", "TEXT"}, (
                "changes must be a JSON column"
            )

            # Nullability: everything required by §5 is NOT NULL except
            # user_id / entity_id / changes.
            for name in ("id", "created_at", "user_role", "action",
                         "entity", "entity_label"):
                assert cols[name][1] == 1, f"{name} must be NOT NULL"
            for name in ("user_id", "entity_id", "changes"):
                assert cols[name][1] == 0, f"{name} must be nullable"
        engine.dispose()

    def test_fk_on_delete_set_null(self, tmp_path: Path) -> None:
        """user_id FK → users.id with ON DELETE SET NULL (journal survives)."""
        db_path = tmp_path / "audit_logs_fk.db"
        _upgrade_to_head(db_path)

        engine = create_engine(f"sqlite:///{db_path}")
        with engine.connect() as conn:
            fks = list(
                conn.execute(text("PRAGMA foreign_key_list(audit_logs)"))
            )
            assert len(fks) == 1, "exactly one FK expected"
            fk = fks[0]
            # (id, seq, table, from, to, on_update, on_delete, match)
            assert fk[2] == "users" and fk[3] == "user_id" and fk[4] == "id"
            assert fk[6].upper() == "SET NULL"

            # The FK actually nulls the reference on user hard-delete.
            conn.execute(text("PRAGMA foreign_keys = ON"))
            conn.execute(text(
                "INSERT INTO users (id, phone, password_hash, role,"
                " email_is_confirmed, phone_is_confirmed,"
                " failed_login_attempts, lock_level,"
                " created_at, updated_at, is_active)"
                " VALUES ('u1', '+70000000001', 'h', 'admin',"
                " 0, 0, 0, 0,"
                " datetime('now'), datetime('now'), 1)"
            ))
            conn.execute(text(
                "INSERT INTO audit_logs (id, created_at, user_id, user_role,"
                " action, entity, entity_id, entity_label, changes)"
                " VALUES ('a1', datetime('now'), 'u1', 'admin', 'create',"
                " 'clients', 'c1', 'Иванов Иван', NULL)"
            ))
            conn.commit()
            conn.execute(text("DELETE FROM users WHERE id = 'u1'"))
            conn.commit()
            rows = list(
                conn.execute(text("SELECT user_id, user_role FROM audit_logs"))
            )
            assert rows == [(None, "admin")], (
                "user_id must be SET NULL while the row itself survives"
            )
        engine.dispose()

    def test_expected_indexes(self, tmp_path: Path) -> None:
        """Index set per §5: created_at, user_id, (entity, entity_id), action."""
        db_path = tmp_path / "audit_logs_indexes.db"
        _upgrade_to_head(db_path)

        engine = create_engine(f"sqlite:///{db_path}")
        with engine.connect() as conn:
            # index name → column set
            idx: dict[str, frozenset[str]] = {}
            for row in conn.execute(text("PRAGMA index_list(audit_logs)")):
                name = row[1]
                idx[name] = frozenset(
                    r[2]
                    for r in conn.execute(text(f"PRAGMA index_info({name})"))
                )
            col_sets = {cols for cols in idx.values()}
            for expected in (
                frozenset({"created_at"}),
                frozenset({"user_id"}),
                frozenset({"entity", "entity_id"}),
                frozenset({"action"}),
            ):
                assert expected in col_sets, (
                    f"missing index on {sorted(expected)}; got {col_sets}"
                )
        engine.dispose()

    def test_downgrade_drops_table(self, tmp_path: Path) -> None:
        """downgrade head → LEGACY_REVISION removes audit_logs cleanly."""
        db_path = tmp_path / "audit_logs_downgrade.db"
        _upgrade_to_head(db_path)

        logging.getLogger("alembic").setLevel(logging.WARNING)
        cfg = _cfg(db_path)
        command.downgrade(cfg, LEGACY_REVISION)

        engine = create_engine(f"sqlite:///{db_path}")
        with engine.connect() as conn:
            assert not _table_exists(conn, "audit_logs")
            assert (
                list(conn.execute(text("SELECT version_num FROM alembic_version")))
                == [(LEGACY_REVISION,)]
            )
        engine.dispose()


class TestAuditLogModelAppendOnly:
    def test_model_declared_on_base_with_own_id_and_created_at(self) -> None:
        """AuditLog: own id/created_at, no updated_at, no soft-delete flag."""
        from src.db.base import Base
        from src.models.audit_log import AuditLog

        assert AuditLog.__tablename__ == "audit_logs"
        assert issubclass(AuditLog, Base)
        # Registered on the shared metadata (seed.py builds schema from it).
        assert "audit_logs" in Base.metadata.tables

        cols = AuditLog.__table__.columns
        assert set(cols.keys()) == {
            "id", "created_at", "user_id", "user_role",
            "action", "entity", "entity_id", "entity_label", "changes",
        }
        assert "updated_at" not in cols.keys(), "append-only: no updated_at"
        assert "is_active" not in cols.keys(), "append-only: no soft-delete flag"

        # Own id/created_at directly on Base (AbstractModel drags updated_at).
        from src.models.abstract import AbstractModel

        assert not issubclass(AuditLog, AbstractModel)

    def test_no_relationships_declared(self) -> None:
        """No ORM relationships → no cascade writes/deletes to the journal."""
        from src.models.audit_log import AuditLog

        mapper = AuditLog.__mapper__
        assert list(mapper.relationships) == []

    def test_no_update_or_delete_surface(self) -> None:
        """Append-only at application level: no update/delete helpers (§5)."""
        import inspect

        from src.models import audit_log as audit_log_module

        src = inspect.getsource(audit_log_module)
        for banned in (
            "def update", "def delete", "def remove",
            "relationship(", "onupdate",
        ):
            assert banned not in src, (
                f"append-only violated: '{banned}' found in models/audit_log.py"
            )
