"""#348 Task 1 — password_setup_tokens model + migration tests.

Storage layer for the one-time password setup link (spec
docs/specs/2026-09-27-user-accounts-348-design.md §4; canon
docs/domain-rules/auth.md «Одноразовая ссылка установки пароля»):

- ``token`` — PK, SHA-256 hex digest of the raw token (raw token lives
  only in the URL fragment, never stored);
- ``user_id`` — FK users.id ON DELETE CASCADE, indexed;
- ``expires_at`` / ``created_at`` — naive UTC datetimes; ``used_at`` —
  nullable, NULL = token still live;
- partial unique index on ``user_id`` among rows with ``used_at IS NULL``
  — "one live token per account" enforced by the database (concurrent
  double-issue race decided by the DB);
- migration also makes ``users.password_hash`` nullable (NULL = password
  not set yet); existing rows keep their hashes.

Test layout follows the repo precedents: ORM-level checks on an
in-memory engine (tests/test_auth_session_model.py), migration checks
on a tmp-file alembic DB (tests/test_migration_audit_logs.py). Own DBs
only — the session test DB is untouched → ``pure_unit``.
"""

import logging
from datetime import datetime
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as ORMSession

from alembic import command
from src.db.base import Base
from src.models import User

BACKEND_DIR = Path(__file__).resolve().parents[1]

# Revision right BEFORE #348 (the audit_logs head) — the new migration's parent.
LEGACY_REVISION = "c4e6a8f0b2d1"

HEAD_REVISION = ScriptDirectory(
    str(BACKEND_DIR / "alembic")
).get_current_head()

pytestmark = pytest.mark.pure_unit  # own in-memory/tmp-file DBs; session DB untouched

# Unique phones for raw-SQL user inserts (exact-string uniqueness, no normalization).
_phone_seq = iter(range(1, 9999))


def _next_phone() -> str:
    return f"+7000000{next(_phone_seq):05d}"


def _make_engine():
    """In-memory SQLite engine with FK support (test_models.py pattern)."""
    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


def _cfg(db_path: Path) -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return cfg


def _upgrade_to_head(db_path: Path) -> None:
    logging.getLogger("alembic").setLevel(logging.WARNING)
    command.upgrade(_cfg(db_path), "head")


def _insert_user(conn, *, uid: str, password_hash: str | None = "h") -> None:
    """Raw-SQL user insert valid at LEGACY_REVISION..head (audit-test pattern)."""
    hash_literal = "NULL" if password_hash is None else f"'{password_hash}'"
    conn.execute(text(
        "INSERT INTO users (id, phone, password_hash, role,"
        " email_is_confirmed, phone_is_confirmed,"
        " failed_login_attempts, lock_level,"
        " created_at, updated_at, is_active)"
        f" VALUES ('{uid}', '{_next_phone()}', {hash_literal}, 'admin',"
        " 0, 0, 0, 0,"
        " datetime('now'), datetime('now'), 1)"
    ))
    conn.commit()


def _insert_token(
    conn, *, digest: str, uid: str,
    used: bool = False, expires_in_hours: int = 24,
) -> None:
    used_expr = "datetime('now')" if used else "NULL"
    conn.execute(text(
        "INSERT INTO password_setup_tokens"
        " (token, user_id, expires_at, used_at, created_at)"
        f" VALUES ('{digest}', '{uid}',"
        f" datetime('now', '+{expires_in_hours} hours'), {used_expr},"
        " datetime('now'))"
    ))
    conn.commit()


# ─── ORM model declaration ─────────────────────────────────────────────────────


class TestPasswordSetupTokenModel:
    def test_registered_with_base_metadata(self) -> None:
        """Auth-owned model registers on the shared metadata (seed/env build
        the schema from it) — the Session-model precedent."""
        assert "password_setup_tokens" in Base.metadata.tables

    def test_declared_on_base_with_digest_pk(self) -> None:
        """Digest is the PK; no surrogate id, no soft-delete, no updated_at —
        mirror of the Session model (the token IS the identity)."""
        from src.auth.password_setup import PasswordSetupToken
        from src.models.abstract import AbstractModel

        assert PasswordSetupToken.__tablename__ == "password_setup_tokens"
        assert issubclass(PasswordSetupToken, Base)
        assert not issubclass(PasswordSetupToken, AbstractModel)

        cols = PasswordSetupToken.__table__.columns
        assert set(cols.keys()) == {
            "token", "user_id", "expires_at", "used_at", "created_at",
        }
        pk = list(PasswordSetupToken.__table__.primary_key.columns)
        assert [c.name for c in pk] == ["token"], "digest must be the PK"
        # SHA-256 hex digest = 64 chars
        assert cols["token"].type.length == 64

    def test_column_types_and_nullability(self) -> None:
        from src.auth.password_setup import PasswordSetupToken

        cols = PasswordSetupToken.__table__.columns
        assert not cols["token"].nullable
        assert not cols["user_id"].nullable
        assert not cols["expires_at"].nullable
        assert cols["used_at"].nullable, "used_at NULL = token still live"
        assert not cols["created_at"].nullable

    def test_user_id_fk_cascade_and_index(self) -> None:
        from src.auth.password_setup import PasswordSetupToken

        fks = list(PasswordSetupToken.__table__.foreign_keys)
        assert len(fks) == 1
        fk = fks[0]
        assert fk.target_fullname == "users.id"
        assert fk.ondelete == "CASCADE"

        idx = PasswordSetupToken.__table__.indexes
        plain = [i for i in idx if i.name == "ix_password_setup_tokens_user_id"]
        assert plain and not plain[0].unique, "user_id lookup index expected"

    def test_partial_unique_index_declared(self) -> None:
        """Model declares UNIQUE(user_id) WHERE used_at IS NULL."""
        from src.auth.password_setup import PasswordSetupToken

        idx = PasswordSetupToken.__table__.indexes
        partial = [
            i for i in idx if i.name == "uq_password_setup_tokens_user_id_unused"
        ]
        assert partial, f"partial unique index missing; got {sorted(i.name for i in idx)}"
        p = partial[0]
        assert p.unique
        assert [c.name for c in p.columns] == ["user_id"]
        where = str(p.dialect_options["sqlite"]["where"])
        assert "used_at IS NULL" in where


class TestModelBehaviorOnCreateAll:
    """create_all + ORM round-trip: the partial index actually enforces."""

    def test_user_without_password_hash_is_persistable(self) -> None:
        """#348: users.password_hash is now nullable (NULL = not set yet)."""
        engine = _make_engine()
        Base.metadata.create_all(engine)
        with ORMSession(engine) as s:
            u = User(phone=_next_phone(), role="admin")
            s.add(u)
            s.commit()
            assert u.password_hash is None
            assert u.id
        engine.dispose()

    def test_two_live_tokens_same_user_rejected(self) -> None:
        from src.auth.password_setup import PasswordSetupToken

        engine = _make_engine()
        Base.metadata.create_all(engine)
        with ORMSession(engine) as s:
            u = User(phone=_next_phone(), role="admin")
            s.add(u)
            s.commit()
            s.add(PasswordSetupToken(
                token="a" * 64, user_id=u.id, expires_at=datetime.utcnow(),
            ))
            s.commit()
            s.add(PasswordSetupToken(
                token="b" * 64, user_id=u.id, expires_at=datetime.utcnow(),
            ))
            with pytest.raises(IntegrityError):
                s.commit()
            s.rollback()
        engine.dispose()

    def test_used_token_frees_the_slot(self) -> None:
        """Once the live token is consumed (used_at set), another live token
        for the same user is insertable; multiple used rows coexist."""
        from src.auth.password_setup import PasswordSetupToken

        engine = _make_engine()
        Base.metadata.create_all(engine)
        with ORMSession(engine) as s:
            u = User(phone=_next_phone(), role="admin")
            s.add(u)
            s.commit()
            first = PasswordSetupToken(
                token="a" * 64, user_id=u.id, expires_at=datetime.utcnow(),
            )
            s.add(first)
            s.commit()

            first.used_at = datetime.utcnow()
            s.commit()

            # A fresh live token for the same user is fine now…
            s.add(PasswordSetupToken(
                token="b" * 64, user_id=u.id, expires_at=datetime.utcnow(),
            ))
            s.commit()

            # …and another USED row also does not clash with the live one.
            s.add(PasswordSetupToken(
                token="c" * 64, user_id=u.id,
                expires_at=datetime.utcnow(), used_at=datetime.utcnow(),
            ))
            s.commit()
        engine.dispose()

    def test_user_hard_delete_cascades_tokens(self) -> None:
        from src.auth.password_setup import PasswordSetupToken

        engine = _make_engine()
        Base.metadata.create_all(engine)
        with ORMSession(engine) as s:
            u = User(phone=_next_phone(), role="admin")
            s.add(u)
            s.commit()
            s.add(PasswordSetupToken(
                token="a" * 64, user_id=u.id, expires_at=datetime.utcnow(),
            ))
            s.commit()
            s.delete(u)
            s.commit()

            left = s.execute(select(PasswordSetupToken)).scalars().all()
            assert left == [], "tokens must cascade away with the user"
        engine.dispose()


# ─── Migration ─────────────────────────────────────────────────────────────────


class TestPasswordSetupTokensMigration:
    def test_upgrade_creates_table_with_expected_shape(self, tmp_path: Path) -> None:
        db_path = tmp_path / "pst_migration.db"
        _upgrade_to_head(db_path)

        engine = create_engine(f"sqlite:///{db_path}")
        with engine.connect() as conn:
            assert list(conn.execute(text(
                "SELECT version_num FROM alembic_version"
            ))) == [(HEAD_REVISION,)]

            cols = {
                r[1]: (r[2].upper(), r[3], r[5])
                for r in conn.execute(
                    text("PRAGMA table_info(password_setup_tokens)")
                )
            }
            assert set(cols) == {
                "token", "user_id", "expires_at", "used_at", "created_at",
            }
            assert cols["token"][0] == "VARCHAR(64)"
            assert cols["token"][2] == 1, "token must be the PK"
            assert cols["user_id"][0] == "VARCHAR(36)"
            for name in ("token", "user_id", "expires_at", "created_at"):
                assert cols[name][1] == 1, f"{name} must be NOT NULL"
            assert cols["used_at"][1] == 0, "used_at must be nullable"
            for name in ("expires_at", "used_at", "created_at"):
                assert cols[name][0] == "DATETIME"
        engine.dispose()

    def test_fk_on_delete_cascade(self, tmp_path: Path) -> None:
        db_path = tmp_path / "pst_fk.db"
        _upgrade_to_head(db_path)

        engine = create_engine(f"sqlite:///{db_path}")
        with engine.connect() as conn:
            fks = list(conn.execute(
                text("PRAGMA foreign_key_list(password_setup_tokens)")
            ))
            assert len(fks) == 1
            fk = fks[0]
            # (id, seq, table, from, to, on_update, on_delete, match)
            assert fk[2] == "users" and fk[3] == "user_id" and fk[4] == "id"
            assert fk[6].upper() == "CASCADE"
        engine.dispose()

    def test_expected_indexes_including_partial_unique(
        self, tmp_path: Path,
    ) -> None:
        db_path = tmp_path / "pst_indexes.db"
        _upgrade_to_head(db_path)

        engine = create_engine(f"sqlite:///{db_path}")
        with engine.connect() as conn:
            # (seq, name, unique, origin, partial)
            rows = list(conn.execute(
                text("PRAGMA index_list(password_setup_tokens)")
            ))
            by_name = {r[1]: r for r in rows}

            plain = by_name.get("ix_password_setup_tokens_user_id")
            assert plain is not None, f"user_id index missing; got {sorted(by_name)}"
            assert plain[2] == 0, "lookup index must not be unique"
            cols = [
                r[2] for r in conn.execute(
                    text("PRAGMA index_info(ix_password_setup_tokens_user_id)")
                )
            ]
            assert cols == ["user_id"]

            partial = by_name.get("uq_password_setup_tokens_user_id_unused")
            assert partial is not None, (
                f"partial unique index missing; got {sorted(by_name)}"
            )
            assert partial[2] == 1, "must be UNIQUE"
            assert partial[4] == 1, "must be a PARTIAL index (WHERE clause)"
            cols = [
                r[2] for r in conn.execute(text(
                    "PRAGMA index_info(uq_password_setup_tokens_user_id_unused)"
                ))
            ]
            assert cols == ["user_id"]
        engine.dispose()

    def test_partial_unique_index_enforced_on_migrated_schema(
        self, tmp_path: Path,
    ) -> None:
        db_path = tmp_path / "pst_partial.db"
        _upgrade_to_head(db_path)

        engine = create_engine(f"sqlite:///{db_path}")
        with engine.connect() as conn:
            conn.execute(text("PRAGMA foreign_keys = ON"))
            _insert_user(conn, uid="u1")
            _insert_token(conn, digest="a" * 64, uid="u1")
            # Second LIVE token for the same user → rejected by the DB.
            with pytest.raises(IntegrityError):
                _insert_token(conn, digest="b" * 64, uid="u1")
            # A second user's live token is fine.
            _insert_user(conn, uid="u2")
            _insert_token(conn, digest="c" * 64, uid="u2")
        engine.dispose()

    def test_users_password_hash_nullable_at_head(self, tmp_path: Path) -> None:
        db_path = tmp_path / "pst_hash_nullable.db"
        _upgrade_to_head(db_path)

        engine = create_engine(f"sqlite:///{db_path}")
        with engine.connect() as conn:
            cols = {
                r[1]: r[3]
                for r in conn.execute(text("PRAGMA table_info(users)"))
            }
            assert cols["password_hash"] == 0, "password_hash must be nullable"
            # And a hashless user actually persists (NULL = not set yet).
            _insert_user(conn, uid="u1", password_hash=None)
            stored = conn.execute(
                text("SELECT password_hash FROM users WHERE id = 'u1'")
            ).scalar()
            assert stored is None
        engine.dispose()

    def test_existing_rows_keep_their_hash(self, tmp_path: Path) -> None:
        """Upgrade does not touch existing rows (all current users have one)."""
        db_path = tmp_path / "pst_keep_hash.db"
        logging.getLogger("alembic").setLevel(logging.WARNING)
        cfg = _cfg(db_path)
        command.upgrade(cfg, LEGACY_REVISION)

        engine = create_engine(f"sqlite:///{db_path}")
        with engine.connect() as conn:
            _insert_user(conn, uid="u1", password_hash="argon2id$legacy")
        engine.dispose()

        command.upgrade(cfg, "head")

        engine = create_engine(f"sqlite:///{db_path}")
        with engine.connect() as conn:
            stored = conn.execute(
                text("SELECT password_hash FROM users WHERE id = 'u1'")
            ).scalar()
            assert stored == "argon2id$legacy"
        engine.dispose()

    def test_downgrade_drops_table_and_restores_not_null(
        self, tmp_path: Path,
    ) -> None:
        db_path = tmp_path / "pst_downgrade.db"
        _upgrade_to_head(db_path)

        logging.getLogger("alembic").setLevel(logging.WARNING)
        command.downgrade(_cfg(db_path), LEGACY_REVISION)

        engine = create_engine(f"sqlite:///{db_path}")
        with engine.connect() as conn:
            assert not list(conn.execute(text(
                "SELECT 1 FROM sqlite_master"
                " WHERE name='password_setup_tokens'"
            ))), "table must be gone after downgrade"
            assert not list(conn.execute(text(
                "SELECT 1 FROM sqlite_master"
                " WHERE name='uq_password_setup_tokens_user_id_unused'"
            ))), "partial index must be gone after downgrade"
            cols = {
                r[1]: r[3]
                for r in conn.execute(text("PRAGMA table_info(users)"))
            }
            assert cols["password_hash"] == 1, (
                "password_hash must be NOT NULL again after downgrade"
            )
            assert list(conn.execute(
                text("SELECT version_num FROM alembic_version")
            )) == [(LEGACY_REVISION,)]
        engine.dispose()

    def test_upgrade_downgrade_upgrade_symmetric(self, tmp_path: Path) -> None:
        """upgrade head → downgrade -1 → upgrade head runs clean and ends at
        head — the task's explicit symmetry requirement."""
        db_path = tmp_path / "pst_symmetry.db"
        logging.getLogger("alembic").setLevel(logging.WARNING)
        cfg = _cfg(db_path)

        command.upgrade(cfg, "head")
        command.downgrade(cfg, "-1")
        command.upgrade(cfg, "head")

        engine = create_engine(f"sqlite:///{db_path}")
        with engine.connect() as conn:
            assert list(conn.execute(
                text("SELECT version_num FROM alembic_version")
            )) == [(HEAD_REVISION,)]
            assert list(conn.execute(text(
                "SELECT 1 FROM sqlite_master"
                " WHERE name='password_setup_tokens'"
            ))), "table must exist again"
            # …and the recreated schema still enforces the partial index.
            _insert_user(conn, uid="u1")
            _insert_token(conn, digest="a" * 64, uid="u1")
            with pytest.raises(IntegrityError):
                _insert_token(conn, digest="b" * 64, uid="u1")
        engine.dispose()
