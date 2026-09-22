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

GH #319: the INSERT itself is the ``usecases.user.create_user`` scenario
(ONE transaction — user row + UserSettings defaults); this module stays
transport: prompt, argparse, exit codes.

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
from src.auth.passwords import (
    PASSWORD_POLICY_HINT_RU,
    PasswordPolicyError,
    validate_password,
)
from src.db.database import DBManager
from src.models.enums import UserRole
from src.usecases.user import DuplicatePhoneError
from src.usecases.user import create_user as create_user_scenario

if TYPE_CHECKING:
    from collections.abc import Callable

ROLE_CHOICES = [role.value for role in UserRole]


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
    """Connect, prompt, run the ``create_user`` scenario, disconnect.

    Returns the process exit code. The scenario owns the transaction —
    ONE commit for the user row + its UserSettings defaults (GH #319).
    """
    manager = DBManager(database_url)
    try:
        async with manager.async_session() as session:
            try:
                user = await create_user_scenario(
                    None,  # selfless @transactional slot (usecases convention)
                    db_session=session,
                    phone=args.phone,
                    role=args.role,
                    password=prompt_password(),
                )
            except DuplicatePhoneError:
                await session.rollback()
                print(
                    f"Пользователь с телефоном {args.phone.strip()} уже существует.",
                    file=sys.stderr,
                )
                return 1
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
