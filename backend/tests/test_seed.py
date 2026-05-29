"""Tests for the seed data script."""

import pytest
from sqlalchemy import text

from app.db.base import Base
from app.db.database import DBManager


@pytest.fixture
async def db_manager():
    """Create an in-memory test database manager with tables."""
    manager = DBManager("sqlite+aiosqlite:///:memory:")
    async with manager.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield manager
    await manager.engine.dispose()


async def test_seed_populates_masters(db_manager: DBManager) -> None:
    """Seed script creates exactly 6 masters."""
    from seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM masters"))
        assert result.scalar() == 6


async def test_seed_populates_locations(db_manager: DBManager) -> None:
    """Seed script creates exactly 3 locations."""
    from seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM locations"))
        assert result.scalar() == 3


async def test_seed_populates_services(db_manager: DBManager) -> None:
    """Seed script creates exactly 7 services."""
    from seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM services"))
        assert result.scalar() == 7


async def test_seed_populates_tariffs(db_manager: DBManager) -> None:
    """Seed script creates 21 tariffs (3 per service x 7 services)."""
    from seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM tariffs"))
        assert result.scalar() == 21


async def test_seed_populates_tags(db_manager: DBManager) -> None:
    """Seed script creates at least 5 tags."""
    from seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM tags"))
        count = result.scalar()
        assert count >= 5


async def test_seed_populates_activities(db_manager: DBManager) -> None:
    """Seed script creates 28 activities (one week schedule)."""
    from seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM activities"))
        assert result.scalar() == 28


async def test_seed_populates_clients(db_manager: DBManager) -> None:
    """Seed script creates 5 clients."""
    from seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM clients"))
        assert result.scalar() == 5


async def test_seed_populates_visitors(db_manager: DBManager) -> None:
    """Seed script creates at least 8 visitors."""
    from seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM visitors"))
        count = result.scalar()
        assert count >= 8


async def test_seed_populates_records(db_manager: DBManager) -> None:
    """Seed script creates at least 5 records."""
    from seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM records"))
        count = result.scalar()
        assert count >= 5


async def test_seed_populates_visits(db_manager: DBManager) -> None:
    """Seed script creates at least 8 visits."""
    from seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM visits"))
        count = result.scalar()
        assert count >= 8


async def test_seed_populates_payments(db_manager: DBManager) -> None:
    """Seed script creates at least 5 payments."""
    from seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM payments"))
        count = result.scalar()
        assert count >= 5


async def test_seed_is_idempotent(db_manager: DBManager) -> None:
    """Running seed twice does not duplicate data."""
    from seed.seed import seed_data

    await seed_data(db_manager)
    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM masters"))
        assert result.scalar() == 6

        result = await session.execute(text("SELECT COUNT(*) FROM activities"))
        assert result.scalar() == 28
