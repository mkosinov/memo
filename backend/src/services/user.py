"""User service — undecorated row operations on ``users`` (GH #319).

Corridor-2 building blocks (canon docs/domain-rules/service-layer.md
rule 3): methods WITHOUT a transaction, composed by the ``create_user``
scenario (``src/usecases/user.py``), which owns the transaction boundary.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import select

from src.models.user import User

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


class UserService:
    """Row-level ``users`` operations (no transaction — callers own it)."""

    async def get_by_phone(
        self, session: AsyncSession, phone: str
    ) -> User | None:
        """Find a user by phone (ORM row or None)."""
        stmt = select(User).where(User.phone == phone)
        result = await session.execute(stmt)
        return result.scalar_one_or_none()

    async def create_row(
        self,
        session: AsyncSession,
        *,
        phone: str,
        role: str,
        password_hash: str,
    ) -> User:
        """INSERT a ``users`` row and flush (materializes ``user.id``)."""
        user = User(
            phone=phone,
            role=role,
            password_hash=password_hash,
        )
        session.add(user)
        await session.flush()
        return user


def get_user_service() -> UserService:
    """Factory for UserService."""
    return UserService()
