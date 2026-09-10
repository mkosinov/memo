"""GH #247 §3.11: seed_staff_users — dev/demo staff accounts.

Two users (spec §7): admin ``+79990000001 / admin12345`` and master
``+79990000002 / master12345`` linked to the first seeded master. Skipped
entirely when ``ENV=production`` (staging must set it too — deployment
note in the spec).

Spec: docs/specs/2026-09-08-auth-design.md §3.11
Domain rules: docs/domain-rules/auth.md (User Provisioning)
"""

from __future__ import annotations

import pytest
from sqlalchemy import text

from src.db.base import Base
from src.db.database import DBManager

pytestmark = pytest.mark.misc


@pytest.fixture
async def db_manager():
    """Create an in-memory test database manager with tables."""
    manager = DBManager("sqlite+aiosqlite:///:memory:")
    async with manager.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield manager
    await manager.engine.dispose()


async def _users(manager: DBManager) -> list[tuple]:
    async with manager.async_session() as session:
        result = await session.execute(
            text("SELECT phone, role, master_id, is_active FROM users ORDER BY phone")
        )
        return result.all()


async def test_seed_creates_staff_users(db_manager: DBManager) -> None:
    """seed_data creates the demo admin + master (ENV defaults to dev)."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    rows = await _users(db_manager)
    assert rows == [
        ("+79990000001", "admin", None, 1),
        ("+79990000002", "master", "m1", 1),  # linked to first seeded master
    ]


async def test_seed_staff_passwords_hash_verified(db_manager: DBManager) -> None:
    """Demo passwords verify against the stored hashes (policy-conformant)."""
    from src.auth.passwords import verify_password
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(
            text("SELECT phone, password_hash FROM users ORDER BY phone")
        )
        by_phone = {r.phone: r.password_hash for r in result}

    assert verify_password("admin12345", by_phone["+79990000001"])
    assert verify_password("master12345", by_phone["+79990000002"])


async def test_seed_skips_staff_in_production(
    db_manager: DBManager, monkeypatch: pytest.MonkeyPatch
) -> None:
    """ENV=production → no users rows at all (demo creds never land)."""
    from src.seed.seed import seed_data

    monkeypatch.setenv("ENV", "production")

    await seed_data(db_manager)

    assert await _users(db_manager) == []


async def test_seed_staff_explicit_dev_env(db_manager: DBManager, monkeypatch) -> None:
    """ENV=development (explicit) behaves like the default — staff seeded."""
    from src.seed.seed import seed_data

    monkeypatch.setenv("ENV", "development")

    await seed_data(db_manager)

    rows = await _users(db_manager)
    assert len(rows) == 2
