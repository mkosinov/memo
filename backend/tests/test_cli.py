"""GH #247 §3.10: management CLI — create-user (prompt + validate + INSERT).

The interactive getpass loop cannot run in CI; these tests pin the pure and
DB parts: the prompt loop via an injected prompt function (mismatch re-ask,
policy re-ask with hint, Ctrl-C abort), ``create_user`` INSERT semantics
(duplicate phone, policy gate, trimmed password hash), argparse role
choices, and ``main()`` exit codes against a temp-file DB.

DoD also includes the manual bootstrap check (spec §3.10): create a user
via the real CLI, then log in through a pytest client.

Spec: docs/specs/2026-09-08-auth-design.md §3.10
Domain rules: docs/domain-rules/auth.md (User Provisioning)
"""

from __future__ import annotations

import asyncio
import sqlite3

import pytest
from sqlalchemy import select

from src.auth.passwords import PASSWORD_POLICY_HINT_RU, verify_password
from src.db.base import Base
from src.db.database import DBManager
from src.models.user import User

pytestmark = pytest.mark.misc


@pytest.fixture
async def db_manager():
    """In-memory test database manager with tables (test_seed.py pattern)."""
    manager = DBManager("sqlite+aiosqlite:///:memory:")
    async with manager.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield manager
    await manager.engine.dispose()


class TestCreateUser:
    async def test_inserts_user_with_hashed_trimmed_password(self, db_manager: DBManager) -> None:
        """create_user stores the trimmed phone and a hash of the trimmed
        password; staff-card linking stays None (sqladmin's job, §2.9)."""
        from src.cli import create_user

        async with db_manager.async_session() as session:
            user = await create_user(session, "+79990000099", "admin", "  manual-pw-99  ")
            await session.commit()

        assert user.phone == "+79990000099"
        assert user.role == "admin"
        assert user.staff_id is None

        async with db_manager.async_session() as session:
            stored = (await session.execute(select(User))).scalar_one()
        assert stored.phone == "+79990000099"
        assert stored.is_active is True
        assert verify_password("manual-pw-99", stored.password_hash)

    async def test_duplicate_phone_raises(self, db_manager: DBManager) -> None:
        """Second create with the same phone → DuplicatePhoneError."""
        from src.cli import DuplicatePhoneError, create_user

        async with db_manager.async_session() as session:
            await create_user(session, "+79990000099", "admin", "password123")
            await session.commit()

        async with db_manager.async_session() as session:
            with pytest.raises(DuplicatePhoneError):
                await create_user(session, "+79990000099", "master", "password456")

    async def test_policy_violation_raises_no_row(self, db_manager: DBManager) -> None:
        """Short password → PasswordPolicyError, nothing inserted."""
        from src.auth.passwords import PasswordPolicyError
        from src.cli import create_user

        async with db_manager.async_session() as session:
            with pytest.raises(PasswordPolicyError):
                await create_user(session, "+79990000010", "admin", "short")
            await session.commit()

        async with db_manager.async_session() as session:
            stored = (await session.execute(select(User))).scalar_one_or_none()
        assert stored is None


class TestPromptPassword:
    def test_mismatch_reasks(self) -> None:
        """Mismatched pair is re-asked until the two entries agree."""
        from src.cli import prompt_password

        answers = iter(["pw-one", "pw-two", "pw-three", "pw-three"])
        result = prompt_password(prompt_fn=lambda _: next(answers))
        assert result == "pw-three"

    def test_policy_failure_reasks_with_hint(self, capsys) -> None:
        """Matching-but-invalid pair re-asks; the policy hint is shown."""
        from src.cli import prompt_password

        answers = iter(["short", "short", "long-enough", "long-enough"])
        result = prompt_password(prompt_fn=lambda _: next(answers))
        assert result == "long-enough"
        assert PASSWORD_POLICY_HINT_RU in capsys.readouterr().out

    def test_ctrl_c_aborts(self) -> None:
        """Ctrl-C at the prompt aborts (KeyboardInterrupt propagates)."""
        from src.cli import prompt_password

        def raising(_prompt: str) -> str:
            raise KeyboardInterrupt

        with pytest.raises(KeyboardInterrupt):
            prompt_password(prompt_fn=raising)


def test_parser_rejects_invalid_role() -> None:
    """--role is argparse choices over UserRole values → exit 2 listing them."""
    from src.cli import build_parser

    with pytest.raises(SystemExit) as exc:
        build_parser().parse_args(["create-user", "--phone", "+7", "--role", "banana"])
    assert exc.value.code == 2


class TestMain:
    def test_main_creates_user_and_exits_0(self, tmp_path, monkeypatch, capsys) -> None:
        """Full main() happy path: INSERT lands in the target DB, exit 0.

        The CLI assumes the schema already exists (bootstrap order per
        spec §3.10: deploy → migration → create-user) — the test creates it.
        """
        from src.cli import main

        db_path = tmp_path / "cli_create.db"
        db_url = f"sqlite+aiosqlite:///{db_path}"

        async def _prepare() -> None:
            manager = DBManager(db_url)
            async with manager.engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            await manager.engine.dispose()

        asyncio.run(_prepare())

        monkeypatch.setenv("DATABASE_URL", db_url)
        monkeypatch.setattr("src.cli.prompt_password", lambda: "password123")

        rc = main(["create-user", "--phone", "+79990000077", "--role", "master"])

        assert rc == 0
        assert "+79990000077" in capsys.readouterr().out
        conn = sqlite3.connect(db_path)
        try:
            rows = conn.execute("SELECT phone, role, staff_id, is_active FROM users").fetchall()
        finally:
            conn.close()
        assert rows == [("+79990000077", "master", None, 1)]

    def test_main_duplicate_phone_exits_1(self, tmp_path, monkeypatch, capsys) -> None:
        """Duplicate phone → clear Russian error on stderr, exit 1."""
        from src.cli import create_user, main

        db_path = tmp_path / "cli_dup.db"
        db_url = f"sqlite+aiosqlite:///{db_path}"

        async def _prepare() -> None:
            manager = DBManager(db_url)
            async with manager.engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            async with manager.async_session() as session:
                await create_user(session, "+79990000099", "admin", "password123")
                await session.commit()
            await manager.engine.dispose()

        asyncio.run(_prepare())

        monkeypatch.setenv("DATABASE_URL", db_url)
        monkeypatch.setattr("src.cli.prompt_password", lambda: "password456")

        rc = main(["create-user", "--phone", " +79990000099 ", "--role", "admin"])

        assert rc == 1
        err = capsys.readouterr().err
        assert "+79990000099" in err
        assert "уже существует" in err
