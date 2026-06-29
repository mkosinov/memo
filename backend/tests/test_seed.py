"""Tests for the seed data script."""

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


async def test_seed_populates_masters(db_manager: DBManager) -> None:
    """Seed script creates exactly 6 masters."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM masters"))
        assert result.scalar() == 6


async def test_seed_populates_locations(db_manager: DBManager) -> None:
    """Seed script creates exactly 3 locations."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM locations"))
        assert result.scalar() == 3


async def test_seed_populates_services(db_manager: DBManager) -> None:
    """Seed script creates exactly 7 services."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM services"))
        assert result.scalar() == 7


async def test_seed_populates_tariffs(db_manager: DBManager) -> None:
    """Seed script creates 21 tariffs (3 per service x 7 services)."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM tariffs"))
        assert result.scalar() == 21


async def test_seed_populates_tags(db_manager: DBManager) -> None:
    """Seed script creates exactly 7 tags (including 'гость')."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM tags"))
        assert result.scalar() == 7


async def test_seed_services_have_material_hint_and_image_url(db_manager: DBManager) -> None:
    """Each seeded service has non-empty material_hint and image_url."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(
            text("SELECT id, material_hint, image_url FROM services")
        )
        rows = result.all()
        assert len(rows) == 7
        for row in rows:
            assert row.material_hint, f"Service {row.id} missing material_hint"
            assert row.image_url, f"Service {row.id} missing image_url"


async def test_seed_locations_have_location_hint(db_manager: DBManager) -> None:
    """Each seeded location has non-empty location_hint."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(
            text("SELECT id, location_hint FROM locations")
        )
        rows = result.all()
        assert len(rows) == 3
        for row in rows:
            assert row.location_hint, f"Location {row.id} missing location_hint"


async def test_seed_service_tags_exist(db_manager: DBManager) -> None:
    """Seed creates service_tags join table entries."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM service_tags"))
        assert result.scalar() >= 7


async def test_seed_activity_tags_exist(db_manager: DBManager) -> None:
    """Seed creates activity_tags join table entries."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM activity_tags"))
        assert result.scalar() >= 2


async def test_seed_populates_photos(db_manager: DBManager) -> None:
    """Seed script creates 7 photos."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM photos"))
        assert result.scalar() == 7


async def test_seed_photos_guest_tagged(db_manager: DBManager) -> None:
    """Guest photos (ph6, ph7) are tagged with 'гость'."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM photo_tags"))
        assert result.scalar() == 2


async def test_seed_populates_materials(db_manager: DBManager) -> None:
    """Seed script creates at least 4 materials."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM materials"))
        count = result.scalar()
        assert count >= 4


async def test_seed_has_guest_tag(db_manager: DBManager) -> None:
    """Tag with id 'tag7' exists and has tag 'гость'."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(
            text("SELECT tag FROM tags WHERE id = 'tag7'")
        )
        row = result.one_or_none()
        assert row is not None, "tag7 does not exist"
        assert row[0] == "гость"


async def test_seed_populates_activities(db_manager: DBManager) -> None:
    """Seed script creates 45 activities (three-week schedule)."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM activities"))
        assert result.scalar() == 45


async def test_seed_populates_clients(db_manager: DBManager) -> None:
    """Seed script creates 5 clients."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM clients"))
        assert result.scalar() == 5


async def test_seed_populates_visitors(db_manager: DBManager) -> None:
    """Seed script creates at least 8 visitors."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM visitors"))
        count = result.scalar()
        assert count >= 8


async def test_seed_populates_records(db_manager: DBManager) -> None:
    """Seed script creates at least 5 records."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM records"))
        count = result.scalar()
        assert count >= 5


async def test_seed_populates_visits(db_manager: DBManager) -> None:
    """Seed script creates at least 8 visits."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM visits"))
        count = result.scalar()
        assert count >= 8


async def test_seed_populates_payments(db_manager: DBManager) -> None:
    """Seed script creates at least 5 payments."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM payments"))
        count = result.scalar()
        assert count >= 5


async def test_seed_is_idempotent(db_manager: DBManager) -> None:
    """Running seed twice does not duplicate data."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)
    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM masters"))
        assert result.scalar() == 6

        result = await session.execute(text("SELECT COUNT(*) FROM activities"))
        assert result.scalar() == 45


async def test_seed_handles_month_boundary_overflow(db_manager: DBManager) -> None:
    """Regression for seed.py:286 — day arithmetic must not overflow month boundary.

    Bug: week_start.replace(day=week_start.day + day) raises ValueError when
    the resulting day exceeds the month's length (e.g., June 29 + day=2 = 31,
    but June has only 30 days). The fix must use timedelta or equivalent.

    Triggered by: WEEK3_START computing to 2026-06-29 (a Monday), so day=2
    (Wednesday) gives day=31 which is invalid for June.
    """
    from datetime import datetime

    from src.seed import seed as seed_module
    from src.seed.seed import seed_data

    original_week3 = seed_module.WEEK3_START
    # June has 30 days; 29 + 2 = 31 → ValueError before fix
    seed_module.WEEK3_START = datetime(2026, 6, 29)
    try:
        await seed_data(db_manager)
        async with db_manager.async_session() as session:
            result = await session.execute(text("SELECT COUNT(*) FROM activities"))
            count = result.scalar()
            assert count > 0, "Expected activities to be created after seed"
    finally:
        seed_module.WEEK3_START = original_week3
