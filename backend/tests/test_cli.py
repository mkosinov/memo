"""GH #247 §3.10: management CLI — create-user (prompt + validate + INSERT).

The interactive getpass loop cannot run in CI; these tests pin the pure and
transport parts: the prompt loop via an injected prompt function (mismatch
re-ask, policy re-ask with hint, Ctrl-C abort), argparse role choices, and
``main()`` exit codes against a temp-file DB. The INSERT semantics (duplicate
phone, policy gate, trimmed password hash, GH #319 settings-row guarantee)
live with the ``usecases.user.create_user`` scenario — see
tests/usecases/test_user_create.py (the CLI is rewired onto the scenario).

DoD also includes the manual bootstrap check (spec §3.10): create a user
via the real CLI, then log in through a pytest client.

Spec: docs/specs/2026-09-08-auth-design.md §3.10
Domain rules: docs/domain-rules/auth.md (User Provisioning)
"""

from __future__ import annotations

import asyncio
import sqlite3

import pytest

from src.auth.passwords import PASSWORD_POLICY_HINT_RU
from src.db.base import Base
from src.db.database import DBManager

pytestmark = pytest.mark.misc


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
        from src.cli import main
        from src.usecases.user import create_user as create_user_scenario

        db_path = tmp_path / "cli_dup.db"
        db_url = f"sqlite+aiosqlite:///{db_path}"

        async def _prepare() -> None:
            manager = DBManager(db_url)
            async with manager.engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            async with manager.async_session() as session:
                await create_user_scenario(
                    None,
                    db_session=session,
                    phone="+79990000099",
                    role="admin",
                    password="password123",
                )
            await manager.engine.dispose()

        asyncio.run(_prepare())

        monkeypatch.setenv("DATABASE_URL", db_url)
        monkeypatch.setattr("src.cli.prompt_password", lambda: "password456")

        rc = main(["create-user", "--phone", " +79990000099 ", "--role", "admin"])

        assert rc == 1
        err = capsys.readouterr().err
        assert "+79990000099" in err
        assert "уже существует" in err
