"""Management CLI — GH #247 §3.10.

Bootstrap tool for staff accounts: ``python -m src.cli create-user`` prompts
for a password (double entry), validates it against the policy, hashes it
and INSERTs the ``users`` row. This is how the first production admin is
created — the repo ships no default credentials (public repo).

Usage:
    uv run python -m src.cli create-user --phone "+79990000001" --role admin

Errors: duplicate phone → clear message, exit 1; invalid role → argparse
exit 2 listing the choices. Password entry: double ``getpass``, re-asked on
mismatch or policy violation (hint printed), Ctrl-C aborts.

Async DB access follows the ``seed.py`` pattern: a short-lived ``DBManager``
driven by ``asyncio.run`` (DATABASE_URL env or the dev default).

Spec: docs/specs/2026-09-08-auth-design.md §3.10
Domain rules: docs/domain-rules/auth.md (User Provisioning)
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from typing import TYPE_CHECKING

# ruff: noqa: RUF001  -- Cyrillic text is intentional (Russian language app)
from sqlalchemy import select

from src.auth.passwords import (
    PASSWORD_POLICY_HINT_RU,
    PasswordPolicyError,
    hash_password,
    validate_password,
)
from src.db.database import DBManager
from src.models.enums import UserRole
from src.models.user import User

if TYPE_CHECKING:
    from collections.abc import Callable

    from sqlalchemy.ext.asyncio import AsyncSession

ROLE_CHOICES = [role.value for role in UserRole]


class DuplicatePhoneError(Exception):
    """A user with this phone already exists."""


async def create_user(session: AsyncSession, phone: str, role: str, password: str) -> User:
    """Validate and INSERT a staff user; return the persisted row.

    The phone is trimmed (login trims too, spec §2.3); the password runs
    through ``validate_password`` (policy gate → trimmed value) before
    hashing. Raises ``DuplicatePhoneError`` when the phone is taken and
    ``PasswordPolicyError`` when the password fails the policy (in which
    case nothing is inserted).
    """
    phone = phone.strip()
    existing = (await session.execute(select(User).where(User.phone == phone))).scalar_one_or_none()
    if existing is not None:
        raise DuplicatePhoneError(phone)

    password = validate_password(password)
    user = User(
        phone=phone,
        role=role,
        password_hash=hash_password(password),
    )
    session.add(user)
    await session.flush()
    return user


def _default_prompt(_prompt: str) -> str:  # pragma: no cover — needs a tty
    import getpass

    return getpass.getpass(_prompt)


def prompt_password(prompt_fn: Callable[[str], str] = _default_prompt) -> str:
    """Ask for the password twice; re-ask until the entries agree and pass
    the policy (hint printed on violation). Ctrl-C aborts.

    ``prompt_fn`` is injectable so tests can drive the loop without a tty;
    the default echoes nothing (``getpass``).
    """
    print(PASSWORD_POLICY_HINT_RU)
    while True:
        first = prompt_fn("Пароль: ")
        second = prompt_fn("Повторите пароль: ")
        if first != second:
            print("Пароли не совпадают — попробуйте ещё раз.")
            continue
        try:
            return validate_password(first)
        except PasswordPolicyError:
            print(PASSWORD_POLICY_HINT_RU)


def build_parser() -> argparse.ArgumentParser:
    """The CLI parser: ``create-user --phone <str> --role {admin,master}``."""
    parser = argparse.ArgumentParser(
        prog="python -m src.cli",
        description="Memo management CLI",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser(
        "create-user",
        help="Создать сотрудника (админ/мастер) с паролем",
    )
    create.add_argument("--phone", required=True, help="Телефон, например +79990000001")
    create.add_argument(
        "--role", required=True, choices=ROLE_CHOICES, help="Роль: admin или master"
    )
    return parser


async def _run_create_user(database_url: str, args: argparse.Namespace) -> int:
    """Connect, prompt, INSERT, disconnect. Returns the process exit code."""
    manager = DBManager(database_url)
    try:
        async with manager.async_session() as session:
            try:
                user = await create_user(session, args.phone, args.role, prompt_password())
            except DuplicatePhoneError:
                await session.rollback()
                print(
                    f"Пользователь с телефоном {args.phone.strip()} уже существует.",
                    file=sys.stderr,
                )
                return 1
            await session.commit()
        print(f"Создан пользователь {user.phone} (роль: {user.role}).")
        return 0
    finally:
        await manager.engine.dispose()


def main(argv: list[str] | None = None) -> int:
    """Entry point — returns the exit code (0 ok, 1 duplicate phone)."""
    args = build_parser().parse_args(argv)
    database_url = os.environ.get("DATABASE_URL", "sqlite+aiosqlite:///./memo.db")
    try:
        return asyncio.run(_run_create_user(database_url, args))
    except KeyboardInterrupt:
        print("\nОтменено.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
