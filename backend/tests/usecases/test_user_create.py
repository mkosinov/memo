"""``create_user`` scenario tests — GH #319 Task 2.

The scenario (``src/usecases/user.py``) is Corridor 2 (canon
docs/domain-rules/service-layer.md rule 2): ONE ``@transactional``
boundary composing non-transactional service methods — the ``users`` row
insert plus the UserSettings defaults core (``insert_defaults``) in the
SAME transaction (domain-rules/auth.md «User Lifecycle» +
user_settings.md at-rest invariant).

INVARIANT GUARD (this task): after EACH creation path — CLI
``create-user`` (here) and the staff-card «Учётка»
(tests/services/test_staff_service.py) — the ``UserSettings`` row EXISTS
in the DB. The seed-path guard lands in Task 4.

Scenario semantics below are the former ``cli.create_user`` suite
(behavior-preserving move — the CLI is rewired onto the scenario).

CALLING CONVENTION: scenarios are selfless functions, so the
``@transactional`` wrapper binds the first positional arg as ``self`` —
invoke with a leading ``None`` and KEYWORD arguments (see
``src/usecases/records.py``).
"""

from __future__ import annotations

import asyncio
import sqlite3

import pytest
from sqlalchemy import select

from src.auth.passwords import PasswordPolicyError, verify_password
from src.db.base import Base
from src.db.database import DBManager
from src.models.user import User
from src.models.user_settings import UserSettings


class TestCreateUserScenario:
    """Scenario semantics — the former ``cli.create_user`` (moved) + the
    #319 defaults guarantee."""

    async def test_inserts_user_with_hashed_trimmed_password(self, db_session) -> None:
        """The scenario stores the trimmed phone and a hash of the trimmed
        password; staff-card linking stays None (CLI bootstrap, §3.10)."""
        from src.usecases.user import create_user

        user = await create_user(
            None,
            db_session=db_session,
            phone="+79990000099",
            role="admin",
            password="  manual-pw-99  ",
        )
        assert user.phone == "+79990000099"
        assert user.role == "admin"
        assert user.staff_id is None

        stored = (
            await db_session.execute(
                select(User).where(User.phone == "+79990000099")
            )
        ).scalar_one()
        assert stored.is_active is True
        assert verify_password("manual-pw-99", stored.password_hash)

    async def test_duplicate_phone_raises(self, db_session) -> None:
        from src.usecases.user import DuplicatePhoneError, create_user

        await create_user(
            None,
            db_session=db_session,
            phone="+79990000099",
            role="admin",
            password="password123",
        )
        with pytest.raises(DuplicatePhoneError):
            await create_user(
                None,
                db_session=db_session,
                phone="+79990000099",
                role="master",
                password="password456",
            )

    async def test_policy_violation_raises_no_row(self, db_session) -> None:
        from src.usecases.user import create_user

        with pytest.raises(PasswordPolicyError):
            await create_user(
                None,
                db_session=db_session,
                phone="+79990000010",
                role="admin",
                password="short",
            )
        rows = (await db_session.execute(select(User))).scalars().all()
        assert rows == []

    async def test_settings_row_exists_after_create(self, db_session) -> None:
        """GH #319 invariant at the scenario: the defaults row lands in the
        SAME transaction as the user insert."""
        from src.usecases.user import create_user

        user = await create_user(
            None,
            db_session=db_session,
            phone="+79990000011",
            role="admin",
            password="password123",
        )
        settings = (
            await db_session.execute(
                select(UserSettings).where(UserSettings.user_id == user.id)
            )
        ).scalar_one_or_none()
        assert settings is not None, (
            "GH #319 invariant broken: create_user committed without a "
            "user_settings row"
        )


class TestCreationPathInvariant:
    """GH #319 invariant — the settings row EXISTS after each creation path
    of this task (seed path: Task 4)."""

    def test_cli_create_user_path_guarantees_settings_row(
        self, tmp_path, monkeypatch
    ) -> None:
        """CLI ``create-user`` (the real ``main()`` path) lands the
        ``user_settings`` row in the same run."""
        from src.cli import main

        db_path = tmp_path / "cli_invariant.db"
        db_url = f"sqlite+aiosqlite:///{db_path}"

        async def _prepare() -> None:
            manager = DBManager(db_url)
            async with manager.engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            await manager.engine.dispose()

        asyncio.run(_prepare())
        monkeypatch.setenv("DATABASE_URL", db_url)
        monkeypatch.setattr("src.cli.prompt_password", lambda: "password123")

        rc = main(["create-user", "--phone", "+79990000078", "--role", "admin"])

        assert rc == 0
        conn = sqlite3.connect(db_path)
        try:
            rows = conn.execute(
                "SELECT us.id FROM user_settings AS us "
                "JOIN users AS u ON u.id = us.user_id "
                "WHERE u.phone = ?",
                ("+79990000078",),
            ).fetchall()
        finally:
            conn.close()
        assert len(rows) == 1, (
            "GH #319 invariant broken: CLI create-user produced no "
            "user_settings row for the new account"
        )

    def test_seed_path_guarantees_settings_row(
        self, tmp_path, monkeypatch
    ) -> None:
        """The dev seed (the real ``seed_data`` path) lands a
        ``user_settings`` row for EVERY demo account (GH #319 — moved here
        from Task 2: the seed changes with the Task 4 factory work)."""
        # Import first: registers ALL seed models with Base.metadata so the
        # create_all below sees the full schema (same as the cli import above).
        from src.seed.seed import seed_data

        db_path = tmp_path / "seed_invariant.db"
        db_url = f"sqlite+aiosqlite:///{db_path}"
        monkeypatch.setenv("ENV", "development")

        async def _run() -> None:
            manager = DBManager(db_url)
            async with manager.engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            await seed_data(manager)
            await manager.engine.dispose()

        asyncio.run(_run())

        conn = sqlite3.connect(db_path)
        try:
            rows = conn.execute(
                "SELECT u.phone, us.id FROM user_settings AS us "
                "JOIN users AS u ON u.id = us.user_id "
                "ORDER BY u.phone"
            ).fetchall()
        finally:
            conn.close()
        phones = [r[0] for r in rows]
        assert phones == ["+79990000001", "+79990000002"], (
            "GH #319 invariant broken: the seed produced users without "
            f"user_settings rows (got phones {phones!r})"
        )
