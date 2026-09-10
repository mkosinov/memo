"""GH #247 §3.3: Session ORM model + user-lock columns.

Model-level tests (repo precedent: tests/test_models.py — in-memory engine,
create_all, round-trip). Covers:
- lifetime constants (idle 7d, absolute cap 30d, extension throttle 1h);
- ``new_session(user_id)`` factory: urlsafe token, deadlines computed;
- Session persistence round-trip (token is the PK, user_id FK indexed);
- the three lock-ladder columns on User (§2.11) — defaults only; the ladder
  LOGIC is Task 4 and is deliberately not tested here.
"""

from datetime import datetime, timedelta
import os
from pathlib import Path

import pytest
from sqlalchemy import create_engine, event, inspect
from sqlalchemy.orm import Session as ORMSession

from src.auth.session import (
    ABSOLUTE_CAP,
    EXTENSION_THROTTLE,
    IDLE_WINDOW,
    Session,
    new_session,
)
from src.db.base import Base
from src.models import User  # noqa: F401 — registers users with Base.metadata

pytestmark = pytest.mark.unit


def _make_engine():
    """In-memory SQLite engine with FK support (test_models.py pattern)."""
    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


class TestConstants:
    """Lifetime constants live in the auth package (G1b decision)."""

    def test_idle_window_7_days(self) -> None:
        assert IDLE_WINDOW == timedelta(days=7)

    def test_absolute_cap_30_days(self) -> None:
        assert ABSOLUTE_CAP == timedelta(days=30)

    def test_extension_throttle_1_hour(self) -> None:
        assert EXTENSION_THROTTLE == timedelta(hours=1)


class TestNewSessionFactory:
    """``new_session(user_id)`` builds a Session with token + deadlines."""

    def test_token_is_urlsafe_43_chars(self) -> None:
        s = new_session("user-1")
        # secrets.token_urlsafe(32) → 32 bytes → 43 urlsafe chars (pads String(64))
        assert len(s.token) == 43
        assert all(c.isalnum() or c in "-_" for c in s.token)

    def test_tokens_are_unique(self) -> None:
        assert new_session("user-1").token != new_session("user-1").token

    def test_deadlines_computed(self) -> None:
        before = datetime.utcnow()
        s = new_session("user-1")
        after = datetime.utcnow()
        assert before <= s.created_at <= after
        assert s.last_extended_at == s.created_at
        assert s.idle_deadline == s.last_extended_at + IDLE_WINDOW
        assert s.absolute_deadline == s.created_at + ABSOLUTE_CAP

    def test_user_id_set(self) -> None:
        assert new_session("u-123").user_id == "u-123"


class TestSessionPersistence:
    """Session round-trips with token as PK; user_id indexed; no soft-delete."""

    def _session_with_user(self, orm: ORMSession) -> User:
        u = User(phone="+79001234567", password_hash="h", role="admin")
        orm.add(u)
        orm.flush()
        return u

    def test_round_trip(self):
        engine = _make_engine()
        Base.metadata.create_all(engine)
        with ORMSession(engine) as orm:
            u = self._session_with_user(orm)
            s = new_session(u.id)
            orm.add(s)
            orm.flush()

            fetched = orm.get(Session, s.token)
            assert fetched is not None
            assert fetched.user_id == u.id
            assert fetched.created_at == s.created_at
            assert fetched.last_extended_at == s.last_extended_at
            assert fetched.idle_deadline == s.idle_deadline
            assert fetched.absolute_deadline == s.absolute_deadline

    def test_token_is_primary_key(self):
        engine = _make_engine()
        Base.metadata.create_all(engine)
        cols = {c["name"]: c for c in inspect(engine).get_columns("sessions")}
        assert cols["token"].get("primary_key")  # SQLite reports PK as 1

    def test_user_id_indexed(self):
        engine = _make_engine()
        Base.metadata.create_all(engine)
        idx_cols = [
            tuple(idx["column_names"])
            for idx in inspect(engine).get_indexes("sessions")
        ]
        assert ("user_id",) in idx_cols

    def test_hard_delete_no_is_active(self):
        """Sessions are hard-deleted rows — no soft-delete flag (§2.2)."""
        assert not hasattr(Session, "is_active")

    def test_multiple_sessions_per_user(self):
        engine = _make_engine()
        Base.metadata.create_all(engine)
        with ORMSession(engine) as orm:
            u = self._session_with_user(orm)
            s1, s2 = new_session(u.id), new_session(u.id)
            orm.add_all([s1, s2])
            orm.flush()
            assert orm.get(Session, s1.token) is not None
            assert orm.get(Session, s2.token) is not None


class TestSessionRegisteredInModelsMetadata:
    """Importing src.models registers Session with Base.metadata.

    seed.py creates dev/E2E schema via ``Base.metadata.create_all``
    (on a wiped DB ``run_alembic_upgrade`` only stamps head —
    src/db/migrate.py:57-62), so a missing registration silently
    omits the ``sessions`` table in dev and e2e (review blocker).
    """

    def test_import_src_models_registers_sessions(self):
        import subprocess
        import sys

        probe = (
            "import src.models\n"
            "from src.db.base import Base\n"
            "assert 'sessions' in Base.metadata.tables, Base.metadata.tables.keys()\n"
            "print('OK')\n"
        )
        result = subprocess.run(
            [sys.executable, "-c", probe],
            capture_output=True, text=True, cwd=Path(__file__).resolve().parents[1],
        )
        assert result.returncode == 0, result.stderr
        assert "OK" in result.stdout

    def test_create_all_after_importing_src_models_creates_sessions(self):
        import subprocess
        import sys
        import tempfile

        db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        db.close()
        probe = (
            "import src.models\n"
            "from sqlalchemy import create_engine, inspect\n"
            "from src.db.base import Base\n"
            f"e = create_engine('sqlite:///{db.name}')\n"
            "Base.metadata.create_all(e)\n"
            "assert 'sessions' in inspect(e).get_table_names()\n"
            "print('OK')\n"
        )
        try:
            result = subprocess.run(
                [sys.executable, "-c", probe],
                capture_output=True, text=True, cwd=Path(__file__).resolve().parents[1],
            )
            assert result.returncode == 0, result.stderr
            assert "OK" in result.stdout
        finally:
            os.unlink(db.name)


class TestUserLockColumns:
    """§2.11 ladder STATE columns on users; logic is Task 4, defaults only."""

    def test_defaults(self):
        engine = _make_engine()
        Base.metadata.create_all(engine)
        with ORMSession(engine) as orm:
            u = User(phone="+79001234568", password_hash="h", role="admin")
            orm.add(u)
            orm.flush()
            fetched = orm.get(User, u.id)
            assert fetched.failed_login_attempts == 0
            assert fetched.lock_level == 0
            assert fetched.locked_until is None

    def test_values_persist(self):
        engine = _make_engine()
        Base.metadata.create_all(engine)
        until = datetime(2026, 9, 10, 12, 0, 0)
        with ORMSession(engine) as orm:
            u = User(
                phone="+79001234569", password_hash="h", role="admin",
                failed_login_attempts=3, lock_level=1, locked_until=until,
            )
            orm.add(u)
            orm.flush()
            fetched = orm.get(User, u.id)
            assert fetched.failed_login_attempts == 3
            assert fetched.lock_level == 1
            assert fetched.locked_until == until
